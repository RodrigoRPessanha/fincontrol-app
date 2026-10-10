-- Partial transaction editing with optimistic concurrency and existing financial guards.
CREATE OR REPLACE FUNCTION public.fn_patch_transaction(
  p_workspace_id uuid, p_transaction_id uuid, p_changes jsonb, p_expected_updated_at timestamptz
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE old_tx public.transactions%ROWTYPE; financial boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_workspace_role(p_workspace_id, ARRAY['owner','admin','member']) THEN
    RAISE EXCEPTION 'Você não possui permissão para editar esta transação.' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(p_changes) IS DISTINCT FROM 'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_changes) k WHERE k NOT IN
      ('description','amount','category_id','transaction_date','due_date','notes','paid_by_member_id','paid_by_person_id','split_type','splits')
  ) THEN RAISE EXCEPTION 'Campos de edição inválidos.' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtext('workspace_debt:' || p_workspace_id::text));
  SELECT * INTO old_tx FROM public.transactions WHERE id=p_transaction_id AND workspace_id=p_workspace_id FOR UPDATE;
  IF old_tx.id IS NULL THEN RAISE EXCEPTION 'Transação não encontrada no workspace.'; END IF;
  IF p_expected_updated_at IS NULL OR old_tx.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Esta transação foi alterada. Atualize os dados e abra a edição novamente.' USING ERRCODE='40001';
  END IF;
  IF p_changes ? 'description' AND (p_changes->>'description' IS NULL OR btrim(p_changes->>'description')='') THEN
    RAISE EXCEPTION 'Informe a descrição da transação.' USING ERRCODE='23514';
  END IF;
  IF (p_changes ? 'transaction_date' AND p_changes->>'transaction_date' IS NULL) OR
     (p_changes ? 'due_date' AND p_changes->>'due_date' IS NULL) THEN
    RAISE EXCEPTION 'Informe datas válidas.' USING ERRCODE='23514';
  END IF;
  financial := p_changes ?| ARRAY['amount','paid_by_member_id','paid_by_person_id','split_type','splits'];
  IF financial THEN
    IF old_tx.status IN ('paid','partially_paid') OR old_tx.credit_card_id IS NOT NULL OR old_tx.credit_card_bill_id IS NOT NULL OR
       EXISTS(SELECT 1 FROM public.payments WHERE transaction_id=old_tx.id) THEN
      RAISE EXCEPTION 'Valor e rateio de transações pagas ou faturadas estão protegidos. Edite apenas os dados descritivos.' USING ERRCODE='23514';
    END IF;
    IF p_changes ? 'amount' AND (p_changes->>'amount' IS NULL OR (p_changes->>'amount')::numeric<=0) THEN
      RAISE EXCEPTION 'Informe um valor positivo.' USING ERRCODE='23514';
    END IF;
    PERFORM public.fn_update_transaction_with_splits(
      p_workspace_id, old_tx.id,
      COALESCE(p_changes->>'description',old_tx.description),
      COALESCE((p_changes->>'amount')::numeric,old_tx.amount),
      COALESCE((p_changes->>'transaction_date')::date,old_tx.transaction_date), old_tx.type,
      CASE WHEN p_changes ? 'category_id' THEN (p_changes->>'category_id')::uuid ELSE old_tx.category_id END,
      old_tx.account_id, old_tx.payment_method_id, old_tx.credit_card_id, old_tx.credit_card_bill_id,
      CASE WHEN p_changes ? 'notes' THEN p_changes->>'notes' ELSE old_tx.notes END,
      CASE WHEN p_changes ? 'paid_by_member_id' THEN (p_changes->>'paid_by_member_id')::uuid ELSE old_tx.paid_by_member_id END,
      COALESCE(p_changes->>'split_type',old_tx.split_type),
      COALESCE((p_changes->>'due_date')::date,old_tx.due_date),
      CASE WHEN p_changes ? 'splits' THEN p_changes->'splits' ELSE NULL END,
      CASE WHEN p_changes ? 'paid_by_person_id' THEN (p_changes->>'paid_by_person_id')::uuid ELSE old_tx.paid_by_person_id END
    );
  ELSE
    -- Metadata edits preserve payment history, status, card links and splits.
    UPDATE public.transactions SET
      description=COALESCE(btrim(p_changes->>'description'),description),
      category_id=CASE WHEN p_changes ? 'category_id' THEN (p_changes->>'category_id')::uuid ELSE category_id END,
      notes=CASE WHEN p_changes ? 'notes' THEN p_changes->>'notes' ELSE notes END,
      transaction_date=COALESCE((p_changes->>'transaction_date')::date,transaction_date),
      due_date=COALESCE((p_changes->>'due_date')::date,due_date), updated_at=clock_timestamp()
    WHERE id=old_tx.id;
  END IF;
  RETURN old_tx.id;
END $$;
REVOKE ALL ON FUNCTION public.fn_patch_transaction(uuid,uuid,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_patch_transaction(uuid,uuid,jsonb,timestamptz) TO authenticated;
