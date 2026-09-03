-- ==============================================================================
-- FINCONTROL V8 - MIGRATION INCREMENTAL (003_v7_hardening.sql)
-- Suporte a compras parceladas com parcelas já pagas e integridade avançada
-- ==============================================================================

-- 1. Adiciona coluna paid_installments_count na tabela purchases
ALTER TABLE public.purchases
ADD COLUMN IF NOT EXISTS paid_installments_count INT DEFAULT 0 CHECK (paid_installments_count >= 0);

-- 2. Trigger para garantir que paid_installments_count não exceda installment_count
CREATE OR REPLACE FUNCTION public.fn_check_purchase_paid_installments_count()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.paid_installments_count > NEW.installment_count THEN
        RAISE EXCEPTION 'O número de parcelas já pagas (%) não pode ser maior que o total de parcelas (%).',
            NEW.paid_installments_count, NEW.installment_count;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_purchase_paid_installments_count ON public.purchases;
CREATE TRIGGER trg_check_purchase_paid_installments_count
    BEFORE INSERT OR UPDATE ON public.purchases
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_check_purchase_paid_installments_count();
