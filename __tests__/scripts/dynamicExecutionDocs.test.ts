const { readFileSync } = require('fs');
const { join } = require('path');

const projectRoot = join(__dirname, '../..');

function readRepoFile(relativePath: string): string {
  return readFileSync(join(projectRoot, relativePath), 'utf8');
}

function normalizeSourceText(relativePath: string): string {
  return readRepoFile(relativePath).replace(/\/\/\s*/g, '').replace(/\s+/g, ' ');
}

describe('dynamic execution documentation', () => {
  const documentedSurfaces = [
    'src/utils/javascript.ts',
    'src/utils/jsBridgeExecution.ts',
    'src/services/integrations/productivity/skill.ts',
    'src/components/canvas/CanvasSurfacePresenter.tsx',
  ];

  it('documents every intentional dynamic execution surface', () => {
    const docs = readRepoFile('docs/dynamic-code-execution.md');

    for (const surface of documentedSurfaces) {
      expect(docs).toContain(surface);
    }

    expect(docs).toContain('not security sandboxes');
    expect(docs).toContain('trusted-by-user app runtime code');
    expect(docs).toContain('path traversal out of');
    expect(docs).toContain('arithmetic-only tool input');
    expect(docs).toContain('active canvas WebView document');
  });

  it('keeps source comments near each Function call', () => {
    expect(normalizeSourceText('src/utils/javascript.ts')).toContain(
      'not a security sandbox; callers must treat it as trusted-by-user code',
    );
    expect(normalizeSourceText('src/utils/jsBridgeExecution.ts')).toContain(
      'not an isolation boundary for hostile code',
    );
    expect(normalizeSourceText('src/services/integrations/productivity/skill.ts')).toContain(
      'not a general JavaScript execution surface',
    );
    expect(normalizeSourceText('src/components/canvas/CanvasSurfacePresenter.tsx')).toContain(
      'must not be treated as a sandbox',
    );
  });
});
