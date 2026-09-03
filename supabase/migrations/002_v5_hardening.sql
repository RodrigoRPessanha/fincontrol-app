-- ==============================================================================
-- FINCONTROL V7 - MIGRATION INCREMENTAL DE ENDURECIMENTO (002_v5_hardening.sql)
-- Compatível com bancos V4/V5 existentes e novas instalações
-- ==============================================================================

-- 1. Garante constraint nomeada de alvo único na tabela payments
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payments_single_target_chk'
    ) THEN
        ALTER TABLE public.payments 
        ADD CONSTRAINT payments_single_target_chk 
        CHECK (num_nonnulls(transaction_id, installment_id, credit_card_bill_id) = 1);
    END IF;
END $$;

-- 2. Atualiza RPC de transferência de ownership com LOCK FOR UPDATE e reset seguro da flag
CREATE OR REPLACE FUNCTION public.fn_transfer_workspace_ownership(
    p_workspace_id UUID,
    p_new_owner_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_owner_id UUID;
    v_is_member BOOLEAN;
BEGIN
    -- Bloqueio pessimista contra transferências concorrentes simultâneas (FOR UPDATE)
    SELECT owner_id INTO v_current_owner_id
    FROM public.workspaces
    WHERE id = p_workspace_id
    FOR UPDATE;

    IF v_current_owner_id IS NULL THEN
        RAISE EXCEPTION 'Workspace não encontrado.';
    END IF;

    IF v_current_owner_id != auth.uid() THEN
        RAISE EXCEPTION 'Apenas o proprietário atual pode transferir a posse do workspace.';
    END IF;

    IF v_current_owner_id = p_new_owner_id THEN
        RAISE EXCEPTION 'O usuário informado já é o proprietário do workspace.';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.workspace_members
        WHERE workspace_id = p_workspace_id AND user_id = p_new_owner_id
    ) INTO v_is_member;

    IF NOT v_is_member THEN
        RAISE EXCEPTION 'O novo proprietário deve ser membro ativo do workspace.';
    END IF;

    -- Define flag temporária na transação para autorizar o trigger
    PERFORM set_config('app.allow_owner_transfer', 'true', true);

    -- Atualiza proprietário do workspace
    UPDATE public.workspaces
    SET owner_id = p_new_owner_id
    WHERE id = p_workspace_id;

    -- Promove novo proprietário
    UPDATE public.workspace_members
    SET role = 'owner'
    WHERE workspace_id = p_workspace_id AND user_id = p_new_owner_id;

    -- Rebaixa antigo proprietário para admin
    UPDATE public.workspace_members
    SET role = 'admin'
    WHERE workspace_id = p_workspace_id AND user_id = v_current_owner_id;

    -- Redefine a flag de transferência para false antes de encerrar
    PERFORM set_config('app.allow_owner_transfer', 'false', true);
END;
$$;

-- 3. Triggers de Integridade Cross-Workspace Completos no Banco de Dados
CREATE OR REPLACE FUNCTION public.fn_check_transaction_workspace_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Valida Conta
    IF NEW.account_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.accounts 
            WHERE id = NEW.account_id AND workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION 'A conta bancária informada não pertence ao mesmo workspace da transação.';
        END IF;
    END IF;

    -- Valida Categoria
    IF NEW.category_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.categories 
            WHERE id = NEW.category_id AND workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION 'A categoria informada não pertence ao mesmo workspace da transação.';
        END IF;
    END IF;

    -- Valida Cartão de Crédito
    IF NEW.credit_card_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.credit_cards 
            WHERE id = NEW.credit_card_id AND workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION 'O cartão de crédito informado não pertence ao mesmo workspace da transação.';
        END IF;
    END IF;

    -- Valida Fatura de Cartão
    IF NEW.credit_card_bill_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.credit_card_bills 
            WHERE id = NEW.credit_card_bill_id AND workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION 'A fatura informada não pertence ao mesmo workspace da transação.';
        END IF;
    END IF;

    -- Valida Método de Pagamento
    IF NEW.payment_method_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.payment_methods 
            WHERE id = NEW.payment_method_id AND workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION 'O método de pagamento informado não pertence ao mesmo workspace da transação.';
        END IF;
    END IF;

    -- Valida Recorrência
    IF NEW.recurring_transaction_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.recurring_transactions 
            WHERE id = NEW.recurring_transaction_id AND workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION 'A recorrência vinculada não pertence ao mesmo workspace da transação.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_transaction_workspace_integrity ON public.transactions;
CREATE TRIGGER trg_check_transaction_workspace_integrity
    BEFORE INSERT OR UPDATE ON public.transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_check_transaction_workspace_integrity();

CREATE OR REPLACE FUNCTION public.fn_check_payment_workspace_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Valida Conta
    IF NOT EXISTS (
        SELECT 1 FROM public.accounts 
        WHERE id = NEW.account_id AND workspace_id = NEW.workspace_id
    ) THEN
        RAISE EXCEPTION 'A conta bancária do pagamento não pertence ao workspace informado.';
    END IF;

    -- Valida Transação vinculada
    IF NEW.transaction_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.transactions 
            WHERE id = NEW.transaction_id AND workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION 'A transação do pagamento não pertence ao mesmo workspace.';
        END IF;
    END IF;

    -- Valida Fatura vinculada
    IF NEW.credit_card_bill_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.credit_card_bills 
            WHERE id = NEW.credit_card_bill_id AND workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION 'A fatura do pagamento não pertence ao mesmo workspace.';
        END IF;
    END IF;

    -- Valida Parcela vinculada (via purchases)
    IF NEW.installment_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.installments i
            JOIN public.purchases pur ON pur.id = i.purchase_id
            WHERE i.id = NEW.installment_id AND pur.workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION 'A parcela do pagamento não pertence ao mesmo workspace.';
        END IF;
    END IF;

    -- Valida Método de Pagamento
    IF NEW.payment_method_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.payment_methods 
            WHERE id = NEW.payment_method_id AND workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION 'O método de pagamento não pertence ao workspace informado.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_payment_workspace_integrity ON public.payments;
CREATE TRIGGER trg_check_payment_workspace_integrity
    BEFORE INSERT OR UPDATE ON public.payments
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_check_payment_workspace_integrity();

