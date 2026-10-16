// ---------------------------------------------------------------------------
// Kavi — E2E: are the prices in an answer the ones the tools returned?
// ---------------------------------------------------------------------------
// A guide grounded in the vendors' pages quotes their current prices; a model answering
// from memory quotes old ones. Every money amount in the answer (a currency symbol or code
// before or after a number, as written in any language) must be a price a tool result
// states in the same currency, rounded no further than the digits written, or an estimate
// built from such prices the answer quotes itself. Values are compared numerically:
// "4,50 €" matches "€4.50".

const CURRENCY = String.raw`US\$|\$|€|£|¥|USD|EUR|GBP|JPY`;
// Thousands may be grouped with no-break spaces (French typography), never plain ones.
const NUMBER = String.raw`\d[\d.,  ]*\d|\d`;
const AMOUNT = new RegExp(
  String.raw`(${CURRENCY})\s?(${NUMBER})|(${NUMBER})\s?(${CURRENCY})`,
  'gu',
);
/** A page may set the symbol a little apart from its number (a table cell, a line break). */
const SOURCE_AMOUNT = new RegExp(
  String.raw`(${CURRENCY})\s{0,3}(${NUMBER})|(${NUMBER})\s{0,3}(${CURRENCY})`,
  'gu',
);
const CURRENCY_CODES: Readonly<Record<string, string>> = {
  US$: 'USD',
  $: 'USD',
  USD: 'USD',
  '€': 'EUR',
  EUR: 'EUR',
  '£': 'GBP',
  GBP: 'GBP',
  '¥': 'JPY',
  JPY: 'JPY',
};

/** An estimate counts a quoted price up to 30 times (minutes of a call, months, units). */
const MAX_ESTIMATE_MULTIPLE = 30;
const MONTHS_PER_YEAR = 12;

type Amount = Readonly<{ written: string; value: number; currency: string; precision: number }>;

/** A written number as a value: a comma or dot followed by one or two digits is decimal. */
export function amountValue(written: string): number | undefined {
  const compact = written.replace(/[  ]/gu, '');
  const decimal = /[.,](\d{1,2})$/u.exec(compact);
  const whole = (decimal ? compact.slice(0, decimal.index) : compact).replace(/[.,]/gu, '');
  if (!/^\d+$/u.test(whole)) return undefined;
  const value = Number(decimal ? `${whole}.${decimal[1]}` : whole);
  return Number.isFinite(value) ? value : undefined;
}

/** Half a unit of the last digit written: "0,42" is exact to 0.005, "11" to 0.5. */
function writtenPrecision(written: string): number {
  const decimals = /[.,](\d{1,2})$/u.exec(written.replace(/[  ]/gu, ''))?.[1]?.length ?? 0;
  return 0.5 / 10 ** decimals;
}

function amountsIn(text: string, pattern: RegExp): Amount[] {
  return [...text.matchAll(pattern)].flatMap((match) => {
    const symbol = match[1] ?? match[4] ?? '';
    const number = (match[2] ?? match[3] ?? '').trim();
    const value = amountValue(number);
    const currency = CURRENCY_CODES[symbol];
    return value === undefined || !currency
      ? []
      : [{ written: match[0].trim(), value, currency, precision: writtenPrecision(number) }];
  });
}

/** One quoted price as an estimate: a multiple, per month or per year. */
function singleTerms(price: number): number[] {
  const terms = [price * MONTHS_PER_YEAR, price / MONTHS_PER_YEAR];
  for (let multiple = 2; multiple <= MAX_ESTIMATE_MULTIPLE; multiple += 1) {
    terms.push(price * multiple);
  }
  return terms;
}

/**
 * [amount] is, to the digits written, an estimate from the quoted prices in its currency:
 * one of them multiplied or converted between month and year, or a total of a monthly and
 * a yearly price (a + b/12 a month, 12a + b a year). Two prices of the same period are not
 * added: that would let any amount pass once an answer quotes a few.
 */
function isEstimateFrom(amount: Amount, quoted: ReadonlyArray<Amount>): boolean {
  const near = (candidate: number) => Math.abs(amount.value - candidate) < amount.precision - 1e-9;
  const prices = quoted
    .filter((price) => price.currency === amount.currency && price.value > 0)
    .map((price) => price.value);
  return prices.some(
    (first) =>
      singleTerms(first).some(near) ||
      prices.some(
        (second) =>
          second !== first &&
          (near(first + second / MONTHS_PER_YEAR) || near(first * MONTHS_PER_YEAR + second)),
      ),
  );
}

/**
 * The amounts in [answer] that no tool returned. An amount counts as returned when it is a
 * price a source states in the same currency, rounded to the digits written ("about $11"
 * for $11.08), or an estimate built from prices the answer quotes itself (isEstimateFrom):
 * "$6 a month plus $11.08 a year is about $7 a month". A price rounded past its digits
 * ($0.15 for $0.14) does not count, nor does one no source states.
 */
export function ungroundedAmounts(answer: string, sources: ReadonlyArray<string>): string[] {
  const known = sources.flatMap((source) => amountsIn(source, SOURCE_AMOUNT));
  const sourcePriceFor = (amount: Amount) =>
    known.find(
      (price) =>
        price.currency === amount.currency &&
        Math.abs(amount.value - price.value) < amount.precision - 1e-9,
    );
  const stated = amountsIn(answer, AMOUNT);
  // The source prices the answer quotes (as written or rounded) are what it may build on.
  const quoted = stated.flatMap((amount) => {
    const price = sourcePriceFor(amount);
    return price ? [price] : [];
  });
  // Zero is "free", which the pages say in words ("Always Free"), not as a price.
  return stated.flatMap((amount) =>
    amount.value === 0 || sourcePriceFor(amount) || isEstimateFrom(amount, quoted)
      ? []
      : [amount.written],
  );
}
