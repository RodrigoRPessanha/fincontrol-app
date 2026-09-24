-- ==============================================================================
-- MIGRATION 011: INTEGRIDADE PARENT-SIDE NA ALTERAÇÃO DE VALORES COM RATEIO
-- ==============================================================================
-- Impede que o valor de uma transação (transactions.amount) ou de uma compra parcelada
-- (purchases.total_amount) seja alterado diretamente caso existam frações de rateio
-- persistidas cuja soma divirja do novo valor, protegendo a conservação financeira
-- contra mutações parent-side.
-- ==============================================================================

-- 1. Trigger parent-side para transactions
CREATE OR REPLACE FUNCTION public.fn_check_transaction_amount_split_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_splits_total NUMERIC(12, 2);
    v_splits_count INT;
BEGIN
    IF NEW.amount <> OLD.amount THEN
        SELECT COALESCE(SUM(amount), 0), COUNT(*) 
        INTO v_splits_total, v_splits_count
        FROM public.transaction_splits 
        WHERE transaction_id = NEW.id;

        IF v_splits_count > 0 AND v_splits_total <> NEW.amount THEN
            RAISE EXCEPTION 'A alteração do valor da transação (R$ %) viola a conservação das frações de rateio existentes (R$ %). Atualize os rateios via fn_set_transaction_splits.', NEW.amount, v_splits_total;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_transaction_amount_split ON public.transactions;
CREATE TRIGGER trg_check_transaction_amount_split
    BEFORE UPDATE OF amount ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_transaction_amount_split_integrity();

-- 2. Trigger parent-side para purchases
CREATE OR REPLACE FUNCTION public.fn_check_purchase_amount_split_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_splits_total NUMERIC(12, 2);
    v_splits_count INT;
BEGIN
    IF NEW.total_amount <> OLD.total_amount THEN
        SELECT COALESCE(SUM(amount), 0), COUNT(*) 
        INTO v_splits_total, v_splits_count
        FROM public.purchase_splits 
        WHERE purchase_id = NEW.id;

        IF v_splits_count > 0 AND v_splits_total <> NEW.total_amount THEN
            RAISE EXCEPTION 'A alteração do valor total da compra parcelada (R$ %) viola a conservação das frações de rateio existentes (R$ %). Atualize os rateios via fn_set_purchase_splits.', NEW.total_amount, v_splits_total;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_purchase_amount_split ON public.purchases;
CREATE TRIGGER trg_check_purchase_amount_split
    BEFORE UPDATE OF total_amount ON public.purchases
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_purchase_amount_split_integrity();

-- 3. Endurecimento de search_path
ALTER FUNCTION public.fn_check_transaction_amount_split_integrity() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_check_purchase_amount_split_integrity() SET search_path = public, pg_temp;
