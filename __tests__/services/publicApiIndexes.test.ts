import * as i18nPublic from '../../src/i18n';
import { i18n } from '../../src/i18n/manager';
import { useTranslation } from '../../src/i18n/useTranslation';
import {
  SUPPORTED_LOCALES,
  LOCALE_DISPLAY_NAMES,
  resolveDeviceLocale,
  loadLocaleTranslations,
  clearLocaleCache,
} from '../../src/i18n/registry';
import * as linksPublic from '../../src/services/links';
import {
  extractLinksFromMessage,
  DEFAULT_MAX_LINKS,
  DEFAULT_LINK_TIMEOUT_MS,
} from '../../src/services/links/detect';
import { formatLinkUnderstandingBody } from '../../src/services/links/format';
import { runLinkUnderstanding } from '../../src/services/links/service';
import * as mediaPublic from '../../src/services/media';
import { formatMediaUnderstandingBody, stripMediaContext } from '../../src/services/media/format';
import { runMediaUnderstanding } from '../../src/services/media/service';

describe('public API indexes', () => {
  it('re-exports the i18n public API', () => {
    expect(i18nPublic.i18n).toBe(i18n);
    expect(i18nPublic.useTranslation).toBe(useTranslation);
    expect(i18nPublic.SUPPORTED_LOCALES).toBe(SUPPORTED_LOCALES);
    expect(i18nPublic.LOCALE_DISPLAY_NAMES).toBe(LOCALE_DISPLAY_NAMES);
    expect(i18nPublic.resolveDeviceLocale).toBe(resolveDeviceLocale);
    expect(i18nPublic.loadLocaleTranslations).toBe(loadLocaleTranslations);
    expect(i18nPublic.clearLocaleCache).toBe(clearLocaleCache);
  });

  it('re-exports the link understanding public API', () => {
    expect(linksPublic.extractLinksFromMessage).toBe(extractLinksFromMessage);
    expect(linksPublic.DEFAULT_MAX_LINKS).toBe(DEFAULT_MAX_LINKS);
    expect(linksPublic.DEFAULT_LINK_TIMEOUT_MS).toBe(DEFAULT_LINK_TIMEOUT_MS);
    expect(linksPublic.formatLinkUnderstandingBody).toBe(formatLinkUnderstandingBody);
    expect(linksPublic.runLinkUnderstanding).toBe(runLinkUnderstanding);
  });

  it('re-exports the media understanding public API', () => {
    expect(mediaPublic.formatMediaUnderstandingBody).toBe(formatMediaUnderstandingBody);
    expect(mediaPublic.stripMediaContext).toBe(stripMediaContext);
    expect(mediaPublic.runMediaUnderstanding).toBe(runMediaUnderstanding);
  });
});
