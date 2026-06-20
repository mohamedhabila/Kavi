const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

function readRepoFile(relativePath: string): string {
  return readFileSync(join(__dirname, '../..', relativePath), 'utf8');
}

describe('architecture documentation', () => {
  it('does not point contributors at a local LLM runtime barrel', () => {
    const architecture = readRepoFile('ARCHITECTURE.md');
    const localLlmReadme = readRepoFile('src/services/localLlm/README.md');

    expect(architecture).toContain('### `src/services/localLlm`');
    expect(architecture).not.toContain('src/services/localLlm/runtime.ts');
    expect(localLlmReadme).toContain('There is intentionally no `runtime.ts` barrel.');
    expect(existsSync(join(__dirname, '../../src/services/localLlm/runtime.ts'))).toBe(false);
  });
});
