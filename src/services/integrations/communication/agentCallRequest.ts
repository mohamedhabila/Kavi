// ---------------------------------------------------------------------------
// Kavi — The call Kavi asks Bland to make: who, in what language, with what brief
// ---------------------------------------------------------------------------
// The words that make the call lawful are code-owned: the callee hears first that this is
// an AI assistant calling for the person and that the call is recorded (EU AI Act art. 50,
// FCC 24-17, all-party recording consent), and the agent's rules (never deny being an AI,
// share only what was approved, no payments or IDs, stop when asked) frame the model's
// brief. The model supplies the number, the opening line in the call's language, the goal
// and what may be shared, all of which the person approved on the card.

import { normalizePhoneNumber } from '../../nativeActions/builders/phone';

export const MAX_CALL_MINUTES = 10;
const DEFAULT_CALL_MINUTES = 5;

/** Bounds keep the whole task under Bland's recommended 2,000 characters. */
export const AGENT_CALL_LIMITS = Object.freeze({
  callerName: 40,
  opening: 250,
  goal: 550,
  mayShare: 250,
  voicemailMessage: 300,
});

export type AgentCallArgs = Readonly<{
  phoneNumber: string;
  defaultCountry?: string;
  callerName: string;
  language: string;
  opening: string;
  goal: string;
  mayShare?: string;
  maxMinutes?: number;
  voicemailMessage?: string;
}>;

export type AgentCallPlan = Readonly<{
  e164: string;
  displayNumber: string;
  minutes: number;
  /** The language code Bland was asked to speak. */
  blandLanguage: string;
  body: Record<string, unknown>;
}>;

export class AgentCallArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentCallArgumentError';
  }
}

/** Bland's `language` values (docs.bland.ai/api-v1/post/calls, 2026-10-16). */
const BLAND_LANGUAGES = new Map(
  (
    'en en-US en-GB en-AU en-NZ en-IN es es-419 fr fr-CA de el hi hi-Latn hu ja ko ko-KR vi pt ' +
    'pt-BR pt-PT zh zh-CN zh-Hans zh-TW zh-Hant it nl pl ru sv sv-SE da da-DK fi no id ' +
    'ms tr uk bg cs ro sk'
  )
    .split(' ')
    .map((code) => [code.toLowerCase(), code] as const),
);

/**
 * The Bland language for a BCP-47 tag: the tag itself, else its base language, else
 * Bland's automatic detection (Arabic, among others, has no voice of its own there).
 */
export function blandLanguageFor(tag: string): string {
  const normalized = tag.trim().replace(/_/gu, '-').toLowerCase();
  const exact = BLAND_LANGUAGES.get(normalized);
  if (exact) return exact;
  const base = BLAND_LANGUAGES.get(normalized.split('-')[0] ?? '');
  return base ?? 'auto';
}

/**
 * The disclosure the callee hears first, in the call's language. Japanese names the person
 * without an honorific: Kavi speaks for them, as their own side.
 */
const DISCLOSURES: Readonly<Record<string, (name: string) => string>> = {
  en: (name) =>
    `Hi, this is Kavi, an AI assistant calling on behalf of ${name}. This call is recorded.`,
  es: (name) =>
    `Hola, soy Kavi, un asistente de inteligencia artificial que llama en nombre de ${name}. Esta llamada se está grabando.`,
  fr: (name) =>
    `Bonjour, ici Kavi, un assistant d'intelligence artificielle qui appelle de la part de ${name}. Cet appel est enregistré.`,
  de: (name) =>
    `Hallo, hier ist Kavi, ein KI-Assistent, der im Auftrag von ${name} anruft. Dieses Gespräch wird aufgezeichnet.`,
  ja: (name) =>
    `こんにちは。${name}の代理でお電話しております、AIアシスタントのKaviです。この通話は録音されています。`,
  pt: (name) =>
    `Olá, aqui é o Kavi, um assistente de inteligência artificial ligando em nome de ${name}. Esta ligação está sendo gravada.`,
  'pt-pt': (name) =>
    `Olá, fala o Kavi, um assistente de inteligência artificial que liga em nome de ${name}. Esta chamada está a ser gravada.`,
  'zh-hans': (name) => `您好，我是Kavi，一个代表${name}打电话的人工智能助手。本次通话正在录音。`,
  'zh-hant': (name) => `您好，我是Kavi，一個代表${name}打電話的人工智慧助理。本次通話正在錄音。`,
  ar: (name) => `مرحبًا، أنا كافي، مساعد ذكاء اصطناعي أتصل نيابةً عن ${name}. هذه المكالمة مسجّلة.`,
};

function disclosureKey(tag: string): string {
  const [base = '', ...rest] = tag.trim().replace(/_/gu, '-').toLowerCase().split('-');
  if (base === 'zh') {
    return rest.some((part) => ['tw', 'hk', 'mo', 'hant'].includes(part)) ? 'zh-hant' : 'zh-hans';
  }
  if (base === 'pt' && rest.includes('pt')) return 'pt-pt';
  return base;
}

/** The disclosure in the call's language, if Kavi has it written. */
export function callDisclosure(tag: string, name: string): string | undefined {
  return DISCLOSURES[disclosureKey(tag)]?.(name);
}

function requiredText(value: unknown, field: keyof typeof AGENT_CALL_LIMITS): string {
  const text = optionalText(value, field);
  if (!text) throw new AgentCallArgumentError(`${field} is required.`);
  return text;
}

function optionalText(value: unknown, field: keyof typeof AGENT_CALL_LIMITS): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new AgentCallArgumentError(`${field} must be text.`);
  const text = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (Array.from(text).length > AGENT_CALL_LIMITS[field]) {
    throw new AgentCallArgumentError(
      `${field} is longer than ${AGENT_CALL_LIMITS[field]} characters; say it more briefly.`,
    );
  }
  return text || undefined;
}

/** The call's length cap in minutes, as Bland is asked for it and the card shows it. */
export function clampCallMinutes(value: unknown): number {
  const minutes = value === undefined || value === null ? NaN : Number(value);
  if (!Number.isFinite(minutes)) return DEFAULT_CALL_MINUTES;
  return Math.min(MAX_CALL_MINUTES, Math.max(1, Math.round(minutes)));
}

/** Emergency and service numbers (911, 112, 311, *#06#): too short to be a phone number. */
const SHORT_DIALABLE_CODE = /^[0-9*#]{2,8}$/u;

function normalizeCallee(raw: unknown, defaultCountry: unknown): { e164: string; display: string } {
  const number = typeof raw === 'string' ? raw : '';
  if (SHORT_DIALABLE_CODE.test(number.replace(/[\s().-]/gu, ''))) {
    throw new AgentCallArgumentError(
      'Kavi does not call emergency or service numbers itself; use phone_call so the person places that call.',
    );
  }
  try {
    const normalized = normalizePhoneNumber(
      number,
      typeof defaultCountry === 'string' && defaultCountry.trim() ? defaultCountry : undefined,
    );
    return { e164: normalized.e164, display: normalized.displayNumber };
  } catch (error) {
    throw new AgentCallArgumentError(error instanceof Error ? error.message : String(error));
  }
}

type AgentTaskInput = Readonly<{
  name: string;
  language: string;
  opening: string;
  goal: string;
  mayShare?: string;
  /** The disclosure is already the call's first sentence. */
  disclosed: boolean;
}>;

function agentTask({ name, language, opening, goal, mayShare, disclosed }: AgentTaskInput): string {
  return [
    `You are Kavi, an AI phone assistant calling for ${name} (the client). Speak "${language}" (BCP-47) throughout.`,
    disclosed
      ? 'You already said you are an AI assistant calling for the client and that the call is recorded.'
      : `First say you are Kavi, an AI assistant calling for ${name}, and that the call is recorded; then say: "${opening}"`,
    'Rules:',
    '- If asked, confirm you are an AI. Never claim to be human or to be the client.',
    '- Work toward the goal, briefly and politely; then thank them and end the call.',
    '- Share only what is under "You may share". For anything else (card, ID or account numbers, passwords, health), say the client will follow up.',
    '- Never pay, buy, sign up or commit beyond the goal; say the client will confirm.',
    '- Note alternatives exactly (dates, times, prices, names, references); accept one only if the goal allows it.',
    '- At a phone menu, pick what leads to someone who can help.',
    '- If asked to stop or not to call again, apologize, agree and end the call.',
    `Goal: ${goal}`,
    `You may share: ${mayShare ?? "only the client's first name"}`,
  ].join('\n');
}

function summaryPrompt(name: string): string {
  return `Summarize the call for ${name} in two to four sentences: whether the goal was achieved, what was agreed (dates, times, prices, names and reference numbers exactly as said), and anything ${name} still needs to do.`;
}

function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Checks the model's arguments and builds Bland's request body. */
export function planAgentCall(args: Record<string, unknown>): AgentCallPlan {
  const callee = normalizeCallee(args.phoneNumber, args.defaultCountry);
  const name = requiredText(args.callerName, 'callerName');
  const language = typeof args.language === 'string' ? args.language.trim() : '';
  if (!/^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/iu.test(language)) {
    throw new AgentCallArgumentError(
      'language must be a BCP-47 language tag such as en-US, fr or ar.',
    );
  }
  const opening = requiredText(args.opening, 'opening');
  const goal = requiredText(args.goal, 'goal');
  const mayShare = optionalText(args.mayShare, 'mayShare');
  const voicemailMessage = optionalText(args.voicemailMessage, 'voicemailMessage');
  const minutes = clampCallMinutes(args.maxMinutes);
  const disclosure = callDisclosure(language, name);
  const blandLanguage = blandLanguageFor(language);
  const timezone = deviceTimeZone();
  return {
    e164: callee.e164,
    displayNumber: callee.display,
    minutes,
    blandLanguage,
    body: {
      phone_number: callee.e164,
      task: agentTask({
        name,
        language,
        opening,
        goal,
        ...(mayShare ? { mayShare } : {}),
        disclosed: disclosure !== undefined,
      }),
      ...(disclosure ? { first_sentence: `${disclosure} ${opening}` } : {}),
      language: blandLanguage,
      wait_for_greeting: true,
      record: true,
      max_duration: minutes,
      voicemail: voicemailMessage
        ? { action: 'leave_message', message: voicemailMessage }
        : { action: 'hangup' },
      summary_prompt: summaryPrompt(name),
      ...(timezone ? { timezone } : {}),
      metadata: { source: 'kavi' },
    },
  };
}
