const crypto = require('crypto');

const WILSON_95_Z = 1.959963984540054;

function canonicalStringify(value) {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  return typeof encoded === 'string' ? encoded : 'null';
}

function digestCanonicalValue(value) {
  const serialized = canonicalStringify(value);
  return crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
}

function wilson95(successes, total) {
  if (
    !Number.isSafeInteger(successes) ||
    !Number.isSafeInteger(total) ||
    successes < 0 ||
    total < 0 ||
    successes > total
  ) {
    throw new Error('Wilson interval requires bounded integer successes and total.');
  }
  if (total === 0) return null;
  const proportion = successes / total;
  const zSquared = WILSON_95_Z ** 2;
  const denominator = 1 + zSquared / total;
  const center = (proportion + zSquared / (2 * total)) / denominator;
  const margin =
    (WILSON_95_Z / denominator) *
    Math.sqrt((proportion * (1 - proportion)) / total + zSquared / (4 * total ** 2));
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}

function mean(values) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sortedValues, probability) {
  if (sortedValues.length === 0) return null;
  const position = (sortedValues.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sortedValues[lowerIndex];
  const weight = position - lowerIndex;
  return sortedValues[lowerIndex] * (1 - weight) + sortedValues[upperIndex] * weight;
}

function bootstrapPairedMean(values, config) {
  const pointEstimate = mean(values);
  if (values.length === 0) return { mean: null, bootstrap95: null };
  const random = mulberry32(config.seed);
  const estimates = [];
  for (let sampleIndex = 0; sampleIndex < config.samples; sampleIndex += 1) {
    let sum = 0;
    for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
      sum += values[Math.floor(random() * values.length)];
    }
    estimates.push(sum / values.length);
  }
  estimates.sort((left, right) => left - right);
  return {
    mean: pointEstimate,
    bootstrap95: {
      low: percentile(estimates, 0.025),
      high: percentile(estimates, 0.975),
    },
  };
}

module.exports = {
  bootstrapPairedMean,
  canonicalStringify,
  digestCanonicalValue,
  mean,
  wilson95,
};
