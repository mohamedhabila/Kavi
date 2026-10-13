import {
  resetE2EWorkspaceSandbox,
  seedE2EWorkspaceSandbox,
} from '../../src/acceptance/e2eAgent/sandboxWorkspace';
import { prepareJavaScriptWorkspaceExecution } from '../../src/engine/tools/toolWorkspaceSnapshots';

describe('E2E workspace sandbox', () => {
  beforeEach(() => {
    resetE2EWorkspaceSandbox();
  });

  // Seeded files used to be bare store entries with no folders, so a tool that walks the
  // workspace saw nothing: the JavaScript bridge answered "File not found in bridge cache"
  // for a file read_file had just read, and the eval blamed the model for it.
  it('seeds files that a tool walking the workspace can find', async () => {
    seedE2EWorkspaceSandbox('conv-sandbox', [
      { path: 'finance/transactions.csv', content: 'date,amount\n2026-10-01,2.90' },
      { path: 'notes.md', content: '# Notes' },
    ]);

    await expect(prepareJavaScriptWorkspaceExecution('conv-sandbox')).resolves.toEqual([
      { path: 'finance/transactions.csv', content: 'date,amount\n2026-10-01,2.90' },
      { path: 'notes.md', content: '# Notes' },
    ]);
  });
});
