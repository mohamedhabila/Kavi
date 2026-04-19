// ---------------------------------------------------------------------------
// Kavi — Core Types
// ---------------------------------------------------------------------------

import type { Locale } from '../i18n/types';

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  /** Provider-specific raw tool call payload for exact multi-turn replay. */
  raw?: Record<string, any>;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: number;
  updatedAt?: number;
  completedAt?: number;
  progressText?: string;
  result?: string;
  error?: string;
}

export type WebSearchProvider = 'auto' | 'brave' | 'perplexity' | 'grok' | 'kimi' | 'gemini';

export interface ModelCapabilities {
  vision: boolean;
  tools: boolean;
  fileInput: boolean;
}

export interface Attachment {
  id: string;
  type: 'image' | 'file' | 'audio';
  uri: string;
  name: string;
  mimeType: string;
  size: number;
  base64?: string;
  workspacePath?: string;
  durationMs?: number;
  transcript?: string;
  waveformLevels?: number[];
}

export interface MessageProviderReplay {
  /** OpenAI Responses response ID for canonical continuation via previous_response_id. */
  openaiResponseId?: string;
  /** Exact OpenAI Responses output items for replay on subsequent turns. */
  openaiResponseOutput?: Record<string, any>[];
  /** Exact Gemini candidate parts, including thought signatures and function-call IDs. */
  geminiParts?: Record<string, any>[];
  /** Exact Anthropic assistant content blocks for native multi-turn replay. */
  anthropicBlocks?: Record<string, any>[];
}

export type AssistantCompletionStatus = 'complete' | 'incomplete';

export interface AssistantCompletionMetadata {
  completionStatus: AssistantCompletionStatus;
  finishReason?: string;
}

export type AssistantMessageKind = 'intermediate' | 'final';

export interface AssistantMessageMetadata extends AssistantCompletionMetadata {
  kind: AssistantMessageKind;
}

export type SubAgentStatus = 'running' | 'completed' | 'timeout' | 'error' | 'cancelled';

export type SubAgentSandboxPolicy = 'full' | 'safe-only' | 'inherit';

export type SubAgentLaunchState = 'queued' | 'bootstrapping' | 'active' | 'finalizing' | 'terminal';

export type SubAgentLifecycleEvent = 'started' | 'completed' | 'timeout' | 'error' | 'cancelled';

export interface SubAgentActivityEntry {
  timestamp: number;
  kind: 'status' | 'tool' | 'result' | 'message';
  text: string;
}

export interface SubAgentSnapshot {
  sessionId: string;
  parentConversationId: string;
  parentSessionId?: string;
  agentRunId?: string;
  workstreamId?: string;
  name?: string;
  depth: number;
  startedAt: number;
  updatedAt: number;
  deadlineAt?: number;
  status: SubAgentStatus;
  sandboxPolicy: SubAgentSandboxPolicy;
  launchState?: SubAgentLaunchState;
  output?: string;
  toolsUsed?: string[];
  iterations?: number;
  lastProgressAt?: number;
  modelResponsePendingSince?: number;
  currentActivity?: string;
  activeToolName?: string;
  activeToolStartedAt?: number;
  lastToolResultPreview?: string;
  activityLog?: SubAgentActivityEntry[];
  artifacts?: Attachment[];
}

export interface SubAgentMessageEvent {
  type: 'sub-agent';
  event: SubAgentLifecycleEvent;
  snapshot: SubAgentSnapshot;
}

export interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  enrichedContent?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  timestamp: number;
  attachments?: Attachment[];
  isError?: boolean;
  reasoning?: string;
  providerReplay?: MessageProviderReplay;
  assistantMetadata?: AssistantMessageMetadata;
  effectId?: 'confetti' | 'balloons' | 'spotlight';
  subAgentEvent?: SubAgentMessageEvent;
}

export interface ConversationUsageEntry {
  model: string;
  providerId?: string;
  source?: ConversationUsageSource;
  modality?: 'image';
  toolCallId?: string;
  sessionId?: string;
  parentSessionId?: string;
  agentRunId?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  estimatedCost: number;
  tokenDetails?: UsageTokenDetails;
  timestamp: number;
}

export interface ConversationUsageSummary {
  entries: ConversationUsageEntry[];
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalTokens: number;
  totalCost: number;
  totalCalls: number;
  lastModel?: string;
  lastProviderId?: string;
  lastUpdatedAt?: number;
}

export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type AgentRunPhaseKey = 'assess' | 'plan' | 'work' | 'review' | 'pilot' | 'deliver';

export type AgentRunPhaseStatus = 'pending' | 'active' | 'completed' | 'failed' | 'skipped';

export interface AgentRunPhase {
  key: AgentRunPhaseKey;
  title: string;
  status: AgentRunPhaseStatus;
  detail?: string;
  updatedAt: number;
}

export type AgentRunCheckpointKind = 'run' | 'phase' | 'tool' | 'sub-agent' | 'note';

export interface AgentRunCheckpoint {
  id: string;
  timestamp: number;
  kind: AgentRunCheckpointKind;
  title: string;
  detail?: string;
}

export interface AgentRunSummary {
  assistantTurns: number;
  startedTools: number;
  completedTools: number;
  failedTools: number;
  spawnedSubAgents: number;
  durationMs?: number;
}

export interface AgentRunWorkstream {
  id: string;
  title: string;
  goal?: string;
  successCriteria?: string[];
  dependencies?: string[];
}

export interface AgentRunPlan {
  objective: string;
  successCriteria: string[];
  stopConditions: string[];
  workstreams: AgentRunWorkstream[];
  rawPlan?: string;
  updatedAt: number;
}

export type AgentRunEvidenceKind =
  | 'fact'
  | 'source'
  | 'decision'
  | 'risk'
  | 'question'
  | 'artifact'
  | 'summary';

export type AgentRunEvidenceStatus = 'candidate' | 'verified' | 'open' | 'resolved';

export type AgentRunEvidenceRecorder =
  | 'supervisor'
  | 'worker'
  | 'pilot'
  | 'python'
  | 'tool'
  | 'system';

export interface AgentRunEvidenceEntry {
  id: string;
  kind: AgentRunEvidenceKind;
  status: AgentRunEvidenceStatus;
  recorder: AgentRunEvidenceRecorder;
  title: string;
  content: string;
  dedupeKey?: string;
  sourceName?: string;
  sourceUri?: string;
  toolName?: string;
  workerSessionId?: string;
  artifactWorkspacePath?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export type AgentRunPilotCriterionStatus = 'met' | 'partial' | 'unmet' | 'blocked';

export type AgentRunPilotRecommendedAction = 'finalize' | 'continue' | 'blocked';

export type AgentRunPilotControlAction = 'accept' | 'continue' | 'block' | 'cancel';

export type AgentRunPilotEvaluationSource = 'provider' | 'heuristic' | 'unavailable';

export type AgentRunPilotFallbackReason =
  | 'no_provider_context'
  | 'request_failed'
  | 'response_unparseable';

export interface AgentRunPilotCriterionEvaluation {
  criterion: string;
  score: number;
  maxScore: number;
  status: AgentRunPilotCriterionStatus;
  rationale: string;
}

export interface AgentRunPilotEvaluation {
  evaluatorVersion: string;
  evaluatedAt: number;
  objective: string;
  completionScore: number;
  adherenceScore: number;
  evidenceScore: number;
  processScore: number;
  overallScore: number;
  maxOverallScore: number;
  approvalThreshold: number;
  approved: boolean;
  recommendedAction: AgentRunPilotRecommendedAction;
  controlAction: AgentRunPilotControlAction;
  confidence: 'low' | 'medium' | 'high';
  summary: string;
  rationale: string;
  source?: AgentRunPilotEvaluationSource;
  fallbackReason?: AgentRunPilotFallbackReason;
  stateSignature?: string;
  progressSignature?: string;
  strengths: string[];
  gaps: string[];
  nextActions: string[];
  criterionEvaluations: AgentRunPilotCriterionEvaluation[];
}

export type AgentRunAsyncOperationKind = 'session' | 'expo-workflow' | 'ssh-background-job';

export type AgentRunAsyncOperationStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout'
  | 'cancel_requested';

export interface AgentRunAsyncOperation {
  key: string;
  kind: AgentRunAsyncOperationKind;
  resourceId: string;
  displayName: string;
  status: AgentRunAsyncOperationStatus;
  lastUpdatedByTool: string;
  updatedAt: number;
  monitorToolNames: string[];
  statusArgs?: Record<string, unknown>;
  waitToolName?: string;
  waitArgs?: Record<string, unknown>;
}

export interface AgentRun {
  id: string;
  userMessageId: string;
  goal: string;
  status: AgentRunStatus;
  awaitingBackgroundWorkers?: boolean;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  currentPhase: AgentRunPhaseKey;
  phases: AgentRunPhase[];
  checkpoints: AgentRunCheckpoint[];
  plan?: AgentRunPlan;
  evidence?: AgentRunEvidenceEntry[];
  latestPilotEvaluation?: AgentRunPilotEvaluation;
  pendingAsyncOperations?: AgentRunAsyncOperation[];
  latestSummary?: string;
  summary: AgentRunSummary;
}

export type ConversationLogLevel = 'info' | 'success' | 'warning' | 'error';

export type ConversationLogKind =
  | 'system'
  | 'state'
  | 'tool'
  | 'usage'
  | 'compaction'
  | 'command'
  | 'error';

export interface ConversationLogEntry {
  id: string;
  timestamp: number;
  level: ConversationLogLevel;
  kind: ConversationLogKind;
  title: string;
  detail?: string;
}

export type ConversationMode = 'agentic' | 'direct';

export type LlmProviderKind = 'remote' | 'on-device';

export type LocalLlmRuntime = 'litert-lm' | 'mediapipe-genai';

export type LocalLlmBackend = 'cpu' | 'gpu';

export type LocalLlmPlatform = 'android' | 'ios';

export interface LocalLlmModelCatalogEntry {
  id: string;
  name: string;
  runtime: LocalLlmRuntime;
  fileName: string;
  repositoryId: string;
  downloadUrl: string;
  sizeBytes: number;
  sizeLabel: string;
  maxContextLength?: number;
  defaultMaxTokens?: number;
  defaultTopK?: number;
  defaultTopP?: number;
  defaultTemperature?: number;
  minDeviceMemoryGb?: number;
  supportedPlatforms: LocalLlmPlatform[];
  capabilities: ModelCapabilities;
  summary?: string;
}

export interface InstalledLocalLlmModel {
  modelId: string;
  fileName: string;
  localPath: string;
  installedAt: number;
  sizeBytes?: number;
  sourceUrl: string;
}

export interface LocalLlmProviderMetadata {
  runtime: LocalLlmRuntime;
  backend?: LocalLlmBackend;
  catalogModelIds?: string[];
  installedModels?: InstalledLocalLlmModel[];
}

export interface LastUsedModelSelection {
  providerId: string;
  model: string;
}

export type ThinkingLevelPreference = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  providerId: string;
  modelOverride?: string;
  systemPrompt: string;
  createdAt: number;
  updatedAt: number;
  personaId?: string;
  mode?: ConversationMode;
  folderId?: string;
  tags?: string[];
  pinned?: boolean;
  usage?: ConversationUsageSummary;
  logs?: ConversationLogEntry[];
  agentRuns?: AgentRun[];
  activeAgentRunId?: string;
}

export interface LlmProviderConfig {
  id: string;
  name: string;
  kind?: LlmProviderKind;
  baseUrl: string;
  apiKey: string;
  apiKeyRef?: string;
  model: string;
  availableModels?: string[];
  modelCapabilities?: Record<string, ModelCapabilities>;
  hiddenModels?: string[];
  local?: LocalLlmProviderMetadata;
  enabled: boolean;
}

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema: any;
}

export interface McpOAuthConfig {
  clientId?: string;
  clientSecretRef?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  scope?: string;
  projectNameForProxy?: string;
  tokenEndpointAuthMethod?: 'none' | 'client_secret_basic' | 'client_secret_post';
}

export type McpAuthMode = 'none' | 'header' | 'variable' | 'mixed' | 'oauth';

export interface McpCapabilityMetadata {
  transport: 'auto' | 'streamable-http' | 'sse';
  authMode: McpAuthMode;
  requiresConfiguration: boolean;
  requiresSecrets: boolean;
  inputCount: number;
}

export interface McpTrustMetadata {
  source: 'manual' | 'official-registry';
  registryName?: string;
  websiteUrl?: string;
}

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  token?: string;
  tokenRef?: string;
  headers?: Record<string, string>;
  transport?: 'auto' | 'streamable-http' | 'sse';
  sseUrl?: string;
  timeoutMs?: number;
  oauth?: McpOAuthConfig;
  enabled: boolean;
  tools: McpToolSchema[];
  allowedTools: string[];
  autoApprovedTools?: string[];
  trust?: McpTrustMetadata;
  capabilities?: McpCapabilityMetadata;
}

export interface SshTargetConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  remoteRoot?: string;
  hostKeyPolicy?: 'strict' | 'trust-on-first-use';
  trustedHostFingerprint?: string;
  authMode?: 'password' | 'private-key';
  passwordRef?: string;
  privateKeyRef?: string;
  passphraseRef?: string;
  ptyType?: 'vanilla' | 'vt100' | 'vt102' | 'vt220' | 'ansi' | 'xterm';
  enabled: boolean;
}

export interface WorkspaceTargetConfig {
  id: string;
  name: string;
  rootPath: string;
  configRoots?: string[];
  provider?:
    | 'code-server'
    | 'openvscode-server'
    | 'vscode-web'
    | 'vscode-tunnel'
    | 'cursor'
    | 'windsurf'
    | 'antigravity'
    | 'generic-vscode'
    | 'custom';
  baseUrl?: string;
  authMode?: 'none' | 'bearer' | 'query-token';
  accessTokenRef?: string;
  queryTokenParam?: string;
  browserProviderId?: string;
  sshTargetId?: string;
  aiTaskCommandTemplate?: string;
  enabled: boolean;
}

export interface BrowserProviderConfig {
  id: string;
  name: string;
  provider?: 'browserbase' | 'browserless' | 'custom';
  baseUrl?: string;
  authMode?: 'none' | 'api-key-header' | 'bearer' | 'query-token';
  apiKeyRef?: string;
  queryTokenParam?: string;
  projectId?: string;
  enabled: boolean;
}

export interface ExpoAccountConfig {
  id: string;
  name: string;
  owner: string;
  accountType?: 'personal' | 'robot';
  tokenRef?: string;
  lastProjectSyncAt?: number;
  lastProjectSyncError?: string;
  syncedProjectCount?: number;
  enabled: boolean;
}

export interface ExpoProjectConfig {
  id: string;
  easProjectId?: string;
  name: string;
  accountId: string;
  owner: string;
  slug: string;
  source?: 'manual' | 'account-sync';
  lastSyncedAt?: number;
  enabled: boolean;
  mode: 'eas-workflow' | 'direct-ssh' | 'github-workflow';
  sshTargetId?: string;
  projectPath?: string;
  repoFullName?: string;
  repoDefaultBranch?: string;
  availableWorkflowFiles?: string[];
  workflowFile?: string;
  workflowRef?: string;
  /** SecureStorage key ref for the GitHub token (github-workflow mode) */
  githubTokenRef?: string;
  defaultBuildProfile?: string;
  defaultUpdateBranch?: string;
  updateChannel?: string;
  webUrl?: string;
  previewUrl?: string;
  customDomain?: string;
  platforms?: Array<'android' | 'ios' | 'web'>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
    additionalProperties?: boolean | Record<string, any>;
    items?: Record<string, any> | Record<string, any>[];
    enum?: any[];
    anyOf?: Record<string, any>[];
    oneOf?: Record<string, any>[];
    allOf?: Record<string, any>[];
    [key: string]: any;
  };
  /** Defaults to auto: compatible schemas may be upgraded to strict mode by provider-specific request builders. Set to false to opt out. */
  strict?: boolean;
}

export type OrchestratorState = 'idle' | 'thinking' | 'responding' | 'error';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  model: string;
  tokenDetails?: UsageTokenDetails;
}

export interface UsageTokenDetails {
  inputTextTokens?: number;
  inputImageTokens?: number;
  outputTextTokens?: number;
  outputImageTokens?: number;
  outputThinkingTokens?: number;
}

export type ConversationUsageSource = 'primary' | 'sub-agent' | 'sub-agent-finalizer' | 'pilot';

export interface AppSettings {
  providers: LlmProviderConfig[];
  mcpServers: McpServerConfig[];
  sshTargets?: SshTargetConfig[];
  workspaceTargets?: WorkspaceTargetConfig[];
  browserProviders?: BrowserProviderConfig[];
  expoAccounts?: ExpoAccountConfig[];
  expoProjects?: ExpoProjectConfig[];
  activeProviderId: string | null;
  activeModel: string | null;
  lastUsedModel?: LastUsedModelSelection | null;
  thinkingLevel?: ThinkingLevelPreference;
  locale?: Locale;
  webSearchProvider?: WebSearchProvider;
  linkUnderstandingEnabled?: boolean;
  mediaUnderstandingEnabled?: boolean;
  maxLinks?: number;
  theme: 'light' | 'dark' | 'system';
  systemPrompt: string;
  defaultConversationMode?: ConversationMode;
}

export type RemoteTargetKind =
  | 'mcp-server'
  | 'ssh-host'
  | 'workspace'
  | 'browser-provider'
  | 'expo-project';

export type RemoteSessionKind =
  | 'ssh-shell'
  | 'workspace-view'
  | 'browser-live'
  | 'mcp-operation-stream';

export type RemoteJobKind = 'browser-job' | 'agent-job' | 'mcp-job' | 'workspace-task' | 'expo-job';

export type RemoteReadinessState = 'ready' | 'setup-required' | 'disabled' | 'error';

export interface RemoteArtifact {
  id: string;
  kind: 'screenshot' | 'transcript-excerpt' | 'diff' | 'log-snippet' | 'export-bundle';
  title: string;
  value?: string;
  uri?: string;
  mimeType?: string;
  createdAt: number;
}

export interface RemoteApprovalRequest {
  id: string;
  targetId?: string;
  toolName?: string;
  scope?: 'ssh' | 'workspace' | 'browser' | 'expo' | 'native' | 'other';
  jobId?: string;
  title: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  requestedAt: number;
  expiresAt?: number;
  resolvedAt?: number;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  riskReasons?: string[];
}

export interface RemoteJobRecord {
  id: string;
  jobType: RemoteJobKind;
  targetId?: string;
  providerId?: string;
  externalId?: string;
  status: 'queued' | 'running' | 'waiting-approval' | 'completed' | 'failed' | 'cancelled';
  requestedBy: 'user' | 'agent' | 'system';
  executionSurface: 'mcp' | 'ssh' | 'workspace' | 'browser-job' | 'expo-eas';
  summary: string;
  progressText?: string;
  approvalState?: RemoteApprovalRequest['status'];
  artifacts: RemoteArtifact[];
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface RemoteSessionRecord {
  id: string;
  targetId: string;
  providerId?: string;
  externalId?: string;
  kind: RemoteSessionKind;
  status: 'connecting' | 'connected' | 'error' | 'closed';
  startedAt: number;
  lastActivityAt: number;
  summary: string;
  reconnectable: boolean;
  liveViewUrl?: string;
  error?: string;
}

export interface RemoteTargetRecord {
  id: string;
  name: string;
  kind: RemoteTargetKind;
  providerLabel?: string;
  authState?: 'authenticated' | 'unauthenticated' | 'pending';
  readiness: RemoteReadinessState;
  launchable: boolean;
  statusLabel: string;
  detail: string;
  lastCheckedAt?: number;
  error?: string;
  activitySummary?: string;
}

// ---------------------------------------------------------------------------
// Gateway Types
// ---------------------------------------------------------------------------

export type GatewayConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface GatewayConfig {
  url: string;
  token: string;
  deviceName?: string;
  reconnect?: boolean;
  maxReconnectDelay?: number;
}

export interface GatewayCapability {
  name: string;
  description?: string;
  version?: string;
}

export interface GatewayMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

// ---------------------------------------------------------------------------
// Canvas / A2UI Types
// ---------------------------------------------------------------------------

export type CanvasSurfaceState = 'active' | 'hidden' | 'destroyed';

export type CanvasSourceType = 'content' | 'file' | 'directory';

export interface CanvasSourceBundle {
  sourceType: CanvasSourceType;
  filePath?: string;
  directoryPath?: string;
  entryFilePath?: string;
  importedFiles?: string[];
  bundleRootUri?: string;
  bundleEntryUri?: string;
}

export interface CanvasSurface {
  id: string;
  catalogId: string;
  title?: string;
  state: CanvasSurfaceState;
  renderMode?: 'components' | 'url' | 'html';
  url?: string;
  rawHtml?: string;
  sourceBundle?: CanvasSourceBundle;
  components: CanvasComponent[];
  dataModel: Record<string, any>;
  createdAt: number;
}

export interface CanvasComponent {
  id: string;
  type: string;
  props: Record<string, any>;
  children?: CanvasComponent[];
  dataBindings?: Record<string, string>;
}

export interface CanvasAction {
  type:
    | 'createSurface'
    | 'updateContent'
    | 'updateComponents'
    | 'updateDataModel'
    | 'deleteSurface'
    | 'navigate'
    | 'eval'
    | 'snapshot';
  surfaceId: string;
  payload: any;
}

// ---------------------------------------------------------------------------
// Embedding Memory Types
// ---------------------------------------------------------------------------

export type EmbeddingProvider = 'openai' | 'gemini' | 'voyage' | 'mistral' | 'ollama';

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  dimensions?: number;
}

export interface MemorySearchResult {
  source: string;
  snippet: string;
  score: number;
  scope?: 'global' | 'conversation' | 'daily';
  embedding?: number[];
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  tokens?: number;
}

// ---------------------------------------------------------------------------
// Hook System Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// OAuth Types
// ---------------------------------------------------------------------------

export type OAuthProvider = 'google' | 'github' | 'openai' | 'anthropic';

export interface OAuthProfile {
  provider: OAuthProvider;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  email?: string;
  name?: string;
  avatarUrl?: string;
}

// ---------------------------------------------------------------------------
// ClawHub Registry Types
// ---------------------------------------------------------------------------

export interface ClawHubSkill {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  tags: string[];
  downloads: number;
  rating: number;
  installUrl: string;
}

export interface ClawHubSearchResult {
  skills: ClawHubSkill[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ClawHubListResult {
  skills: ClawHubSkill[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Sub-Agent Types
// ---------------------------------------------------------------------------

export interface SubAgentConfig {
  parentConversationId: string;
  prompt: string;
  initialMessages?: Message[];
  workspaceConversationId?: string;
  model?: string;
  providerId?: string;
  agentRunId?: string;
  workstreamId?: string;
  inheritMemory?: boolean;
  inheritTools?: boolean;
  linkUnderstandingEnabled?: boolean;
  mediaUnderstandingEnabled?: boolean;
  maxIterations?: number;
  timeoutMs?: number;
  depth?: number;
  sandboxPolicy?: 'full' | 'safe-only' | 'inherit';
  announce?: boolean;
  parentSessionId?: string;
  systemPrompt?: string;
  name?: string;
  tools?: string[];
}

export interface SubAgentResult {
  sessionId: string;
  output: string;
  toolsUsed: string[];
  iterations: number;
  status: 'completed' | 'timeout' | 'error' | 'cancelled';
  error?: string;
  depth: number;
  artifacts?: Attachment[];
}

// ---------------------------------------------------------------------------
// Usage Tracking Types
// ---------------------------------------------------------------------------

export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  tokenDetails?: UsageTokenDetails;
}

export interface SessionUsage {
  conversationId: string;
  entries: UsageEntry[];
  totalInput: number;
  totalOutput: number;
  totalCacheRead?: number;
  totalCacheWrite?: number;
  totalCost: number;
}

export interface UsageEntry {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  timestamp: number;
  estimatedCost?: number;
}

// ---------------------------------------------------------------------------
// Settings Import/Export Types
// ---------------------------------------------------------------------------

export interface ExportedSettings {
  version: number;
  exportedAt: number;
  settings: Partial<AppSettings>;
  omittedSensitiveData?: string[];
  hooks?: HookDefinition[];
  skills?: Array<{ metadata: any; source: any; systemPrompt?: string; hooks?: any[] }>;
}

// ---------------------------------------------------------------------------
// BOOT.md Types
// ---------------------------------------------------------------------------

export interface BootConfig {
  enabled: boolean;
  content?: string;
  lastRunAt?: number;
  lastStatus?: 'ran' | 'skipped' | 'failed';
}

export interface BootRunResult {
  status: 'ran' | 'skipped' | 'failed';
  reason?: string;
  output?: string;
}
