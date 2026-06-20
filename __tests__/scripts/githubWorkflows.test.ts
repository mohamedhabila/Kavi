const { readFileSync, readdirSync } = require('fs');
const { join } = require('path');

const workflowsDir = join(__dirname, '../../.github/workflows');
const actionShaPattern = /^[^@\s]+@[a-f0-9]{40}$/;

function readWorkflow(fileName: string): string {
  return readFileSync(join(workflowsDir, fileName), 'utf8');
}

function readWorkflowFiles(): string[] {
  return readdirSync(workflowsDir)
    .filter((fileName: string) => /\.ya?ml$/.test(fileName))
    .sort();
}

function workflowUses(content: string): string[] {
  return Array.from(content.matchAll(/^\s*uses:\s*([^\s#]+)\s*$/gm), (match) => match[1]);
}

function checkoutStepBlocks(content: string): string[] {
  const lines = content.split('\n');
  return lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /\s*uses:\s*actions\/checkout@/.test(line))
    .map(({ index }) => lines.slice(index, index + 5).join('\n'));
}

describe('GitHub workflows', () => {
  it('runs pull request CI through the same contributor verification gate', () => {
    const ciWorkflow = readWorkflow('ci.yml');

    expect(ciWorkflow).toContain('pull_request:');
    expect(ciWorkflow).toContain('sudo apt-get install -y ripgrep');
    expect(ciWorkflow).toContain('run: npm run verify');
    expect(ciWorkflow).not.toMatch(/run:\s*npm run (?:check:public-hygiene|lint|typecheck)\b/);
    expect(ciWorkflow).not.toContain('npm test -- --runInBand');
    expect(ciWorkflow).not.toContain('secrets.');
  });

  it('installs ripgrep before verification gates that rely on rg', () => {
    for (const fileName of ['ci.yml', 'agent-e2e-nightly.yml']) {
      const workflow = readWorkflow(fileName);
      const installIndex = workflow.indexOf('sudo apt-get install -y ripgrep');
      const verifyIndex = workflow.indexOf(fileName === 'ci.yml' ? 'npm run verify' : 'npm run verify:strict');

      expect(installIndex).toBeGreaterThan(-1);
      expect(verifyIndex).toBeGreaterThan(-1);
      expect(installIndex).toBeLessThan(verifyIndex);
    }
  });

  it('uses read-only default token permissions in every workflow', () => {
    for (const fileName of readWorkflowFiles()) {
      const workflow = readWorkflow(fileName);
      expect(workflow).toMatch(/^permissions:\n  contents: read\n\njobs:/m);
    }
  });

  it('pins action dependencies to full commit SHAs', () => {
    expect(workflowUses(readWorkflow('ci.yml'))).toEqual([
      'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
      'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    ]);
    expect(workflowUses(readWorkflow('agent-e2e-nightly.yml'))).toEqual([
      'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
      'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
      'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    ]);

    const actionRefs = readWorkflowFiles().flatMap((fileName) => workflowUses(readWorkflow(fileName)));

    for (const actionRef of actionRefs) {
      expect(actionRef).toMatch(actionShaPattern);
    }
  });

  it('does not persist checkout credentials in workflow worktrees', () => {
    for (const fileName of readWorkflowFiles()) {
      const workflow = readWorkflow(fileName);
      for (const checkoutBlock of checkoutStepBlocks(workflow)) {
        expect(checkoutBlock).toContain('persist-credentials: false');
      }
    }
  });

  it('avoids untrusted pull request execution patterns', () => {
    const workflows = readWorkflowFiles().map((fileName) => readWorkflow(fileName).toLowerCase());
    const combinedWorkflows = workflows.join('\n--- workflow ---\n');
    const nightlyWorkflow = readWorkflow('agent-e2e-nightly.yml');

    expect(combinedWorkflows).not.toContain('pull_request_target:');
    expect(combinedWorkflows).not.toMatch(/\$\{\{\s*github\.event\.pull_request/);
    expect(nightlyWorkflow).toContain('schedule:');
    expect(nightlyWorkflow).toContain('workflow_dispatch:');
    expect(nightlyWorkflow).not.toContain('pull_request:');
    expect(nightlyWorkflow).toContain('run: npm run verify:strict');
  });
});
