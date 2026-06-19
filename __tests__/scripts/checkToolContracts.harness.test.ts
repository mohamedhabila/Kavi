import { assertAllRegisteredToolsHaveExplicitCapabilities } from '../../src/engine/tools/validateToolContracts';

describe('check-tool-contracts harness', () => {
  it('every registered builtin/core tool has non-empty contract.capabilities', () => {
    expect(() => assertAllRegisteredToolsHaveExplicitCapabilities()).not.toThrow();
  });
});