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
      [
        "import { Directory, Paths } from 'expo-file-system';",
        "const RETIRED_MEMORY_DIRECTORY_NAMES = ['global-memory', 'conversation-memory'] as const;",
        "database.execSync('DROP TABLE IF EXISTS memory_chunks');",
        "database.execSync('DROP TABLE IF EXISTS memory_product_experience_observations;');",
      ].join('\n'),
    );

    expect(collectCanonicalMemoryArchitectureViolations(projectRoot)).toEqual([]);
  });

  it('rejects a retired table read hidden in the cleanup module', () => {
    writeProjectFile(
      projectRoot,
      'src/services/memory/retiredMemoryArtifacts.ts',
      "database.getAllSync('SELECT * FROM memory_chunks');\n",
    );

    expect(collectCanonicalMemoryArchitectureViolations(projectRoot)).toEqual(
      expect.arrayContaining([expect.stringContaining('uses retired chunk table')]),
    );
  });

  it('rejects arbitrary retired directory use hidden in the cleanup module', () => {
    writeProjectFile(
      projectRoot,
      'src/services/memory/retiredMemoryArtifacts.ts',
      "const restoredDirectory = 'global-memory';\n",
    );

    expect(collectCanonicalMemoryArchitectureViolations(projectRoot)).toEqual(
      expect.arrayContaining([expect.stringContaining('uses retired Markdown memory directories')]),
    );
  });

  it('rejects a renamed file-backed memory service', () => {
    writeProjectFile(
      projectRoot,
      'src/services/memory/profileRepository.ts',
      "import { File } from 'expo-file-system';\n",
    );

    expect(collectCanonicalMemoryArchitectureViolations(projectRoot)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('uses file-backed memory persistence dependency'),
      ]),
    );
  });

  it('rejects retired memory artifacts in native production source', () => {
    writeProjectFile(
      projectRoot,
      'android/app/src/main/java/com/kavi/app/LegacyMemory.kt',
      'const val MEMORY_FILE = "memory.md"\n',
    );

    expect(collectCanonicalMemoryArchitectureViolations(projectRoot)).toEqual(
      expect.arrayContaining([expect.stringContaining('uses retired Markdown memory file')]),
    );
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

  it('allows only the one-way product-experience table drop and rejects restoration', () => {
    writeProjectFile(
      projectRoot,
      'src/services/memory/retiredMemoryArtifacts.ts',
      "database.execSync('DROP TABLE IF EXISTS memory_product_experience_observations;');\n",
    );
    expect(collectCanonicalMemoryArchitectureViolations(projectRoot)).toEqual([]);

    writeProjectFile(
      projectRoot,
      'src/services/memory/productExperienceObservationStore.ts',
      "db.getAllSync('SELECT * FROM memory_product_experience_observations');\n",
    );
    expect(collectCanonicalMemoryArchitectureViolations(projectRoot)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('restores a retired memory implementation'),
        expect.stringContaining('uses retired product-experience table'),
      ]),
    );
  });

  it('allows only the one-way raw-block table drop and rejects restoring its store or tools', () => {
    writeProjectFile(
      projectRoot,
      'src/services/memory/schema.ts',
      'DROP TABLE IF EXISTS memory_blocks;\n',
    );
    expect(collectCanonicalMemoryArchitectureViolations(projectRoot)).toEqual([]);

    writeProjectFile(
      projectRoot,
      'src/services/memory/blocks.ts',
      "export function ensureDefaultBlocks() { return 'memory_block_read'; }\n",
    );
    expect(collectCanonicalMemoryArchitectureViolations(projectRoot)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('restores a retired memory implementation'),
        expect.stringContaining('uses retired provider-editable raw memory API'),
      ]),
    );
  });

  it('rejects every bare fact mutation from product modules', () => {
    writeProjectFile(
      projectRoot,
      'src/services/memory/newProductWriter.ts',
      [
        'recordFact(input);',
        'recordFactWithApplicability(input, applicability);',
        'replaceCurrentFact(input);',
        'replaceCurrentFactWithApplicability(input, applicability);',
      ].join('\n'),
    );

    expect(collectCanonicalMemoryArchitectureViolations(projectRoot)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('recordFact(input)'),
        expect.stringContaining('recordFactWithApplicability'),
        expect.stringContaining('replaceCurrentFact(input)'),
        expect.stringContaining('replaceCurrentFactWithApplicability'),
        expect.stringContaining('uses bare fact mutation outside approved low-level modules'),
      ]),
    );
  });

  it('keeps the bare mutation allowlist exact to its two low-level owners', () => {
    writeProjectFile(
      projectRoot,
      'src/services/memory/facts/mutations.ts',
      ['export function recordFact() {}', 'export function recordFactWithApplicability() {}'].join(
        '\n',
      ),
    );
    writeProjectFile(
      projectRoot,
      'src/services/memory/facts/exactReplacement.ts',
      [
        'recordFactWithApplicability(input, applicability);',
        'export function replaceCurrentFact() {}',
        'export function replaceCurrentFactWithApplicability() {}',
      ].join('\n'),
    );
    expect(collectCanonicalMemoryArchitectureViolations(projectRoot)).toEqual([]);

    writeProjectFile(projectRoot, 'src/acceptance/fixtures/seedMemory.ts', 'recordFact(input);\n');
    expect(collectCanonicalMemoryArchitectureViolations(projectRoot)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('src/acceptance/fixtures/seedMemory.ts'),
        expect.stringContaining('uses bare fact mutation outside approved low-level modules'),
      ]),
    );

    writeProjectFile(
      projectRoot,
      'src/services/memory/facts/newProductWriter.ts',
      'recordFactWithApplicability(input, applicability);\n',
    );
    expect(collectCanonicalMemoryArchitectureViolations(projectRoot)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('src/services/memory/facts/newProductWriter.ts'),
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
