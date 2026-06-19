// ---------------------------------------------------------------------------
// Kavi — Conversation Helpers
// ---------------------------------------------------------------------------

import { i18n } from '../i18n/manager';
import type { TranslationMap } from '../i18n/types';
import { ar } from '../i18n/locales/ar';
import { de } from '../i18n/locales/de';
import { en } from '../i18n/locales/en';
import { es } from '../i18n/locales/es';
import { fr } from '../i18n/locales/fr';
import { ja } from '../i18n/locales/ja';
import { ptBR } from '../i18n/locales/pt-BR';
import { zhCN } from '../i18n/locales/zh-CN';
import { zhTW } from '../i18n/locales/zh-TW';

const LEGACY_PLACEHOLDER_TITLES = ['New Chat', 'New Conversation', 'Untitled', ''];

function getKnownDefaultConversationTitles(): string[] {
  const localeMaps: TranslationMap[] = [en, zhCN, zhTW, ptBR, de, es, ar, fr, ja];

  return localeMaps
    .map(
      (translations) => (translations.nav as Record<string, unknown> | undefined)?.newConversation,
    )
    .filter((title): title is string => typeof title === 'string')
    .map((title) => title.trim())
    .filter(Boolean);
}

const KNOWN_PLACEHOLDER_TITLES = new Set([
  ...LEGACY_PLACEHOLDER_TITLES,
  ...getKnownDefaultConversationTitles(),
]);

export function getDefaultConversationTitle(): string {
  return i18n.t('nav.newConversation');
}

export function isPlaceholderTitle(title: string): boolean {
  return (
    KNOWN_PLACEHOLDER_TITLES.has(title.trim()) || title.trim() === getDefaultConversationTitle()
  );
}

export function generateConversationTitle(firstMessage: string): string {
  if (!firstMessage?.trim()) return getDefaultConversationTitle();
  const cleaned = firstMessage.trim().replace(/\n+/g, ' ');
  if (cleaned.length <= 50) return cleaned;
  return cleaned.substring(0, 47) + '...';
}
