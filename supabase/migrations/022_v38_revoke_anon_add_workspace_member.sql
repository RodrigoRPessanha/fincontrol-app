-- ==============================================================================
-- MIGRATION 022: REVOKE PUBLIC AND ANON EXECUTE ON fn_add_workspace_member
-- ==============================================================================
-- Revoga expressamente permissões de execução de PUBLIC e anon na RPC
-- fn_add_workspace_member, mantendo acesso restrito a authenticated e service_role.
-- ==============================================================================

REVOKE EXECUTE ON FUNCTION public.fn_add_workspace_member(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_add_workspace_member(UUID, TEXT, TEXT) FROM anon;

GRANT EXECUTE ON FUNCTION public.fn_add_workspace_member(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_add_workspace_member(UUID, TEXT, TEXT) TO service_role;
