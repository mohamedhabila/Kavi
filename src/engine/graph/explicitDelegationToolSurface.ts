import type { ConversationMode } from '../../types/conversation';
import { normalizeToolName } from '../tools/toolNameNormalization';

const DELEGATED_WORK_LIFECYCLE_TOOLS = [
  'sessions_spawn',
  'sessions_status',
  'sessions_wait',
  'sessions_cancel',
] as const;

const SESSION_TOOL_MENTION = /\bsessions_(spawn|send|wait|cancel|status|list|history|output)\b/gu;

const DELEGATED_WORK_ANCHOR =
  /(?:\bsub[\s-]?agent\p{L}*\b|\bdelegated?\s+(?:assistants?|helpers?|workers?)\b|\b(?:assistant|helper|worker)\s+sessions?\b|\banother\s+(?:assistant|helper|agent)\b|サブエージェント|委任|分担|子(?:代理人?|智能体)|委派|分工|وكيل\s+فرعي|مساعد\s+فرعي)/u;

const DELEGATION_START_ACTION =
  /(?:\bdeleg\p{L}*\b|\bspawn(?:s|ed|ing)?\b|\b(?:launch|start|create|run)(?:s|ed|ing)?\b|委任|分担|委派|分工|فو[ّ]?ض|وك[ّ]?ل)/u;

const DIRECT_DELEGATION_REQUEST =
  /^(?:(?:please|can\s+you|could\s+you|would\s+you|i\s+(?:want|need)\s+you\s+to)\s+)?(?:delegat(?:e|es|ed|ing)|use(?:s|d|ing)?)\b/u;

const WAIT_ACTION =
  /(?:\bwait(?:s|ed|ing)?\b|\bmonitor(?:s|ed|ing)?\b|\bcheck(?:s|ed|ing)?\s+(?:on|the\s+status)\b|esper(?:a|ar|e)|attend(?:s|re|ez)|wart(?:e|en|et)|aguard(?:a|ar|e)|待(?:つ|って|機)|等待|监控|監控|انتظر|راقب)/u;

const CANCEL_ACTION =
  /(?:\bcancel(?:s|led|ing)?\b|\bstop(?:s|ped|ping)?\b|\babort(?:s|ed|ing)?\b|cancel(?:a|ar|e)|annul(?:e|er)|abbrech(?:en|e)|stopp(?:en|e)|取消|停止|中止|إلغاء|الغ|أوقف|اوقف)/u;

const FOLLOW_UP_ACTION =
  /(?:\b(?:send|message|tell|follow\s+up)(?:s|ed|ing)?\b|envi(?:a|ar|e)|mensaje|message|nachricht|フォロー|伝え|发送|發送|告诉|告訴|أرسل|ارسل)/u;

const INSPECT_ACTION =
  /(?:\b(?:list|show|inspect|review)(?:s|ed|ing)?\b|listar|mostrar|revisar|afficher|lister|anzeigen|auflisten|一覧|履歴|列出|查看|قائمة|اعرض)/u;

const NEGATED_DELEGATION =
  /(?:\b(?:do\s+not|don['’]?t|never|without|avoid)\b.{0,32}(?:delegat|spawn|sub[\s-]?agent)|\b(?:no|sin|sans|ohne|n[aã]o|nicht)\b.{0,24}(?:deleg|sub[\s-]?agent)|(?:委任|分担|サブエージェント).{0,8}(?:しない|不要|なし)|(?:不要|别|不使用|無需).{0,12}(?:委派|分工|子(?:代理|智能体))|(?:لا|بدون|تجنب).{0,20}(?:فو[ّ]?ض|وكيل\s+فرعي))/u;

function normalizeUserText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
}

function directlyMentionedSessionTools(text: string): Set<string> {
  const tools = new Set<string>();
  for (const match of text.matchAll(SESSION_TOOL_MENTION)) {
    const name = normalizeToolName(`sessions_${match[1]}`);
    if (name) tools.add(name);
  }
  return tools;
}

/**
 * Detects an explicit delegated-work request from the latest user turn only.
 * This is a surface-discovery hint, never execution authority: runtime policy,
 * provider support, tool filters, and per-effect approval still gate every call.
 */
export function resolveExplicitDelegationToolNames(params: {
  conversationMode?: ConversationMode;
  latestUserMessageText: string;
}): string[] {
  if (params.conversationMode !== 'agentic') return [];

  const text = normalizeUserText(params.latestUserMessageText);
  if (!text) return [];
  if (NEGATED_DELEGATION.test(text)) return [];

  const directlyMentioned = directlyMentionedSessionTools(text);
  if (directlyMentioned.size > 0) {
    return Array.from(directlyMentioned);
  }

  const hasDelegatedWorkAnchor = DELEGATED_WORK_ANCHOR.test(text);
  const startsDelegatedWork =
    DIRECT_DELEGATION_REQUEST.test(text) ||
    (DELEGATION_START_ACTION.test(text) && hasDelegatedWorkAnchor);

  if (startsDelegatedWork) {
    return [...DELEGATED_WORK_LIFECYCLE_TOOLS];
  }
  if (!hasDelegatedWorkAnchor) return [];

  if (CANCEL_ACTION.test(text)) return ['sessions_status', 'sessions_cancel'];
  if (FOLLOW_UP_ACTION.test(text)) return ['sessions_status', 'sessions_send'];
  if (WAIT_ACTION.test(text)) return ['sessions_status', 'sessions_wait', 'sessions_cancel'];
  if (INSPECT_ACTION.test(text)) {
    return ['sessions_list', 'sessions_status', 'sessions_history', 'sessions_output'];
  }
  return [];
}
