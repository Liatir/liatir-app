export interface WorkspaceMeta {
  id: string;
  name: string;
  createdAt: number;
  lastOpenedAt: number;
  favorite?: boolean;
}

export interface WorkspacesFile {
  workspaces: WorkspaceMeta[];
}

export interface WorkspaceEnvVar {
  key: string;
  value: string;
  type: 'string' | 'number' | 'boolean';
  enabled: boolean;
}

export interface WorkspaceEnvFile {
  variables: WorkspaceEnvVar[];
}
