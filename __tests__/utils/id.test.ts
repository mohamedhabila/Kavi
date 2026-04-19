// ---------------------------------------------------------------------------
// Tests — ID Generator
// ---------------------------------------------------------------------------

import { generateId } from '../../src/utils/id';

describe('generateId', () => {
  it('should return a non-empty string', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('should generate unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(1000);
  });

  it('should contain timestamp component', () => {
    const id = generateId();
    // ID format: <base36_timestamp>_<random>_<counter>
    const parts = id.split('_');
    expect(parts.length).toBeGreaterThanOrEqual(3);
  });

  it('should increment counter across calls', () => {
    const id1 = generateId();
    const id2 = generateId();
    const counter1 = parseInt(id1.split('_').pop()!, 10);
    const counter2 = parseInt(id2.split('_').pop()!, 10);
    expect(counter2).toBeGreaterThan(counter1);
  });
});
