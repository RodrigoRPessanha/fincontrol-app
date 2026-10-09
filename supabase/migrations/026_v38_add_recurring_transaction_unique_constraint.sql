-- ==============================================================================
-- MIGRATION 026: V38 ADD UNIQUE CONSTRAINT ON RECURRING TRANSACTIONS OCCURRENCE
-- ==============================================================================

-- 1. Remove o índice parcial anterior para dar lugar à constraint formal
DROP INDEX IF EXISTS public.idx_transactions_recurring_occurrence;

-- 2. Adiciona constraint UNIQUE formal em (recurring_transaction_id, transaction_date)
-- No PostgreSQL, valores NULL não conflitam entre si em constraints UNIQUE, permitindo
-- infinitas transações comuns (com recurring_transaction_id NULL) na mesma data.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_transactions_recurring_occurrence'
    ) THEN
        ALTER TABLE public.transactions
        ADD CONSTRAINT uq_transactions_recurring_occurrence
        UNIQUE (recurring_transaction_id, transaction_date);
    END IF;
END $$;
