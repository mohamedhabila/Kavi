export type WebSearchProvider = 'auto' | 'brave' | 'gemini' | 'perplexity' | 'grok' | 'kimi';

export interface ModelCapabilities {
  vision: boolean;
  tools: boolean;
  fileInput: boolean;
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
  /**
   * Provider request placement metadata. The graph sets this per turn so
   * prompt-cache builders can keep reusable tool declarations before dynamic
   * tool suffixes without changing the executable tool surface.
   */
  promptCache?: {
    placement?: 'stable_prefix' | 'dynamic_suffix';
  };
  /**
   * Optional explicit execution contract for this tool.
   * When present, orchestration should prefer this metadata over
   * inferring semantics from English tool names.
   */
  contract?: {
    category?: string;
    capabilities?: string[];
    /**
     * Declares that the caller can bound this tool's result size through its own
     * arguments, so the result never grows unbounded. Spilling such a result to the
     * workspace does not save context — the model still needs the content and reads
     * the file straight back, paying an extra tool call and an extra prompt re-send
     * for bytes it explicitly asked for.
     */
    boundedOutput?: boolean;
    resourceKinds?: string[];
    sideEffects?: string[];
    riskHints?: string[];
    riskLevel?: 'low' | 'medium' | 'high' | 'critical';
    prerequisites?: string[];
    /**
     * Runtime conditions that must hold for this tool to be able to work at all, such
     * as a configured provider or a reachable target. Availability is evaluated from
     * these declarations, so a tool that cannot function is never advertised on the
     * turn surface and never costs a model round-trip on a call that can only fail.
     */
    runtimeRequirements?: string[];
    permissionPrerequisites?: string[];
    recoverableErrors?: string[];
    providesEvidence?: string[];
    workflowStages?: string[];
    produces?: Array<{ kind: string; field?: string }>;
    consumes?: Array<{ kind: string; field?: string; required?: boolean }>;
    precedes?: string[];
    requiresPermissionEvidence?: string[];
    inputExamples?: Array<Record<string, unknown>>;
    outputSchema?: Record<string, unknown>;
  };
}
