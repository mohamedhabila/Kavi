import fs from 'fs';
import path from 'path';

const {
  BENCHMARK_PROVENANCE_SCHEMA_URL,
  checkBenchmarkProvenance,
  hashAdapterRoots,
  loadBenchmarkProvenance,
  loadBenchmarkProvenanceSchema,
  validateBenchmarkProvenance,
} = require('../../scripts/lib/benchmarkProvenance');

const projectRoot = path.resolve(__dirname, '../..');

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('benchmark provenance', () => {
  const schema = loadBenchmarkProvenanceSchema(projectRoot);
  const registry = loadBenchmarkProvenance(projectRoot);

  it('validates every enabled adapter and its checked-in source digest', () => {
    expect(schema.$id).toBe(BENCHMARK_PROVENANCE_SCHEMA_URL);
    expect(checkBenchmarkProvenance(projectRoot)).toEqual([]);
    expect(validateBenchmarkProvenance(registry, schema, projectRoot)).toEqual([]);
  });

  it('rejects missing enabled adapters and unresolved license values', () => {
    const incomplete = clone(registry);
    incomplete.adapters.pop();
    incomplete.adapters[0].licenses.code.spdxId = 'unknown';

    const failures = validateBenchmarkProvenance(incomplete, schema, projectRoot);

    expect(failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('must contain every enabled adapter in order'),
        expect.stringContaining('unresolved values are forbidden'),
      ]),
    );
  });

  it('rejects source drift and mutable upstream references', () => {
    const drifted = clone(registry);
    drifted.adapters[0].adapter.sourceSha256 = '0'.repeat(64);
    drifted.adapters[0].upstream.immutableSourceUrl =
      'https://github.com/xiaowu0162/LongMemEval-V2/tree/main';

    const failures = validateBenchmarkProvenance(drifted, schema, projectRoot);

    expect(failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('must contain the pinned commit'),
        expect.stringContaining('for the checked-in adapter source'),
      ]),
    );
  });

  it('excludes ignored runtime caches from the versionable source digest', () => {
    const roots = registry.adapters[0].adapter.roots;
    const before = hashAdapterRoots(projectRoot, roots);
    const ignoredCache = path.join(
      projectRoot,
      'benchmarks',
      'longmemeval_v2',
      '__pycache__',
      'provenance-test.pyc',
    );
    fs.mkdirSync(path.dirname(ignoredCache), { recursive: true });
    try {
      fs.writeFileSync(ignoredCache, 'machine-dependent-cache');
      expect(hashAdapterRoots(projectRoot, roots)).toBe(before);
    } finally {
      fs.rmSync(ignoredCache, { force: true });
    }
  });

  it('cannot label a result submitted or accepted without a public record', () => {
    const claimed = clone(registry);
    claimed.adapters[1].submission.resultStatus = 'accepted';

    expect(validateBenchmarkProvenance(claimed, schema, projectRoot)).toContain(
      'provenance.adapters[1].submission: submitted results require a submission record URL',
    );
  });

  it('requires canonical service terms for protocol-locked OpenAI models', () => {
    const invalidTerms = clone(registry);
    invalidTerms.adapters[1].models[1].termsUrl = 'https://example.com/terms';

    expect(validateBenchmarkProvenance(invalidTerms, schema, projectRoot)).toContain(
      'provenance.adapters[1].models[1].termsUrl: must use the canonical OpenAI service terms',
    );
  });
});
