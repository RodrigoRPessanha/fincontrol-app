-- A2-02: diário de aportes, débito e crédito em uma única transação SQL.
CREATE TABLE public.goal_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES public.financial_goals(id) DEFERRABLE INITIALLY DEFERRED,
  account_id uuid NOT NULL REFERENCES public.accounts(id) DEFERRABLE INITIALLY DEFERRED,
  amount numeric(12,2) NOT NULL CHECK (amount::text<>'NaN' AND amount>0 AND amount<=9999999999.99),
  idempotency_key text NOT NULL CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 200),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz,
  UNIQUE(workspace_id,idempotency_key)
);
CREATE INDEX goal_deposits_goal_idx ON public.goal_deposits(workspace_id,goal_id);
ALTER TABLE public.goal_deposits ENABLE ROW LEVEL SECURITY;
CREATE POLICY goal_deposits_read ON public.goal_deposits FOR SELECT TO authenticated
  USING(public.is_member(workspace_id));
REVOKE ALL ON public.goal_deposits FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.goal_deposits TO authenticated;
GRANT ALL ON public.goal_deposits TO service_role;

CREATE OR REPLACE FUNCTION public.fn_record_goal_deposit(
  p_workspace_id uuid,p_goal_id uuid,p_account_id uuid,p_amount numeric,p_idempotency_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_goal public.financial_goals; v_account public.accounts; v_old public.goal_deposits; v_id uuid; v_mode text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_workspace_role(p_workspace_id,ARRAY['owner','admin','member']) THEN
    RAISE EXCEPTION 'Acesso negado para aporte neste workspace.';
  END IF;
  p_amount := public.fn_normalize_money(p_amount);
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Chave de aporte inválida.'; END IF;
  SELECT tracking_mode INTO v_mode FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
  SELECT * INTO v_old FROM public.goal_deposits WHERE workspace_id=p_workspace_id AND idempotency_key=p_idempotency_key;
  IF v_old.id IS NOT NULL THEN
    IF v_old.goal_id<>p_goal_id OR v_old.account_id<>p_account_id OR v_old.amount<>p_amount THEN
      RAISE EXCEPTION 'Chave de aporte reutilizada com dados diferentes.';
    END IF;
    RETURN v_old.id;
  END IF;
  IF v_mode<>'full' THEN RAISE EXCEPTION 'Aportes não são permitidos no modo Apenas Despesas.'; END IF;
  SELECT * INTO v_goal FROM public.financial_goals WHERE id=p_goal_id AND workspace_id=p_workspace_id FOR UPDATE;
  SELECT * INTO v_account FROM public.accounts WHERE id=p_account_id AND workspace_id=p_workspace_id AND active FOR UPDATE;
  IF v_goal.id IS NULL OR v_account.id IS NULL THEN RAISE EXCEPTION 'Meta ou conta ativa não encontrada no workspace.'; END IF;
  UPDATE public.accounts SET current_balance=public.fn_normalize_money(current_balance-p_amount,'signed') WHERE id=p_account_id;
  UPDATE public.financial_goals SET current_amount=public.fn_normalize_money(current_amount+p_amount,'nonnegative'),
    status=CASE WHEN current_amount+p_amount>=target_amount THEN 'completed' ELSE status END WHERE id=p_goal_id;
  INSERT INTO public.goal_deposits(workspace_id,goal_id,account_id,amount,idempotency_key,created_by)
    VALUES(p_workspace_id,p_goal_id,p_account_id,p_amount,p_idempotency_key,auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

-- Reversão idempotente conserva histórico; não depende do modo/atividade atuais.
CREATE OR REPLACE FUNCTION public.fn_reverse_goal_deposit(p_workspace_id uuid,p_deposit_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d public.goal_deposits;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_workspace_role(p_workspace_id,ARRAY['owner','admin','member']) THEN RAISE EXCEPTION 'Acesso negado para reversão neste workspace.'; END IF;
  PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
  SELECT * INTO d FROM public.goal_deposits WHERE id=p_deposit_id AND workspace_id=p_workspace_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Aporte não encontrado no workspace.'; END IF;
  IF d.reversed_at IS NOT NULL THEN RETURN; END IF;
  UPDATE public.accounts SET current_balance=public.fn_normalize_money(current_balance+d.amount,'signed') WHERE id=d.account_id;
  UPDATE public.financial_goals SET current_amount=public.fn_normalize_money(current_amount-d.amount,'nonnegative'),
    status=CASE WHEN status='completed' AND current_amount-d.amount<target_amount THEN 'in_progress' ELSE status END WHERE id=d.goal_id;
  UPDATE public.goal_deposits SET reversed_at=now() WHERE id=d.id;
END; $$;
REVOKE ALL ON FUNCTION public.fn_record_goal_deposit(uuid,uuid,uuid,numeric,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.fn_reverse_goal_deposit(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_record_goal_deposit(uuid,uuid,uuid,numeric,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_reverse_goal_deposit(uuid,uuid) TO authenticated,service_role;
