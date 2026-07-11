const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  collectCanonicalMemoryArchitectureViolations,
} = require('../../scripts/check-canonical-memory-architecture');

function writeProjectFile(projectRoot: string, filePath: string, content: string): void {
  const absolutePath = path.join(projectRoot, filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

describe('canonical memory architecture guard', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kavi-memory-architecture-'));
    writeProjectFile(projectRoot, 'src/assistant.ts', 'export const assistant = true;\n');
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('allows only the deletion-only retired artifact cleanup references', () => {
    writeProjectFile(
      projectRoot,
      'src/services/memory/retiredMemoryArtifacts.ts',
      "const retired = ['global-memory', 'conversation-memory', 'memory_chunks'];\n",
    );

    expect(collectCanonicalMemoryArchitectureViolations(projectRoot)).toEqual([]);
  });

  it('rejects retired source APIs and implementation files', () => {
    writeProjectFile(
      projectRoot,
      'src/assistant.ts',
      "import { readGlobalMemory } from './services/memory/store';\n",
    );
    writeProjectFile(projectRoot, 'src/services/memory/store.ts', 'export const store = true;\n');

    expect(collectCanonicalMemoryArchitectureViolations(projectRoot)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('readGlobalMemory'),
        expect.stringContaining('memory/store'),
        expect.stringContaining('restores a retired memory implementation'),
      ]),
    );
  });

  it('is wired into the standard verification gate', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'),
    );

    expect(packageJson.scripts['check:canonical-memory-architecture']).toBe(
      'node ./scripts/check-canonical-memory-architecture.js',
    );
    expect(packageJson.scripts.verify).toContain('npm run check:canonical-memory-architecture');
  });
});
