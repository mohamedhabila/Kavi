// ---------------------------------------------------------------------------
// Kavi — Skills Types
// ---------------------------------------------------------------------------

export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  tools: SkillToolDefinition[];
  systemPrompt?: string;
  invocationPolicy?: SkillInvocationPolicy;
}

export interface SkillToolExecutionContext {
  conversationId?: string;
  readConversationFile?: (path: string) => Promise<string>;
}

export interface SkillToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
    additionalProperties?: boolean;
  };
  strict?: boolean;
  handler?: (args: any, context: SkillToolExecutionContext) => Promise<string>;
}

export type SkillInvocationPolicy = 'auto' | 'manual' | 'agent-decides';

export interface KaviSkillRequirements {
  bins?: string[];
  anyBins?: string[];
  env?: string[];
  config?: string[];
}

export type SkillExecutionSurface =
  | 'local-mobile'
  | 'local-js'
  | 'mcp'
  | 'ssh'
  | 'workspace'
  | 'browser-job'
  | 'expo-eas';

export interface SkillEligibilityContext {
  platform?: string;
  availableSurfaces?: SkillExecutionSurface[];
  hasSecret?: (secretName: string) => boolean;
  supportsConfigPath?: (configPath: string) => boolean;
}

export interface KaviSkillInstallSpec {
  id?: string;
  kind: string;
  label?: string;
  bins?: string[];
  os?: string[];
  formula?: string;
  package?: string;
  module?: string;
  url?: string;
  archive?: string;
  extract?: boolean;
  stripComponents?: number;
  targetDir?: string;
}

export interface SkillInstallSpec {
  source: 'bundled' | 'url' | 'clawhub' | 'manual';
  url?: string;
  id?: string;
  version?: string;
  managedDir?: string;
  managedFiles?: string[];
  managedBinaryFiles?: string[];
}

export interface BundledPythonSkillMetadata {
  scriptPaths: string[];
  dependencies?: string[];
  pyodideCompatible?: boolean;
}

export interface SkillMetadata {
  name: string;
  description: string;
  version: string;
  author?: string;
  tags?: string[];
  skillKey?: string;
  always?: boolean;
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  os?: string[];
  requires?: KaviSkillRequirements;
  install?: KaviSkillInstallSpec[];
  preferredSurface?: SkillExecutionSurface;
  surfaces?: SkillExecutionSurface[];
  invocationPolicy?: SkillInvocationPolicy;
  requiredSecrets?: string[];
  tools?: string[];
  bundledPython?: BundledPythonSkillMetadata;
}

export interface SkillEntry {
  id: string;
  metadata: SkillMetadata;
  enabled: boolean;
  installedAt: number;
  source: SkillInstallSpec;
  systemPrompt?: string;
  hooks?: SkillHookSpec[];
}

export interface SkillHookSpec {
  event: string;
  action?: string;
  prompt: string;
}

export interface SkillSnapshot {
  skills: SkillEntry[];
  lastUpdated: number;
}
