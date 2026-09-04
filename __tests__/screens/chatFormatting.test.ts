import { formatLogKindLabel } from '../../src/screens/chatFormatting';
import { i18n } from '../../src/i18n/manager';

const t = i18n.t.bind(i18n);

describe('formatLogKindLabel', () => {
  it('translates every known conversation log kind in English by default', () => {
    expect(formatLogKindLabel('state', t)).toBe('State');
    expect(formatLogKindLabel('tool', t)).toBe('Tool');
    expect(formatLogKindLabel('usage', t)).toBe('Usage');
    expect(formatLogKindLabel('compaction', t)).toBe('Compact');
    expect(formatLogKindLabel('command', t)).toBe('Command');
    expect(formatLogKindLabel('error', t)).toBe('Error');
  });

  it('falls back to the System label for an unrecognized kind', () => {
    expect(formatLogKindLabel('unknown' as never, t)).toBe('System');
  });

  it('renders localized (non-English) labels once the locale is switched to Arabic', async () => {
    await i18n.setLocale('ar');
    try {
      expect(formatLogKindLabel('state', t)).toBe('الحالة');
      expect(formatLogKindLabel('tool', t)).not.toBe('Tool');
      expect(formatLogKindLabel('error', t)).not.toBe('Error');
    } finally {
      await i18n.setLocale('en');
    }
  });
});
