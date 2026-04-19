// ---------------------------------------------------------------------------
// Tests — Temporal Decay
// ---------------------------------------------------------------------------

jest.mock('expo-file-system', () => ({
  getInfoAsync: jest.fn(),
}));

import * as FileSystem from 'expo-file-system';
import {
  toDecayLambda,
  calculateTemporalDecayMultiplier,
  applyTemporalDecayToScore,
  applyTemporalDecayToHybridResults,
} from '../../src/services/memory/temporal-decay';

const mockGetInfo = FileSystem.getInfoAsync as jest.Mock;

describe('toDecayLambda', () => {
  it('returns ln(2)/halfLife for positive halfLife', () => {
    expect(toDecayLambda(30)).toBeCloseTo(Math.LN2 / 30, 10);
  });

  it('returns 0 for halfLife <= 0', () => {
    expect(toDecayLambda(0)).toBe(0);
    expect(toDecayLambda(-5)).toBe(0);
  });

  it('returns 0 for Infinity', () => {
    expect(toDecayLambda(Infinity)).toBe(0);
  });

  it('returns 0 for NaN', () => {
    expect(toDecayLambda(NaN)).toBe(0);
  });
});

describe('calculateTemporalDecayMultiplier', () => {
  it('returns 1.0 at age 0', () => {
    expect(calculateTemporalDecayMultiplier({ ageInDays: 0, halfLifeDays: 30 })).toBe(1);
  });

  it('returns ~0.5 at age = halfLife', () => {
    const m = calculateTemporalDecayMultiplier({ ageInDays: 30, halfLifeDays: 30 });
    expect(m).toBeCloseTo(0.5, 5);
  });

  it('returns ~0.25 at age = 2*halfLife', () => {
    const m = calculateTemporalDecayMultiplier({ ageInDays: 60, halfLifeDays: 30 });
    expect(m).toBeCloseTo(0.25, 5);
  });

  it('returns 1 when lambda is 0 (halfLife=0)', () => {
    expect(calculateTemporalDecayMultiplier({ ageInDays: 100, halfLifeDays: 0 })).toBe(1);
  });

  it('clamps negative age to 0', () => {
    const m = calculateTemporalDecayMultiplier({ ageInDays: -10, halfLifeDays: 30 });
    expect(m).toBe(1);
  });
});

describe('applyTemporalDecayToScore', () => {
  it('multiplies score by decay multiplier', () => {
    const result = applyTemporalDecayToScore({
      score: 1.0,
      ageInDays: 30,
      halfLifeDays: 30,
    });
    expect(result).toBeCloseTo(0.5, 5);
  });

  it('preserves score at age 0', () => {
    expect(applyTemporalDecayToScore({ score: 0.8, ageInDays: 0, halfLifeDays: 30 })).toBe(0.8);
  });

  it('scales score proportionally', () => {
    const result = applyTemporalDecayToScore({
      score: 2.0,
      ageInDays: 30,
      halfLifeDays: 30,
    });
    expect(result).toBeCloseTo(1.0, 5);
  });
});

describe('applyTemporalDecayToHybridResults', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns copy of results when disabled', async () => {
    const results = [{ path: 'a.md', score: 0.9, source: 'file' }];
    const out = await applyTemporalDecayToHybridResults({ results });
    expect(out).toEqual(results);
    expect(out).not.toBe(results);
  });

  it('applies decay to dated memory paths', async () => {
    const nowMs = Date.UTC(2025, 0, 31); // Jan 31, 2025
    const results = [
      { path: 'memory/2025-01-01.md', score: 1.0, source: 'memory' },
      { path: 'memory/2025-01-31.md', score: 1.0, source: 'memory' },
    ];

    const out = await applyTemporalDecayToHybridResults({
      results,
      temporalDecay: { enabled: true, halfLifeDays: 30 },
      nowMs,
    });

    expect(out[0].score).toBeCloseTo(0.5, 1);
    expect(out[1].score).toBeCloseTo(1.0, 1);
  });

  it('does not decay evergreen MEMORY.md', async () => {
    const results = [{ path: 'MEMORY.md', score: 0.8, source: 'memory' }];
    const out = await applyTemporalDecayToHybridResults({
      results,
      temporalDecay: { enabled: true, halfLifeDays: 30 },
      nowMs: Date.now(),
    });
    expect(out[0].score).toBe(0.8);
  });

  it('uses file modification time for non-memory files', async () => {
    const nowMs = Date.now();
    const thirtyDaysAgo = (nowMs - 30 * 24 * 60 * 60 * 1000) / 1000;
    mockGetInfo.mockResolvedValueOnce({ exists: true, modificationTime: thirtyDaysAgo });

    const results = [{ path: 'notes.txt', score: 1.0, source: 'file' }];
    const out = await applyTemporalDecayToHybridResults({
      results,
      temporalDecay: { enabled: true, halfLifeDays: 30 },
      workspaceDir: '/workspace',
      nowMs,
    });
    expect(out[0].score).toBeCloseTo(0.5, 1);
  });

  it('does not decay if file does not exist', async () => {
    mockGetInfo.mockResolvedValueOnce({ exists: false });
    const results = [{ path: 'missing.txt', score: 0.9, source: 'file' }];
    const out = await applyTemporalDecayToHybridResults({
      results,
      temporalDecay: { enabled: true, halfLifeDays: 30 },
      workspaceDir: '/workspace',
      nowMs: Date.now(),
    });
    expect(out[0].score).toBe(0.9);
  });

  it('handles getInfoAsync errors gracefully', async () => {
    mockGetInfo.mockRejectedValueOnce(new Error('Permission denied'));
    const results = [{ path: 'secret.txt', score: 0.9, source: 'file' }];
    const out = await applyTemporalDecayToHybridResults({
      results,
      temporalDecay: { enabled: true, halfLifeDays: 30 },
      workspaceDir: '/workspace',
      nowMs: Date.now(),
    });
    expect(out[0].score).toBe(0.9);
  });

  it('caches timestamps for duplicate paths', async () => {
    mockGetInfo.mockResolvedValue({ exists: true, modificationTime: Date.now() / 1000 });
    const results = [
      { path: 'file.txt', score: 0.8, source: 'file' },
      { path: 'file.txt', score: 0.6, source: 'file' },
    ];
    const out = await applyTemporalDecayToHybridResults({
      results,
      temporalDecay: { enabled: true, halfLifeDays: 30 },
      workspaceDir: '/workspace',
      nowMs: Date.now(),
    });
    expect(out).toHaveLength(2);
    expect(mockGetInfo).toHaveBeenCalledTimes(1);
  });

  it('does not decay non-dated memory/ evergreen paths', async () => {
    const results = [{ path: 'memory/topics.md', score: 0.8, source: 'memory' }];
    const out = await applyTemporalDecayToHybridResults({
      results,
      temporalDecay: { enabled: true, halfLifeDays: 30 },
      nowMs: Date.now(),
    });
    expect(out[0].score).toBe(0.8);
  });

  it('handles invalid dates in paths', async () => {
    const results = [{ path: 'memory/2025-13-32.md', score: 0.7, source: 'memory' }];
    const out = await applyTemporalDecayToHybridResults({
      results,
      temporalDecay: { enabled: true, halfLifeDays: 30 },
      nowMs: Date.now(),
    });
    expect(out[0].score).toBe(0.7);
  });
});
