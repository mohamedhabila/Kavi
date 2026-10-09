import { i18n } from '../../src/i18n/manager';
import { describeToolInvocation } from '../../src/services/security/toolPrivacy';

// The approval card used its own English-only formatter for tools without a dedicated
// title, so a Japanese user was asked to approve "Device Info".

describe('approval presentation tool names', () => {
  afterEach(async () => {
    await i18n.setLocale('en');
  });

  it('names a tool in the user language when it has no dedicated approval title', async () => {
    await i18n.setLocale('ja');

    expect(describeToolInvocation('device_info', {}).title).toBe('デバイス情報');
  });

  it('keeps the English name in English', () => {
    expect(describeToolInvocation('device_info', {}).title).toBe('Device Info');
  });
});
