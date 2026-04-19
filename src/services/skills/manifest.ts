import { Platform } from 'react-native';
import { getFrontmatterString, normalizeStringList } from '../markdown/frontmatter';
import type {
  KaviSkillInstallSpec,
  KaviSkillRequirements,
  SkillEligibilityContext,
  SkillExecutionSurface,
  SkillMetadata,
} from './types';
import { isHttpOnlyPythonSkill, isPyodideCompatibleSkill } from './mobileTranslator';

type ManifestFallback = Partial<
  Pick<
    SkillMetadata,
    'name' | 'description' | 'version' | 'author' | 'tags' | 'skillKey' | 'primaryEnv' | 'tools'
  >
>;

export interface SkillSecretField {
  storageKey: string;
  label: string;
  placeholder: string;
  hint: string;
}

export interface SkillCompatibilityResult {
  compatible: boolean;
  status: 'ready' | 'setup-required' | 'requires-external-surface' | 'unsupported';
  reason?: string;
  alternative?: SkillSecretField;
  preferredSurface: SkillExecutionSurface | null;
  suggestedSurfaces: SkillExecutionSurface[];
  availableSurfaces: SkillExecutionSurface[];
  unavailableSurfaces: SkillExecutionSurface[];
  requiredSecrets: string[];
}

const SKILL_EXECUTION_SURFACES: SkillExecutionSurface[] = [
  'local-mobile',
  'local-js',
  'mcp',
  'ssh',
  'workspace',
  'browser-job',
  'expo-eas',
];

const DEFAULT_ELIGIBILITY_SURFACES: SkillExecutionSurface[] = ['local-mobile'];

const SKILL_SURFACE_LABELS: Record<SkillExecutionSurface, string> = {
  'local-mobile': 'Mobile',
  'local-js': 'Local JS',
  mcp: 'MCP',
  ssh: 'SSH',
  workspace: 'Workspace',
  'browser-job': 'Browser job',
  'expo-eas': 'Expo / EAS',
};

const KNOWN_SECRET_FIELDS: Record<string, SkillSecretField> = {
  ALPHA_VANTAGE_API_KEY: {
    storageKey: 'ALPHA_VANTAGE_API_KEY',
    label: 'Alpha Vantage API Key',
    placeholder: 'alpha-vantage-key',
    hint: 'Enables the built-in finance skill for stock quotes.',
  },
  BRAVE_API_KEY: {
    storageKey: 'BRAVE_API_KEY',
    label: 'Brave Search API Key',
    placeholder: 'BSA...',
    hint: 'Used when web search runs through Brave.',
  },
  FIRECRAWL_API_KEY: {
    storageKey: 'FIRECRAWL_API_KEY',
    label: 'Firecrawl API Key',
    placeholder: 'fc-...',
    hint: 'Fallback extractor for difficult web pages.',
  },
  GITHUB_TOKEN: {
    storageKey: 'GITHUB_TOKEN',
    label: 'GitHub Personal Access Token',
    placeholder: 'github_pat_...',
    hint: 'Enables the built-in GitHub repositories, files, branches, commits, issues, and pull requests skill.',
  },
  GOOGLE_API_KEY: {
    storageKey: 'GOOGLE_API_KEY',
    label: 'Google AI API Key',
    placeholder: 'AIza...',
    hint: 'Used for Gemini web search with Vertex AI or Google AI Studio.',
  },
  KIMI_API_KEY: {
    storageKey: 'KIMI_API_KEY',
    label: 'Kimi API Key',
    placeholder: 'sk-...',
    hint: 'Used for Moonshot Kimi web search.',
  },
  OPENWEATHER_API_KEY: {
    storageKey: 'OPENWEATHER_API_KEY',
    label: 'OpenWeather API Key',
    placeholder: 'weather-key',
    hint: 'Enables the built-in weather skill.',
  },
  PERPLEXITY_API_KEY: {
    storageKey: 'PERPLEXITY_API_KEY',
    label: 'Perplexity API Key',
    placeholder: 'pplx-...',
    hint: 'Used for Perplexity web search.',
  },
  XAI_API_KEY: {
    storageKey: 'XAI_API_KEY',
    label: 'xAI API Key',
    placeholder: 'xai-...',
    hint: 'Used for Grok web search.',
  },
};

const MOBILE_ALTERNATIVES: Record<string, keyof typeof KNOWN_SECRET_FIELDS> = {
  finance: 'ALPHA_VANTAGE_API_KEY',
  github: 'GITHUB_TOKEN',
  weather: 'OPENWEATHER_API_KEY',
};

const BROWSER_HINT_PATTERN =
  /\b(browser|playwright|scrap|crawl|screenshot|pdf|captcha|automation)\b/i;
const MCP_HINT_PATTERN = /\bmcp\b/i;
const LOCAL_JS_HINT_PATTERN = /\b(local-js|local js|javascript helper|js helper)\b/i;
const LOCAL_PYTHON_HINT_PATTERN = /\b(local-python|python helper|pyodide)\b/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => Boolean(value && value.trim()))
        .map((value) => value.trim()),
    ),
  );
}

function normalizeOsList(value: unknown): string[] | undefined {
  const normalized = normalizeStringList(value);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeRequirements(value: unknown): KaviSkillRequirements | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const requirements: KaviSkillRequirements = {
    bins: normalizeStringList(value.bins),
    anyBins: normalizeStringList(value.anyBins),
    env: normalizeStringList(value.env),
    config: normalizeStringList(value.config),
  };

  if (
    !requirements.bins?.length &&
    !requirements.anyBins?.length &&
    !requirements.env?.length &&
    !requirements.config?.length
  ) {
    return undefined;
  }

  return requirements;
}

function isSkillExecutionSurface(value: string): value is SkillExecutionSurface {
  return SKILL_EXECUTION_SURFACES.includes(value as SkillExecutionSurface);
}

function normalizeExecutionSurface(value: unknown): SkillExecutionSurface | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return isSkillExecutionSurface(normalized) ? normalized : undefined;
}

function normalizeExecutionSurfaces(value: unknown): SkillExecutionSurface[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(
      value
        .map((entry) => normalizeExecutionSurface(entry))
        .filter((entry): entry is SkillExecutionSurface => Boolean(entry)),
    ),
  );

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeInstallSpecs(value: unknown): KaviSkillInstallSpec[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const specs = value.filter(isRecord).map((item) => ({
    id: typeof item.id === 'string' ? item.id : undefined,
    kind: typeof item.kind === 'string' ? item.kind : 'unknown',
    label: typeof item.label === 'string' ? item.label : undefined,
    bins: normalizeStringList(item.bins),
    os: normalizeOsList(item.os),
    formula: typeof item.formula === 'string' ? item.formula : undefined,
    package: typeof item.package === 'string' ? item.package : undefined,
    module: typeof item.module === 'string' ? item.module : undefined,
    url: typeof item.url === 'string' ? item.url : undefined,
    archive: typeof item.archive === 'string' ? item.archive : undefined,
    extract: typeof item.extract === 'boolean' ? item.extract : undefined,
    stripComponents: typeof item.stripComponents === 'number' ? item.stripComponents : undefined,
    targetDir: typeof item.targetDir === 'string' ? item.targetDir : undefined,
  }));

  return specs.length > 0 ? specs : undefined;
}

function normalizeSkillKey(value: string | undefined): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniqueSurfaces(values: Array<SkillExecutionSurface | undefined>): SkillExecutionSurface[] {
  const seen = new Set<SkillExecutionSurface>();
  const ordered: SkillExecutionSurface[] = [];

  for (const surface of values) {
    if (!surface || seen.has(surface)) {
      continue;
    }
    seen.add(surface);
    ordered.push(surface);
  }

  return SKILL_EXECUTION_SURFACES.filter((surface) => ordered.includes(surface));
}

function formatSurfaceList(surfaces: SkillExecutionSurface[]): string {
  return surfaces.map((surface) => SKILL_SURFACE_LABELS[surface]).join(', ');
}

function defaultEligibilityContext(overrides?: SkillEligibilityContext): SkillEligibilityContext {
  return {
    platform: overrides?.platform || Platform.OS,
    availableSurfaces: overrides?.availableSurfaces || DEFAULT_ELIGIBILITY_SURFACES,
    hasSecret: overrides?.hasSecret,
    supportsConfigPath: overrides?.supportsConfigPath,
  };
}

function buildSkillHintText(metadata: SkillMetadata): string {
  return [
    metadata.name,
    metadata.description,
    metadata.skillKey,
    ...(metadata.tags || []),
    ...(metadata.tools || []),
    ...(metadata.requiredSecrets || []),
  ]
    .filter(Boolean)
    .join(' ');
}

function requiresRemoteExecution(metadata: SkillMetadata, skillBody?: string): boolean {
  const hasBins =
    (metadata.requires?.bins?.length || 0) > 0 || (metadata.requires?.anyBins?.length || 0) > 0;
  const hasConfig = (metadata.requires?.config?.length || 0) > 0;
  const hasInstall = (metadata.install?.length || 0) > 0;

  if (!hasBins && !hasConfig && !hasInstall) return false;

  // If the skill body is available, check if it's an HTTP-only Python skill.
  // Skills that only use urllib.request / requests for HTTP calls can be fully
  // served by web_fetch on mobile — no remote execution needed.
  if (skillBody && hasBins && !hasConfig) {
    const pythonBinsOnly = (metadata.requires?.bins || []).every((bin) =>
      /^(python3?|curl|uv)$/i.test(bin),
    );
    if (pythonBinsOnly && isHttpOnlyPythonSkill(skillBody)) {
      return false;
    }
  }

  return true;
}

function hasBrowserHint(metadata: SkillMetadata): boolean {
  const hints = buildSkillHintText(metadata);
  return BROWSER_HINT_PATTERN.test(hints);
}

function hasMcpHint(metadata: SkillMetadata): boolean {
  const hints = buildSkillHintText(metadata);
  return MCP_HINT_PATTERN.test(hints);
}

function hasLocalJsHint(metadata: SkillMetadata): boolean {
  const hints = buildSkillHintText(metadata);
  return LOCAL_JS_HINT_PATTERN.test(hints);
}

function hasLocalPythonHint(metadata: SkillMetadata): boolean {
  const hints = buildSkillHintText(metadata);
  return LOCAL_PYTHON_HINT_PATTERN.test(hints);
}

function inferSuggestedSurfaces(
  metadata: SkillMetadata,
  skillBody?: string,
): SkillExecutionSurface[] {
  const explicitSurfaces = metadata.surfaces || [];
  if (explicitSurfaces.length > 0) {
    return uniqueSurfaces([metadata.preferredSurface, ...explicitSurfaces]);
  }

  const remoteExecution = requiresRemoteExecution(metadata, skillBody);
  const browserJob = hasBrowserHint(metadata);
  const hintedMcp = hasMcpHint(metadata);
  const hintedLocalJs = hasLocalJsHint(metadata);
  const hintedLocalPython = hasLocalPythonHint(metadata);
  const localCandidate = metadata.always === true || (!remoteExecution && !browserJob);

  // Skills that are HTTP-only Python can run on local-mobile via web_fetch
  const httpOnlyPython = skillBody ? isHttpOnlyPythonSkill(skillBody) : false;
  // Skills whose Python is Pyodide-compatible can run in the embedded sandbox
  const pyodideCandidate =
    !httpOnlyPython && skillBody ? isPyodideCompatibleSkill(skillBody) : false;
  const bundledPyodideCandidate = metadata.bundledPython?.pyodideCompatible === true;

  return uniqueSurfaces([
    metadata.preferredSurface,
    localCandidate || httpOnlyPython ? 'local-mobile' : undefined,
    hintedLocalJs ? 'local-js' : undefined,
    hintedLocalPython || pyodideCandidate || bundledPyodideCandidate ? 'local-mobile' : undefined,
    hintedMcp ? 'mcp' : undefined,
    remoteExecution ? 'ssh' : undefined,
    remoteExecution ? 'workspace' : undefined,
    browserJob ? 'browser-job' : undefined,
  ]);
}

function resolvePreferredSurface(
  metadata: SkillMetadata,
  suggestedSurfaces: SkillExecutionSurface[],
): SkillExecutionSurface | null {
  if (metadata.preferredSurface && suggestedSurfaces.includes(metadata.preferredSurface)) {
    return metadata.preferredSurface;
  }
  return suggestedSurfaces[0] || null;
}

function isSurfaceAvailableForSkill(
  surface: SkillExecutionSurface,
  metadata: SkillMetadata,
  context: SkillEligibilityContext,
): boolean {
  if (!(context.availableSurfaces || DEFAULT_ELIGIBILITY_SURFACES).includes(surface)) {
    return false;
  }

  if (surface === 'workspace' && (metadata.requires?.config?.length || 0) > 0) {
    if (!context.supportsConfigPath) {
      return false;
    }

    return metadata.requires!.config!.every((configPath) =>
      context.supportsConfigPath!(configPath),
    );
  }

  return true;
}

function isOsCompatible(metadata: SkillMetadata, context: SkillEligibilityContext): boolean {
  const restrictedOs = metadata.os || [];
  if (restrictedOs.length === 0) {
    return true;
  }

  const platform = (context.platform || Platform.OS).toLowerCase();
  const normalized = restrictedOs.map((value) => value.toLowerCase());
  return (
    normalized.includes(platform) || normalized.includes('android') || normalized.includes('ios')
  );
}

function buildCompatibilityReason(
  metadata: SkillMetadata,
  suggestedSurfaces: SkillExecutionSurface[],
  requiredSecrets: string[],
  context: SkillEligibilityContext,
  availableSurfaces: SkillExecutionSurface[],
  skillBody?: string,
): { status: SkillCompatibilityResult['status']; reason?: string } {
  const restrictedOs = metadata.os || [];
  const requiresBins = uniqueStrings([
    ...(metadata.requires?.bins || []),
    ...(metadata.requires?.anyBins || []),
  ]);
  const requiresConfig = metadata.requires?.config || [];
  const installCount = metadata.install?.length || 0;
  if (metadata.tags?.includes('desktop-only')) {
    return {
      status: 'unsupported',
      reason: 'This skill is marked desktop-only.',
    };
  }

  if (!isOsCompatible(metadata, context)) {
    return {
      status: 'unsupported',
      reason: `This skill only supports: ${restrictedOs.join(', ')}.`,
    };
  }

  if (availableSurfaces.length === 0) {
    const segments: string[] = [];
    if (requiresBins.length > 0) {
      segments.push(`Requires local binaries: ${requiresBins.join(', ')}`);
    }
    if (requiresConfig.length > 0) {
      segments.push(`Requires desktop config: ${requiresConfig.join(', ')}`);
    }
    if (installCount > 0) {
      segments.push('Relies on desktop installers');
    }
    if (segments.length === 0 && suggestedSurfaces.length > 0) {
      segments.push(
        `Needs an execution surface that is not available yet: ${formatSurfaceList(suggestedSurfaces)}`,
      );
    }

    return {
      status: 'requires-external-surface',
      reason: `${segments.join('. ')}. Best route: ${formatSurfaceList(suggestedSurfaces)}.`,
    };
  }

  if (requiredSecrets.length > 0) {
    return {
      status: 'setup-required',
      reason: `Requires setup: ${requiredSecrets.join(', ')}.`,
    };
  }

  if (metadata.always === true && requiresRemoteExecution(metadata, skillBody)) {
    return {
      status: 'ready',
      reason:
        'Marked always-available by the skill author; the prompt may still reference external tooling.',
    };
  }

  return { status: 'ready' };
}

export function getSkillSurfaceLabel(surface: SkillExecutionSurface): string {
  return SKILL_SURFACE_LABELS[surface];
}

function humanizeSecretName(secretName: string): string {
  return secretName
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getSkillSecretField(secretName: string): SkillSecretField {
  return (
    KNOWN_SECRET_FIELDS[secretName] || {
      storageKey: secretName,
      label: humanizeSecretName(secretName),
      placeholder: secretName,
      hint: 'Stored securely on-device for this skill.',
    }
  );
}

export function getSkillRequiredSecrets(
  metadata: Pick<SkillMetadata, 'requiredSecrets' | 'primaryEnv' | 'requires'>,
): string[] {
  return uniqueStrings([
    ...(metadata.requiredSecrets || []),
    metadata.primaryEnv,
    ...(metadata.requires?.env || []),
  ]);
}

export function buildSkillMetadataFromFrontmatter(
  metadata: Record<string, unknown>,
  fallback: ManifestFallback = {},
): SkillMetadata | null {
  const name = getFrontmatterString(metadata, 'name') || fallback.name;
  if (!name) {
    return null;
  }

  const container = isRecord(metadata.metadata) ? metadata.metadata : undefined;
  const kavi =
    container && isRecord(container.kavi)
      ? container.kavi
      : container && isRecord(container.openclaw)
        ? container.openclaw
        : undefined;
  const allowedTools = normalizeStringList(metadata['allowed-tools']);
  const tools = normalizeStringList(metadata.tools);
  const requires = normalizeRequirements(kavi?.requires);
  const surfaces = normalizeExecutionSurfaces(kavi?.surfaces);
  const preferredSurface = normalizeExecutionSurface(kavi?.preferredSurface);
  const primaryEnv =
    getFrontmatterString(metadata, 'primaryEnv') ||
    (kavi ? getFrontmatterString(kavi, 'primaryEnv') : undefined) ||
    fallback.primaryEnv;
  const skillKey =
    getFrontmatterString(metadata, 'skillKey') ||
    (kavi ? getFrontmatterString(kavi, 'skillKey') : undefined) ||
    fallback.skillKey ||
    normalizeSkillKey(name);

  return {
    name,
    description: getFrontmatterString(metadata, 'description') || fallback.description || '',
    version: getFrontmatterString(metadata, 'version') || fallback.version || '0.0.0',
    author: getFrontmatterString(metadata, 'author') || fallback.author,
    tags: (() => {
      const tags = normalizeStringList(metadata.tags);
      return tags.length > 0 ? tags : fallback.tags;
    })(),
    skillKey,
    always: kavi?.always === true,
    primaryEnv,
    emoji: kavi ? getFrontmatterString(kavi, 'emoji') : undefined,
    homepage:
      getFrontmatterString(metadata, 'homepage') ||
      (kavi ? getFrontmatterString(kavi, 'homepage') : undefined),
    os: normalizeOsList(kavi?.os),
    requires,
    install: normalizeInstallSpecs(kavi?.install),
    preferredSurface,
    surfaces,
    invocationPolicy:
      (getFrontmatterString(metadata, 'invocationPolicy') as SkillMetadata['invocationPolicy']) ||
      'auto',
    requiredSecrets: getSkillRequiredSecrets({
      requiredSecrets: normalizeStringList(metadata.requiredSecrets),
      primaryEnv,
      requires,
    }),
    tools: tools.length > 0 ? tools : allowedTools.length > 0 ? allowedTools : fallback.tools,
  };
}

export function getSkillCompatibility(
  metadata: SkillMetadata,
  contextOverrides?: SkillEligibilityContext,
  skillBody?: string,
): SkillCompatibilityResult {
  const context = defaultEligibilityContext(contextOverrides);
  const normalizedName = normalizeSkillKey(metadata.skillKey || metadata.name);
  const alternativeKey = MOBILE_ALTERNATIVES[normalizedName];
  const alternative = alternativeKey ? KNOWN_SECRET_FIELDS[alternativeKey] : undefined;
  const secrets = getSkillRequiredSecrets(metadata);
  const missingSecrets = context.hasSecret
    ? secrets.filter((secretName) => !context.hasSecret!(secretName))
    : secrets;
  const suggestedSurfaces = inferSuggestedSurfaces(metadata, skillBody);
  const preferredSurface = resolvePreferredSurface(metadata, suggestedSurfaces);
  const availableSurfaces = suggestedSurfaces.filter((surface) =>
    isSurfaceAvailableForSkill(surface, metadata, context),
  );
  const unavailableSurfaces = suggestedSurfaces.filter(
    (surface) => !availableSurfaces.includes(surface),
  );
  const { status, reason } = buildCompatibilityReason(
    metadata,
    suggestedSurfaces,
    missingSecrets,
    context,
    availableSurfaces,
    skillBody,
  );
  const alternativeHint = alternative
    ? ` Use the built-in ${alternative.label} flow on mobile.`
    : '';

  return {
    compatible: status === 'ready' || status === 'setup-required',
    status,
    reason: reason ? `${reason}${alternativeHint}` : undefined,
    alternative,
    preferredSurface,
    suggestedSurfaces,
    availableSurfaces,
    unavailableSurfaces,
    requiredSecrets: missingSecrets,
  };
}
