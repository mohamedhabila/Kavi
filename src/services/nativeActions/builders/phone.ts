import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

import { NativeActionError } from '../types';
import { normalizeRequiredString } from '../validators';

export interface NormalizedPhoneNumber {
  displayNumber: string;
  e164: string;
  telUri: string;
}

function normalizeCountryCode(defaultCountry?: string): CountryCode | undefined {
  if (!defaultCountry) {
    return undefined;
  }

  const normalized = defaultCountry.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw new NativeActionError(
      'invalid_country_code',
      'defaultCountry must be a two-letter ISO country code.',
    );
  }

  return normalized as CountryCode;
}

export function normalizePhoneNumber(
  rawNumber: string,
  defaultCountry?: string,
): NormalizedPhoneNumber {
  const input = normalizeRequiredString(rawNumber, 'number');
  const parsed = parsePhoneNumberFromString(input, normalizeCountryCode(defaultCountry));

  if (parsed?.isValid()) {
    return {
      displayNumber: parsed.formatInternational(),
      e164: parsed.number,
      telUri: `tel:${parsed.number}`,
    };
  }

  const fallback = input.replace(/[^\d+]/g, '');
  if (/^\+[1-9]\d{6,14}$/.test(fallback)) {
    return {
      displayNumber: fallback,
      e164: fallback,
      telUri: `tel:${fallback}`,
    };
  }

  throw new NativeActionError(
    'invalid_phone_number',
    'Phone numbers must be valid international numbers or include a valid defaultCountry.',
  );
}

export function normalizePhoneNumberList(
  rawNumbers: string[],
  fieldName: string,
  defaultCountry?: string,
): string[] {
  return rawNumbers.map((rawNumber, index) => {
    try {
      return normalizePhoneNumber(rawNumber, defaultCountry).e164;
    } catch (error) {
      if (error instanceof NativeActionError) {
        throw new NativeActionError(
          error.code,
          `${fieldName}[${index}]: ${error.message}`,
          error.status,
          error.details,
        );
      }
      throw error;
    }
  });
}
