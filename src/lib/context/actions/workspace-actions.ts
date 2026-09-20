import { Workspace, WorkspaceMember, WorkspaceTrackingMode } from '../../types';
import { FinanceActionDeps } from './types';

export function createWorkspace(
  deps: FinanceActionDeps,
  name: string,
  tracking_mode: WorkspaceTrackingMode = 'full'
): Workspace {
  const state = deps.getState();
  const newWs: Workspace = {
    id: deps.generateId('ws'),
    name: name.trim(),
    owner_id: 'usr-1',
    currency: 'BRL',
    tracking_mode,
    created_at: deps.now().toISOString(),
  };

  const newMember: WorkspaceMember = {
    id: deps.generateId('wsm'),
    workspace_id: newWs.id,
    user_id: 'usr-1',
    role: 'owner',
    created_at: deps.now().toISOString(),
  };

  deps.commit({
    ...state,
    allWorkspaces: [...state.allWorkspaces, newWs],
    allWorkspaceMembers: [...state.allWorkspaceMembers, newMember],
    activeWorkspaceId: newWs.id,
  });

  return newWs;
}

export function updateWorkspace(
  deps: FinanceActionDeps,
  id: string,
  data: Partial<Workspace>
): void {
  const state = deps.getState();
  deps.commit({
    ...state,
    allWorkspaces: state.allWorkspaces.map((w) =>
      w.id === id ? { ...w, ...data, id: w.id, created_at: w.created_at } : w
    ),
  });
}

export function setActiveWorkspaceId(
  deps: FinanceActionDeps,
  id: string
): void {
  const state = deps.getState();
  deps.commit({
    ...state,
    activeWorkspaceId: id,
  });
}

export function addWorkspaceMember(
  deps: FinanceActionDeps,
  email: string,
  role: 'admin' | 'member' | 'viewer'
): void {
  const state = deps.getState();
  const singleUserId = deps.generateId('usr');
  const targetWsId = state.activeWorkspaceId;
  const newMember: WorkspaceMember = {
    id: deps.generateId('wsm'),
    workspace_id: targetWsId,
    user_id: singleUserId,
    role,
    user: {
      id: singleUserId,
      name: email.split('@')[0],
      email,
      created_at: deps.now().toISOString(),
    },
    created_at: deps.now().toISOString(),
  };

  deps.commit({
    ...state,
    allWorkspaceMembers: [...state.allWorkspaceMembers, newMember],
  });
}
