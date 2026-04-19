import { File } from 'expo-file-system';

import {
  buildMailtoUrl,
  normalizeEmailComposeArgs,
} from '../../src/services/nativeActions/builders/email';
import {
  normalizePhoneNumber,
  normalizePhoneNumberList,
} from '../../src/services/nativeActions/builders/phone';
import { normalizeOptionalMimeType } from '../../src/services/nativeActions/files';
import {
  normalizeFiniteNumber,
  normalizeOptionalStringArray,
  normalizeUrlWithAllowlist,
  SAFE_OPEN_URL_SCHEMES,
  validateEmailAddresses,
  validateFileUri,
} from '../../src/services/nativeActions/validators';

describe('native action builders', () => {
  beforeEach(() => {
    new File('file:///tmp/report.pdf').write('report');
  });

  it('normalizes email compose arguments and builds a mailto fallback URL', () => {
    const normalized = normalizeEmailComposeArgs({
      recipients: ['jane@example.com'],
      ccRecipients: ['team@example.com'],
      subject: 'Project update',
      body: 'Hello team',
    });

    expect(normalized.recipients).toEqual(['jane@example.com']);
    expect(buildMailtoUrl(normalized)).toBe(
      'mailto:jane%40example.com?subject=Project%20update&body=Hello%20team&cc=team%40example.com',
    );
  });

  it('rejects empty email compose payloads', () => {
    expect(() => normalizeEmailComposeArgs({})).toThrow(
      'Email compose requires at least one recipient, subject, body, or attachment.',
    );
  });

  it('normalizes phone numbers using a default country', () => {
    const normalized = normalizePhoneNumber('212-555-0101', 'US');
    expect(normalized.e164).toBe('+12125550101');
    expect(normalized.telUri).toBe('tel:+12125550101');
  });

  it('rejects invalid phone numbers', () => {
    expect(() => normalizePhoneNumber('abc', 'US')).toThrow(
      'Phone numbers must be valid international numbers or include a valid defaultCountry.',
    );
  });

  it('accepts already-normalized E.164 phone numbers and rejects invalid country codes', () => {
    expect(normalizePhoneNumber('+12125550101')).toEqual(
      expect.objectContaining({
        e164: '+12125550101',
        telUri: 'tel:+12125550101',
      }),
    );

    expect(() => normalizePhoneNumber('2125550101', 'USA')).toThrow(
      'defaultCountry must be a two-letter ISO country code.',
    );
  });

  it('wraps phone-number list errors with the indexed field name', () => {
    expect(() => normalizePhoneNumberList(['bad-number'], 'recipients', 'US')).toThrow(
      'recipients[0]: Phone numbers must be valid international numbers or include a valid defaultCountry.',
    );
  });

  it('allows reviewed open_url schemes and rejects unsupported ones', () => {
    expect(normalizeUrlWithAllowlist('https://example.com', SAFE_OPEN_URL_SCHEMES)).toEqual({
      url: 'https://example.com',
      scheme: 'https',
    });

    expect(() =>
      normalizeUrlWithAllowlist('ftp://example.com/archive', SAFE_OPEN_URL_SCHEMES),
    ).toThrow('URL scheme "ftp" is not allowed for this action.');
  });

  it('covers validator edge cases for arrays, numbers, emails, and file URIs', () => {
    expect(normalizeOptionalStringArray(undefined, 'attachments')).toBeUndefined();
    expect(() => normalizeOptionalStringArray('bad', 'attachments')).toThrow(
      'attachments must be an array of strings.',
    );
    expect(() => normalizeOptionalStringArray(['ok', ''], 'attachments')).toThrow(
      'attachments[1] cannot be empty.',
    );

    expect(normalizeFiniteNumber(undefined, 'latitude')).toBeUndefined();
    expect(() => normalizeFiniteNumber('bad', 'latitude')).toThrow(
      'latitude must be a finite number.',
    );

    expect(validateEmailAddresses(['jane@example.com'], 'recipients')).toEqual([
      'jane@example.com',
    ]);
    expect(() => validateEmailAddresses(['invalid'], 'recipients')).toThrow(
      'recipients[0] is not a valid email address.',
    );

    expect(validateFileUri('file:///tmp/report.pdf', 'fileUri')).toBe('file:///tmp/report.pdf');
    expect(
      validateFileUri('content://shared/report.pdf', 'fileUri', { allowContentUri: true }),
    ).toBe('content://shared/report.pdf');
    expect(() => validateFileUri('https://example.com/report.pdf', 'fileUri')).toThrow(
      'fileUri must be a local `file://` URI.',
    );

    expect(normalizeOptionalMimeType('application/pdf', 'mimeType')).toBe('application/pdf');
    expect(() => normalizeOptionalMimeType('not-a-mime', 'mimeType')).toThrow(
      'mimeType must be a valid MIME type such as image/png.',
    );
  });
});

describe('maps builder', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('react-native');
  });

  it('builds iOS Apple Maps query URLs', () => {
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
      const { buildMapsUrl } = require('../../src/services/nativeActions/builders/maps');
      expect(buildMapsUrl({ query: 'Empire State Building' })).toBe(
        'http://maps.apple.com/?q=Empire%20State%20Building',
      );
    });
  });

  it('builds Android geo URLs with labeled coordinates', () => {
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
      const { buildMapsUrl } = require('../../src/services/nativeActions/builders/maps');
      expect(
        buildMapsUrl({ latitude: 40.7484, longitude: -73.9857, label: 'Empire State Building' }),
      ).toBe('geo:40.7484,-73.9857?q=40.7484,-73.9857(Empire%20State%20Building)');
    });
  });

  it('covers additional iOS and Android map URL branches and invalid inputs', () => {
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
      const {
        buildMapsUrl,
        summarizeMapsTarget,
      } = require('../../src/services/nativeActions/builders/maps');
      expect(buildMapsUrl({ latitude: 40.7484, longitude: -73.9857 })).toBe(
        'http://maps.apple.com/?ll=40.7484,-73.9857',
      );
      expect(summarizeMapsTarget({ latitude: 40.7484, longitude: -73.9857 })).toBe(
        '40.7484, -73.9857',
      );
    });

    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
      const { buildMapsUrl } = require('../../src/services/nativeActions/builders/maps');
      expect(
        buildMapsUrl({ latitude: 40.7484, longitude: -73.9857, query: 'Empire State Building' }),
      ).toBe('geo:40.7484,-73.9857?q=Empire%20State%20Building');
      expect(buildMapsUrl({ latitude: 40.7484, longitude: -73.9857 })).toBe('geo:40.7484,-73.9857');
      expect(() => buildMapsUrl({ latitude: 40.7484 })).toThrow(
        'maps_open requires either a query or both latitude and longitude.',
      );
    });
  });
});
