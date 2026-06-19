import type { HookDefinition } from './hooks';
import type { AppSettings } from './settings';

export interface ExportedSettings {
  version: number;
  exportedAt: number;
  settings: Partial<AppSettings>;
  omittedSensitiveData?: string[];
  hooks?: HookDefinition[];
  skills?: Array<{ metadata: any; source: any; systemPrompt?: string; hooks?: any[] }>;
}
