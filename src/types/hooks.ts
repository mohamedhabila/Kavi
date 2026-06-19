export interface HookDefinition {
  id: string;
  name: string;
  event: string;
  action: string;
  prompt: string;
  enabled: boolean;
  createdAt: number;
  source: 'user' | 'bundled' | 'workspace';
}
