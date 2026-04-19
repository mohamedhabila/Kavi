export type RequestAssessmentAction = 'proceed' | 'clarify' | 'reframe' | 'direct';

export type RequestAssessmentIssue =
  | 'low_signal'
  | 'underspecified_single_word'
  | 'trivial_direct_request'
  | 'freshness_sensitive_lookup'
  | 'simple_task_scope_mismatch'
  | 'unreasonable_process'
  | 'impossible_guarantee';

export interface RequestAssessment {
  action: RequestAssessmentAction;
  shouldSkipWorkflow: boolean;
  shouldCritiqueScope: boolean;
  issues: RequestAssessmentIssue[];
  summary: string;
  reasons: string[];
  suggestedApproach: string;
  narrowedScope?: string;
}

export interface RequestAssessmentOptions {
  hasAttachments?: boolean;
  hasPriorContext?: boolean;
}

export interface RequestAssessmentResponseEvaluation {
  handled: boolean;
  askedForClarification: boolean;
  challengedScope: boolean;
  answeredDirectly: boolean;
  gaps: string[];
  strengths: string[];
}

const PUNCTUATION_ONLY_PATTERN = /^[\s.\-_,!?/\\|+=*~:;()[\]{}<>…]+$/u;
const LOW_SIGNAL_TEXT_PATTERN = /^(?:hi|hello|hey|yo|sup|ok|okay|kk|hmm|huh|uh|test|testing|ping|dot|dots|dash|dashes)\W*$/i;
const SIMPLE_TASK_PATTERN = /\b(typo|spelling|grammar|punctuation|wording|rephrase|paraphrase|summari[sz]e|shorten|rename|title|subject line|caption|one sentence|single sentence|quick answer|brief answer|haiku|tweet)\b/i;
const DIRECT_LOOKUP_PATTERN = /\b(weather|forecast|temperature|degrees?|cold outside|hot outside|warm outside|outside|rain(?:ing)?|snow(?:ing)?|wind(?:y)?|humid(?:ity)?|feels like|what time|current time|what day|what date|today'?s date|date today)\b/i;
const FRESH_LOOKUP_PATTERN = /\b(now|right now|currently|outside|today|tonight|this morning|this afternoon|this evening|tomorrow)\b/i;
const DIRECT_LOOKUP_COMPLEXITY_EXCLUSION_PATTERN = /\b(file|files|code|repo(?:sitory)?|project|workspace|branch|commit|pull request|pr|screen|component|service|module|workflow|pipeline|agent|sub-?agent|worker|tool|tools|mcp|bug|issue|error|test|build|implement|write|edit|modify|change|refactor|analy[sz]e|review|research|compare|document)\b/i;
const OVERKILL_PROCESS_PATTERN = /\b(?:spawn|launch|delegate|use|run|make|assign|orchestrate)\b[\s\S]{0,40}\b(?:[3-9]|10|many|multiple)\s+(?:sub-?agents?|agents?|workers?)\b/i;
const EXHAUSTIVE_SCOPE_PATTERN = /\b(?:entire|whole|full|complete|every|all)\b[\s\S]{0,30}\b(?:app|application|codebase|repo(?:sitory)?|project|workspace|screen|service|component|module|file|files)\b/i;
const FULL_REWRITE_PATTERN = /\b(?:rewrite|rebuild|redesign|refactor|audit|review|inspect|test|verify|document|analy[sz]e)\b[\s\S]{0,40}\b(?:everything|the whole|entire|all of it)\b/i;
const IMPOSSIBLE_GUARANTEE_PATTERN = /\b(?:guarantee|ensure|promise)\b[\s\S]{0,24}\b(?:100%|perfect(?:ion)?|zero bugs|zero[- ]risk|never fail|complete certainty|fully exhaustive)\b/i;
const CLARIFICATION_RESPONSE_PATTERN = /\b(?:clarify|specific|details?|more context|what exactly|which\b|could you|can you|please share|tell me|restate|describe what you want)\b/i;
const SCOPE_CRITIQUE_RESPONSE_PATTERN = /\b(?:overkill|too much|too broad|disproportionate|unreasonable|not necessary|not sensible|won't\b|wouldn't\b|instead\b|rather than\b|narrow(?:er)?\b|scope\b|keep it focused|keep this focused|minimal|smallest reasonable|best-effort)\b/i;
const DIRECT_RESPONSE_BLOCK_PATTERN = /\b(?:objective:|success criteria:|stop conditions:|workstreams?:|sessions_(?:spawn|wait|status|output|history|send|cancel|yield)|sub-?agents?|delegate|delegation|worker launch|pilot review)\b/i;
const DIRECT_RESPONSE_PLANNING_PREFIX_PATTERN = /^(?:i(?:'m| am)?\s+(?:going to|gonna|will|need to)|let me|first[, ]|plan[:\s]|objective:)/i;

const FOLLOW_UP_WORDS_WITH_CONTEXT = new Set([
  'again',
  'continue',
  'details',
  'expand',
  'more',
  'next',
  'proceed',
  'resume',
  'retry',
  'same',
]);

function normalizePrompt(text: string | undefined): string {
  return typeof text === 'string'
    ? text.replace(/\s+/g, ' ').trim()
    : '';
}

function tokenizePrompt(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g);
  return matches ? matches.filter(Boolean) : [];
}

function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}

function buildClarifyAssessment(reasons: string[]): RequestAssessment {
  return {
    action: 'clarify',
    shouldSkipWorkflow: true,
    shouldCritiqueScope: false,
    issues: reasons.some((reason) => reason.includes('single-word'))
      ? ['underspecified_single_word']
      : ['low_signal'],
    summary: 'The latest user request is too low-signal to justify an agentic workflow.',
    reasons,
    suggestedApproach: 'Stop before planning, delegation, or tool use and ask the user for a concrete task or missing details.',
  };
}

function buildDirectAssessment(reasons: string[]): RequestAssessment {
  return {
    action: 'direct',
    shouldSkipWorkflow: true,
    shouldCritiqueScope: false,
    issues: ['trivial_direct_request', 'freshness_sensitive_lookup'],
    summary: 'The latest user request is a trivial direct lookup and should bypass the agentic workflow.',
    reasons,
    suggestedApproach: 'Answer directly. If up-to-date data is needed, use one focused tool call to fetch it, then reply without planning, delegation, or workflow ceremony. If essential context like location is missing, ask one concise clarification question instead.',
  };
}

function buildReframeAssessment(reasons: string[], narrowedScope: string): RequestAssessment {
  const issues: RequestAssessmentIssue[] = [];

  if (reasons.some((reason) => reason.includes('worker count') || reason.includes('process'))) {
    issues.push('unreasonable_process');
  }
  if (reasons.some((reason) => reason.includes('simple task'))) {
    issues.push('simple_task_scope_mismatch');
  }
  if (reasons.some((reason) => reason.includes('guarantee'))) {
    issues.push('impossible_guarantee');
  }

  return {
    action: 'reframe',
    shouldSkipWorkflow: false,
    shouldCritiqueScope: true,
    issues,
    summary: 'The latest user request asks for unreasonable effort or an unreasonable process relative to the core task.',
    reasons,
    suggestedApproach: 'Challenge the mismatch explicitly, explain the reasonable scope you will handle instead, and proceed only with that reduced scope.',
    narrowedScope,
  };
}

function looksLikeDirectLookupRequest(normalized: string, words: string[]): boolean {
  if (!normalized || words.length === 0) {
    return false;
  }

  if (DIRECT_LOOKUP_COMPLEXITY_EXCLUSION_PATTERN.test(normalized)) {
    return false;
  }

  if (words.length > 16) {
    return false;
  }

  if (DIRECT_LOOKUP_PATTERN.test(normalized)) {
    return true;
  }

  return /\?$/.test(normalized) && FRESH_LOOKUP_PATTERN.test(normalized);
}

export function assessUserRequest(
  text: string | undefined,
  options: RequestAssessmentOptions = {},
): RequestAssessment {
  const normalized = normalizePrompt(text);
  const hasAttachments = options.hasAttachments === true;
  const hasPriorContext = options.hasPriorContext === true;

  if (!normalized) {
    return buildClarifyAssessment(['The request is empty.']);
  }

  if (!hasAttachments && (PUNCTUATION_ONLY_PATTERN.test(normalized) || LOW_SIGNAL_TEXT_PATTERN.test(normalized))) {
    return buildClarifyAssessment([
      'The request contains only punctuation or filler text and does not describe a task.',
    ]);
  }

  const words = tokenizePrompt(normalized);
  if (!hasAttachments && words.length === 1 && !FOLLOW_UP_WORDS_WITH_CONTEXT.has(words[0]) && !hasPriorContext) {
    return buildClarifyAssessment([
      'The request is a single-word prompt without enough context to identify the intended task.',
    ]);
  }

  if (!hasAttachments && looksLikeDirectLookupRequest(normalized, words)) {
    return buildDirectAssessment([
      'The request is a short live-information lookup that should be handled directly instead of starting an agentic workflow.',
    ]);
  }

  const simpleTask = SIMPLE_TASK_PATTERN.test(normalized);
  const overkillProcess = OVERKILL_PROCESS_PATTERN.test(normalized);
  const overkillScope = EXHAUSTIVE_SCOPE_PATTERN.test(normalized) || FULL_REWRITE_PATTERN.test(normalized);
  const impossibleGuarantee = IMPOSSIBLE_GUARANTEE_PATTERN.test(normalized);
  const reasons: string[] = [];

  if (simpleTask && (overkillProcess || overkillScope)) {
    pushUnique(reasons, 'The request pairs a simple task with disproportionate effort or scope.');
  }
  if (overkillProcess) {
    pushUnique(reasons, 'The request specifies an unreasonable worker count or orchestration process for the stated task.');
  }
  if (impossibleGuarantee) {
    pushUnique(reasons, 'The request demands an impossible guarantee rather than a verifiable best-effort result.');
  }

  if (reasons.length > 0) {
    const narrowedScope = impossibleGuarantee
      ? 'Reject the impossible guarantee, then proceed only with a verifiable best-effort version of the core task if one still makes sense.'
      : overkillProcess
        ? 'Ignore the unreasonable process instructions and choose the smallest workflow that actually fits the core task.'
        : 'Handle only the smallest reasonable action that satisfies the core simple task.';

    return buildReframeAssessment(reasons, narrowedScope);
  }

  return {
    action: 'proceed',
    shouldSkipWorkflow: false,
    shouldCritiqueScope: false,
    issues: [],
    summary: 'The request is specific enough to proceed normally.',
    reasons: [],
    suggestedApproach: 'Proceed with the normal workflow for the task complexity.',
  };
}

export function requestAssessmentNeedsWorkflowBypass(
  assessment: RequestAssessment | undefined,
): boolean {
  return assessment?.shouldSkipWorkflow === true;
}

export function responseAsksForClarification(text: string | undefined): boolean {
  const normalized = normalizePrompt(text);
  if (!normalized) {
    return false;
  }

  return CLARIFICATION_RESPONSE_PATTERN.test(normalized) || (normalized.includes('?') && /\b(?:what|which|how|could|can|please)\b/i.test(normalized));
}

export function responseChallengesScope(text: string | undefined): boolean {
  const normalized = normalizePrompt(text);
  if (!normalized) {
    return false;
  }

  return SCOPE_CRITIQUE_RESPONSE_PATTERN.test(normalized)
    || /\b(?:cannot|can't|won't|do not)\b[\s\S]{0,30}\b(?:guarantee|promise|do that exactly)\b/i.test(normalized);
}

export function responseAnswersDirectly(text: string | undefined): boolean {
  const normalized = normalizePrompt(text);
  if (!normalized) {
    return false;
  }

  if (/^[\[{]/.test(normalized)) {
    return false;
  }

  if (responseAsksForClarification(normalized)) {
    return false;
  }

  if (DIRECT_RESPONSE_BLOCK_PATTERN.test(normalized) || DIRECT_RESPONSE_PLANNING_PREFIX_PATTERN.test(normalized)) {
    return false;
  }

  return true;
}

export function evaluateResponseAgainstRequestAssessment(
  assessment: RequestAssessment,
  responseText: string | undefined,
  options: { usedWorkflow?: boolean } = {},
): RequestAssessmentResponseEvaluation {
  const askedForClarification = responseAsksForClarification(responseText);
  const challengedScope = responseChallengesScope(responseText);
  const answeredDirectly = responseAnswersDirectly(responseText);
  const usedWorkflow = options.usedWorkflow === true;
  const gaps: string[] = [];
  const strengths: string[] = [];

  if (assessment.action === 'clarify') {
    if (!askedForClarification) {
      gaps.push('The response should stop early and ask the user for concrete details instead of assuming a task.');
    } else {
      strengths.push('The response explicitly asks the user to clarify the low-signal request.');
    }

    if (usedWorkflow) {
      gaps.push('The workflow should have stopped before tool use or delegation because the request was too low-signal.');
    } else {
      strengths.push('The run avoided unnecessary workflow work on a low-signal request.');
    }

    return {
      handled: gaps.length === 0,
      askedForClarification,
      challengedScope,
      answeredDirectly,
      gaps,
      strengths,
    };
  }

  if (assessment.action === 'direct') {
    if (!answeredDirectly && !askedForClarification) {
      gaps.push('The response should answer the direct question succinctly from the available evidence, or ask only for the missing context it still needs.');
    } else if (answeredDirectly) {
      strengths.push('The response answers the direct lookup request without unnecessary workflow ceremony.');
    } else {
      strengths.push('The response asks only for the minimal missing context needed to complete the direct lookup.');
    }

    if (!usedWorkflow) {
      strengths.push('The run avoided unnecessary delegation and workflow tracking for a trivial direct request.');
    }

    return {
      handled: gaps.length === 0,
      askedForClarification,
      challengedScope,
      answeredDirectly,
      gaps,
      strengths,
    };
  }

  if (assessment.action === 'reframe') {
    if (!challengedScope) {
      gaps.push('The response should explicitly criticize the unreasonable scope or process and state the narrower action that makes sense.');
    } else {
      strengths.push('The response explicitly challenges the unreasonable scope or process instead of following it blindly.');
    }

    return {
      handled: gaps.length === 0,
      askedForClarification,
      challengedScope,
      answeredDirectly,
      gaps,
      strengths,
    };
  }

  return {
    handled: true,
    askedForClarification,
    challengedScope,
    answeredDirectly,
    gaps,
    strengths,
  };
}
