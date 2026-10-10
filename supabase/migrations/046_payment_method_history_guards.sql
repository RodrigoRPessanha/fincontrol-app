-- Preserve payment method history, including writes made outside the application.
CREATE OR REPLACE FUNCTION public.fn_guard_payment_method_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  used boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF btrim(NEW.name) = '' THEN
      RAISE EXCEPTION 'Informe o nome do método de pagamento.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  -- A parent workspace deletion must still cascade through its own records.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id) THEN
    RETURN OLD;
  END IF;
  -- Conflict with FK KEY SHARE locks before checking references. This also
  -- serializes concurrent reference insertion with a type change or deletion.
  PERFORM 1 FROM public.payment_methods WHERE id = OLD.id FOR UPDATE;
  SELECT EXISTS (SELECT 1 FROM public.transactions WHERE payment_method_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.purchases WHERE payment_method_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.payments WHERE payment_method_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.recurring_transactions WHERE payment_method_id = OLD.id)
    INTO used;
  IF TG_OP = 'DELETE' THEN
    IF used THEN
      RAISE EXCEPTION 'Método com histórico não pode ser excluído. Desative-o para preservar os registros.' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF btrim(NEW.name) = '' THEN
    RAISE EXCEPTION 'Informe o nome do método de pagamento.' USING ERRCODE = '23514';
  END IF;
  IF NEW.type IS DISTINCT FROM OLD.type AND
    (used OR OLD.credit_card_id IS NOT NULL OR OLD.linked_account_id IS NOT NULL) THEN
    RAISE EXCEPTION 'O tipo não pode mudar enquanto houver vínculos. Crie outro método.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_guard_payment_method_history() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_payment_method_history
BEFORE INSERT OR UPDATE OR DELETE ON public.payment_methods
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_payment_method_history();
