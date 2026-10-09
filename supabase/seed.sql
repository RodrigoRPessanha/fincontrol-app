-- ==============================================================================
-- FINCONTROL V38 - SEED DETERMINÍSTICO PARA DESENVOLVIMENTO E TESTES (PGTAP)
-- ==============================================================================

-- 1. IDs Fixos Determinísticos
-- Workspace Principal: 00000000-0000-0000-0000-000000000001
-- Workspace Secundário: 00000000-0000-0000-0000-000000000002
-- Usuário Alice (Owner): aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
-- Usuário Bob (Member): bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb

-- Inserção de perfis de teste (garantindo chave estrangeira caso auth.users exista)
DO $$
BEGIN
    -- Se a tabela auth.users existir, insere os usuários de teste
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users') THEN
        INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at)
        VALUES
            ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@fincontrol.test', '{"name": "Alice Silva"}', NOW(), NOW()),
            ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bob@fincontrol.test', '{"name": "Bob Santos"}', NOW(), NOW())
        ON CONFLICT (id) DO NOTHING;
    END IF;

    -- Perfis
    INSERT INTO public.profiles (id, name, email, created_at, updated_at)
    VALUES
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Alice Silva', 'alice@fincontrol.test', NOW(), NOW()),
        ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Bob Santos', 'bob@fincontrol.test', NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email;

    -- Workspaces
    INSERT INTO public.workspaces (id, name, owner_id, currency, tracking_mode, created_at, updated_at)
    VALUES
        ('00000000-0000-0000-0000-000000000001', 'Workspace Familiar', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'BRL', 'full', NOW(), NOW()),
        ('00000000-0000-0000-0000-000000000002', 'Viagem Férias', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'BRL', 'expense_tracker', NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, tracking_mode = EXCLUDED.tracking_mode;

    -- Membros dos Workspaces
    INSERT INTO public.workspace_members (id, workspace_id, user_id, role, created_at)
    VALUES
        ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner', NOW()),
        ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'member', NOW()),
        ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner', NOW()),
        ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'member', NOW())
    ON CONFLICT (id) DO NOTHING;

    -- Contas Bancárias (Apenas para Workspace Familiar com tracking_mode = full)
    INSERT INTO public.accounts (id, workspace_id, name, type, institution, initial_balance, current_balance, color, active, created_at)
    VALUES
        ('a1111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Conta Corrente Principal', 'checking', 'Banco do Brasil', 5000.00, 5000.00, '#0066cc', true, NOW()),
        ('a2222222-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Reserva de Emergência', 'savings', 'Nubank', 15000.00, 15000.00, '#8a05be', true, NOW())
    ON CONFLICT (id) DO NOTHING;

    -- Categorias
    INSERT INTO public.categories (id, workspace_id, name, type, color, icon, active, created_at)
    VALUES
        ('c1111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Alimentação', 'expense', '#ef4444', 'Utensils', true, NOW()),
        ('c2222222-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Salário', 'income', '#10b981', 'Briefcase', true, NOW()),
        ('c3333333-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 'Hospedagem & Passeios', 'expense', '#f59e0b', 'Plane', true, NOW())
    ON CONFLICT (id) DO NOTHING;

    -- Cartões de Crédito
    INSERT INTO public.credit_cards (id, workspace_id, name, institution, credit_limit, closing_day, due_day, color, active, created_at)
    VALUES
        ('cc111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Cartão Black', 'Nubank', 10000.00, 5, 12, '#111827', true, NOW())
    ON CONFLICT (id) DO NOTHING;

    -- Transação com Rateio Igualitário (Equal Split)
    INSERT INTO public.transactions (id, workspace_id, account_id, category_id, description, amount, type, transaction_date, due_date, status, paid_by_member_id, split_type, created_at)
    VALUES
        ('b1111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'a1111111-0000-0000-0000-000000000001', 'c1111111-0000-0000-0000-000000000001', 'Supermercado Mensal', 600.00, 'expense', CURRENT_DATE, CURRENT_DATE, 'paid', '11111111-1111-1111-1111-111111111111', 'equal', NOW())
    ON CONFLICT (id) DO NOTHING;

    -- Frações da Transação
    INSERT INTO public.transaction_splits (id, workspace_id, transaction_id, member_id, amount, percentage, created_at)
    VALUES
        ('f1111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'b1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 300.00, 50.00, NOW()),
        ('f2222222-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'b1111111-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 300.00, 50.00, NOW())
    ON CONFLICT (id) DO NOTHING;

    -- Pagamento no modo expense_tracker (account_id é NULL e affects_balance é false - validação P1-01)
    INSERT INTO public.payments (id, workspace_id, transaction_id, account_id, amount, payment_date, affects_balance, created_at)
    VALUES
        ('e1111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'b1111111-0000-0000-0000-000000000001', NULL, 600.00, CURRENT_DATE, false, NOW())
    ON CONFLICT (id) DO NOTHING;

    -- Settlement / Acerto de Contas (Bob paga Alice)
    INSERT INTO public.settlements (id, workspace_id, from_member_id, to_member_id, amount, settlement_date, notes, created_at)
    VALUES
        ('d1111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 300.00, CURRENT_DATE, 'Acerto do Supermercado', NOW())
    ON CONFLICT (id) DO NOTHING;

END $$;
