/// <reference types="jest" />
/// <reference types="node" />

import type { jest as JestRuntime } from '@jest/globals';

declare global {
  const jest: typeof JestRuntime;
}

export {};
