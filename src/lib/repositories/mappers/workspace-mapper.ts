import { Database } from '../../supabase/database.types';
import { Workspace, WorkspaceMember, WorkspaceRole, WorkspaceTrackingMode } from '../../types';

type WorkspaceRow = Database['public']['Tables']['workspaces']['Row'];
type WorkspaceInsert = Database['public']['Tables']['workspaces']['Insert'];
type WorkspaceMemberRow = Database['public']['Tables']['workspace_members']['Row'];
type WorkspaceMemberInsert = Database['public']['Tables']['workspace_members']['Insert'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export function mapWorkspaceRowToDomain(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    owner_id: row.owner_id,
    currency: row.currency ?? 'BRL',
    tracking_mode: (row.tracking_mode as WorkspaceTrackingMode) ?? 'full',
    created_at: row.created_at,
  };
}

export function mapDomainToWorkspaceInsert(
  domain: Omit<Workspace, 'id' | 'created_at'> & { id?: string }
): WorkspaceInsert {
  return {
    id: domain.id,
    name: domain.name,
    owner_id: domain.owner_id,
    currency: domain.currency ?? 'BRL',
    tracking_mode: domain.tracking_mode ?? 'full',
  };
}

export function mapWorkspaceMemberRowToDomain(
  row: WorkspaceMemberRow,
  profile?: ProfileRow | null
): WorkspaceMember {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    user_id: row.user_id,
    role: (row.role as WorkspaceRole) ?? 'member',
    created_at: row.created_at,
    user: profile
      ? {
          id: profile.id,
          name: profile.name ?? 'Membro',
          email: profile.email ?? '',
          avatar_url: profile.avatar_url ?? undefined,
          created_at: profile.created_at,
        }
      : undefined,
  };
}

export function mapDomainToWorkspaceMemberInsert(
  domain: Omit<WorkspaceMember, 'id' | 'created_at'> & { id?: string }
): WorkspaceMemberInsert {
  return {
    id: domain.id,
    workspace_id: domain.workspace_id,
    user_id: domain.user_id,
    role: domain.role,
  };
}
