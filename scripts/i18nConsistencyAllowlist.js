// ---------------------------------------------------------------------------
// check-i18n-consistency.js — identical-to-English allowlist data
// ---------------------------------------------------------------------------
// Split out of check-i18n-consistency.js purely to stay under this repo's
// per-file line budget (see check:maintainability): this module is data,
// the parent script is the logic that consumes it, and the two are one
// "check:i18n" concern spread across two files, not two separate scripts.
//
// A handful of keys are legitimately identical in every language — a brand
// name, a protocol acronym, a format string that is pure placeholders — and
// those are named explicitly below rather than guessed at with a pattern,
// per the project's "no heuristics over natural-language text" rule: this
// is an explicit allowlist of *keys* (or, for cognates, *values*), not a
// rule that inspects the string's language.

// Brand names, acronyms, and protocol/provider names with no translation in
// any of the nine locales — kept in every language by design.
const GLOBAL_IDENTICAL_ALLOWLIST = new Set([
  'common.appName', // "Kavi" — the product name
  'common.ok', // "OK" is used as-is internationally
  'voice.kavi', // "Kavi" — the product name
  'onboarding.appIconAccessibility', // contains "Kavi"; see per-locale notes below for the rest
  'terminal.modeJavascript', // "JavaScript" — proper noun, the language name
  'codeEditor.sshLabel', // "SSH" — protocol acronym
  'artifactCard.type.pdf', // "PDF" — file-format acronym
  'onboarding.providers.openai.title', // "OpenAI" — brand name
  'onboarding.providers.anthropic.title', // "Anthropic" — brand name
  'onboarding.providers.gemini.title', // "Gemini" — brand name
  'onboarding.providers.openrouter.title', // "OpenRouter" — brand name
  'onboarding.webProviders.brave.title', // "Brave" — brand name
  'onboarding.webProviders.gemini.title', // "Gemini" — brand name
  'onboarding.webProviders.perplexity.title', // "Perplexity" — brand name
  'onboarding.webProviders.grok.title', // "Grok / xAI" — brand name
  'onboarding.webProviders.kimi.title', // "Kimi" — brand name
  'onboarding.webProviders.anthropic.title', // "Anthropic" — brand name
  'onboarding.webProviders.openai.title', // "OpenAI" — brand name
  'onboarding.services.brave.title', // "Brave Search API" — brand name
  'onboarding.services.gemini.title', // "Gemini API" — brand name
  'onboarding.services.perplexity.title', // "Perplexity API" — brand name
  'onboarding.services.xai.title', // "xAI API" — brand name
  'onboarding.services.kimi.title', // "Kimi API" — brand name
  'onboarding.services.firecrawl.title', // "Firecrawl" — brand name
  'onboarding.services.openweather.title', // "OpenWeather" — brand name
  'onboarding.services.github.title', // "GitHub Personal Access Token" — brand name
  'onboarding.services.alphaVantage.title', // "Alpha Vantage" — brand name
  'remoteWork.providerCodeServer', // "code-server" — software name
  'remoteWork.providerVSCodeWeb', // "VS Code Web" — software name
  'remoteWork.providerVSCodeTunnel', // "VS Code Tunnel" — software name
  'remoteWork.providerCursor', // "Cursor" — software name
  'remoteWork.providerWindsurf', // "Windsurf" — software name
  'remoteWork.providerAntigravity', // "Antigravity" — software name
  'remoteWork.providerOpenVSCode', // "OpenVSCode" — software name
  'remoteWork.providerBrowserbase', // "Browserbase" — brand name
  'remoteWork.providerBrowserless', // "Browserless" — brand name
  // Format-only strings: every character outside the placeholders is
  // punctuation, so there is nothing to translate.
  'common.secondsShort',
  'common.millisecondsShort',
  'common.versionShort',
  'activity.filterLabelWithCount',
  'chat.fetchBatchMore',
  'mcpStatus.more',
  'mcpStatus.version',
  'settings.home.appearanceSummary',
  'settings.expoProjectsSyncedCount',
  'remoteWork.expoProjectsSyncedCount',
  'memory.diagnosticsBudgetEntry',
  'toolApproval.details.limit',
  'toolApproval.details.scheme',
  'toolApproval.details.mimeType',
  'toolApproval.details.commandExecutable',
  'toolApproval.details.defaultCountry',
  'assistantExport.statusLine',
  'assistantExport.nameLine',
  'assistantExport.depthLine',
  'assistantExport.sessionLine',
  'assistantExport.timestampLine',
  'assistantExport.generated',
  'assistantExport.segmentHeading',
  'assistantExport.attachmentSizeBytes',
  'assistantExport.attachmentWorkspacePath',
  'gateway.online', // "online" status word kept lowercase/untranslated by design in the connection log
  'nav.gateway', // "Gateway" — same technical feature name as the gateway.* namespace below
]);

// Genuine cognates: words spelled identically (or, for German, identically
// once capitalized as a noun) in English and one other specific language,
// by shared Latin/international root — not a translator skipping the key.
// Verified by checking the same concept is translated correctly elsewhere
// in that locale's file; these are the specific spots where the two
// languages' words coincide. Keyed by the *value*, not the key, since the
// same loanword recurs across several unrelated keys (e.g. "Code" labels
// both a message-formatting toggle and a file-type filter).
const PER_LOCALE_COGNATE_VALUES = {
  de: new Set([
    'Name',
    'Audio',
    'Code',
    'Screenshot',
    'Iteration {iteration}',
    'System',
    'Persona: {to}',
    'Chat',
    'Tokens',
    'Version',
    'Details: {detail}',
    'Browser',
    'Chats',
    'Terminal',
    'Persona: {name}',
    'Optional',
    'Minimal',
  ]),
  es: new Set([
    'Error',
    'Audio',
    'Persona: {to}',
    'Chat',
    'Tokens',
    'Chats',
    'Terminal',
    'Persona: {name}',
    'Ollama (local)',
    'min',
  ]),
  fr: new Set([
    'Description',
    'Conversation',
    'Session {id}',
    'Session',
    'Instructions',
    'Assistant',
    'Action',
    'Destination',
    'Archive',
    'Audio',
    'Code',
    'Document',
    'Image',
    'Surface {id}',
    'Cache',
    'Version',
    'Documents',
    'Images',
    'Diagnostics',
    'Vision',
    'Guide',
    'Minimal',
    'Ollama (local)',
    'min',
    'Terminal',
  ]),
  'pt-BR': new Set([
    'Persona: {to}',
    'Chat',
    'Cache',
    'Tokens',
    'Terminal',
    'Ollama (local)',
    'Persona: {name}',
    'min',
  ]),
};

// Example/placeholder VALUES shown (greyed out) inside empty form fields —
// URLs, slugs, credential formats, cron expressions, code snippets. These
// are illustrative data, not prose, so they stay in their original form in
// every locale (a translated "https://api.openai.com/v1" would just be a
// broken example).
const PLACEHOLDER_EXAMPLE_ALLOWLIST = new Set([
  'settings.baseUrlPlaceholder',
  'settings.apiKeyPlaceholder',
  'settings.defaultModelPlaceholder',
  'settings.serverUrlPlaceholder',
  'settings.serverHeadersPlaceholder',
  'settings.serverLegacySseUrlPlaceholder',
  'settings.sshHostPlaceholder',
  'settings.sshUsernamePlaceholder',
  'settings.sshRemoteRootPlaceholder',
  'settings.sshTrustedFingerprintPlaceholder',
  'settings.sshPasswordPlaceholder',
  'settings.sshPrivateKeyPlaceholder',
  'settings.sshPassphrasePlaceholder',
  'settings.workspaceRootPathPlaceholder',
  'settings.workspaceBaseUrlPlaceholder',
  'settings.workspaceAccessTokenPlaceholder',
  'settings.workspaceQueryTokenParamPlaceholder',
  'settings.browserBaseUrlPlaceholder',
  'settings.browserProjectIdPlaceholder',
  'settings.browserQueryTokenParamPlaceholder',
  'settings.expoAccountNamePlaceholder',
  'settings.expoOwnerPlaceholder',
  'settings.expoAccessTokenPlaceholder',
  'settings.expoProjectNamePlaceholder',
  'settings.expoProjectSlugPlaceholder',
  'settings.expoProjectPathPlaceholder',
  'settings.expoGithubRepositoryPlaceholder',
  'settings.expoWorkflowFilePlaceholder',
  'settings.expoWorkflowRefPlaceholder',
  'settings.expoDefaultBuildProfilePlaceholder',
  'settings.expoDefaultUpdateBranchPlaceholder',
  'settings.expoUpdateChannelPlaceholder',
  'settings.expoProductionWebUrlPlaceholder',
  'settings.expoPreviewUrlPlaceholder',
  'settings.expoCustomDomainPlaceholder',
  'scheduler.cronPlaceholder',
  'scheduler.intervalPlaceholder',
  'skills.toolNamesPlaceholder',
  'skills.requiredSecretsPlaceholder',
  'skills.urlPlaceholder',
  'gateway.urlPlaceholder',
  'remoteWork.shellCommandPlaceholder',
  'remoteWork.expoWorkflowBranchPlaceholder',
  'remoteWork.workspaceAiCommandTemplateCursorPlaceholder',
  'remoteWork.workspaceAiCommandTemplateDefaultPlaceholder',
  'onboarding.apiKeyPlaceholder',
]);

// Whole namespaces that are advanced/developer-facing configuration surfaces
// (SSH targets, MCP servers, workspace/browser-provider setup, Expo/EAS,
// Gateway nodes, exported-transcript metadata) rather than the everyday
// assistant experience the i18n audit targets. Their field labels, hints,
// and validation copy are internationally-standard technical terms
// (Bearer token, Host Key Verification, Query Token Parameter, ...): kept
// in English is the industry norm for this class of screen, the same way
// most localized developer tools keep "SSH" / "API Key" / "Query Param"
// untranslated. Reachable only from Settings' "Developer & remote work"
// section, gated behind Developer Mode.
const TECHNICAL_NAMESPACE_PREFIXES = [
  'settings.ssh',
  'settings.server', // MCP server connection fields
  'settings.workspace',
  'settings.browser',
  'settings.expo',
  'settings.mcpOAuth',
  'settings.onDeviceProviderTitle',
  'settings.onDeviceProviderHint',
  'remoteWork.',
  'gateway.',
  'mcpStatus.',
  'codeEditor.workspaceLabel',
  'assistantExport.',
];

// A handful of words are genuine cognates in one specific language — spelled
// identically to English by shared Latin root, not because a translator
// skipped them (verified by checking the surrounding file: these locales
// translate the same concept correctly elsewhere; these particular keys
// just happen to be the one spelling where the two languages coincide).
const PER_LOCALE_IDENTICAL_ALLOWLIST = {
  fr: new Set([
    'agentRoster.personasTab', // "Style"/"Styles" — standard French vocabulary, same spelling as English
    'memory.episodeSources', // "source"/"sources" — standard French vocabulary, same spelling as English
    'settings.home.stylesCount', // "style"/"styles" — standard French vocabulary, same spelling as English
  ]),
  'pt-BR': new Set([
    'skills.downloads', // "download"/"downloads" — a widely used loanword in Brazilian Portuguese tech usage
  ]),
};

module.exports = {
  GLOBAL_IDENTICAL_ALLOWLIST,
  PER_LOCALE_COGNATE_VALUES,
  PLACEHOLDER_EXAMPLE_ALLOWLIST,
  TECHNICAL_NAMESPACE_PREFIXES,
  PER_LOCALE_IDENTICAL_ALLOWLIST,
};
