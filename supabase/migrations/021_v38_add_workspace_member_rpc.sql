-- ==============================================================================
-- MIGRATION 021: RPC PARA ADIÇÃO / CONVITE DE MEMBRO POR EMAIL OU UUID
-- ==============================================================================
-- Permite adicionar membros a um workspace informando e-mail ou UUID do usuário.
-- Resolve atomicamente o e-mail na tabela profiles com privilégios SECURITY DEFINER,
-- validando que o chamador é owner ou admin do workspace e garantindo que a coluna
-- workspace_members.user_id sempre receba um UUID válido que referencia profiles(id).
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.fn_add_workspace_member(
    p_workspace_id UUID,
    p_email_or_user_id TEXT,
    p_role TEXT DEFAULT 'member'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_member_id UUID;
    v_role TEXT;
BEGIN
    -- 1. Normaliza a role informada
    v_role := LOWER(TRIM(COALESCE(p_role, 'member')));
    IF v_role NOT IN ('admin', 'member', 'viewer') THEN
        RAISE EXCEPTION 'Papel de membro inválido: %. Valores permitidos: admin, member, viewer.', p_role;
    END IF;

    -- 2. Valida se o usuário autenticado é owner ou admin do workspace
    IF NOT has_workspace_role(p_workspace_id, ARRAY['owner', 'admin']) THEN
        RAISE EXCEPTION 'Apenas proprietários ou administradores podem adicionar membros ao workspace.';
    END IF;

    -- 3. Resolve user_id: se for UUID válido, usa diretamente; caso contrário, busca em profiles por email
    IF p_email_or_user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_user_id := p_email_or_user_id::UUID;
        -- Verifica se o perfil existe
        IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id) THEN
            RAISE EXCEPTION 'Perfil de usuário não encontrado para o ID informado: %', p_email_or_user_id;
        END IF;
    ELSE
        SELECT id INTO v_user_id
        FROM public.profiles
        WHERE LOWER(email) = LOWER(TRIM(p_email_or_user_id))
        LIMIT 1;

        IF v_user_id IS NULL THEN
            RAISE EXCEPTION 'Nenhum usuário cadastrado foi encontrado com o e-mail: %', p_email_or_user_id;
        END IF;
    END IF;

    -- 4. Verifica se o usuário já é membro deste workspace
    IF EXISTS (
        SELECT 1 FROM public.workspace_members
        WHERE workspace_id = p_workspace_id AND user_id = v_user_id
    ) THEN
        RAISE EXCEPTION 'O usuário informado já é membro deste workspace.';
    END IF;

    -- 5. Insere o membro com user_id UUID canônico garantido
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (p_workspace_id, v_user_id, v_role)
    RETURNING id INTO v_member_id;

    RETURN v_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_add_workspace_member(UUID, TEXT, TEXT) TO authenticated;
