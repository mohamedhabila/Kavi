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
      const verifyIndex = workflow.indexOf(
        fileName === 'ci.yml' ? 'npm run verify' : 'npm run verify:strict',
      );

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
      'actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0',
      'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e',
    ]);
    expect(workflowUses(readWorkflow('agent-e2e-nightly.yml'))).toEqual([
      'actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0',
      'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e',
      'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    ]);
    expect(workflowUses(readWorkflow('codeql.yml'))).toEqual([
      'actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0',
      'github/codeql-action/init@6f5948dfacef28e207b48d0905cf90c03365536d',
      'github/codeql-action/analyze@6f5948dfacef28e207b48d0905cf90c03365536d',
    ]);
    expect(workflowUses(readWorkflow('scorecard.yml'))).toEqual([
      'actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0',
      'ossf/scorecard-action@2d1146689b8cda280b9bc96326124645441f03bc',
      'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
      'github/codeql-action/upload-sarif@6f5948dfacef28e207b48d0905cf90c03365536d',
    ]);

    const actionRefs = readWorkflowFiles().flatMap((fileName) =>
      workflowUses(readWorkflow(fileName)),
    );

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

  it('runs CodeQL analysis on push, pull request, and a weekly schedule with minimal job permissions', () => {
    const codeqlWorkflow = readWorkflow('codeql.yml');

    expect(codeqlWorkflow).toMatch(/on:\n {2}push:\n {4}branches:\n {6}- main/);
    expect(codeqlWorkflow).toMatch(/pull_request:\n {4}branches:\n {6}- main/);
    expect(codeqlWorkflow).toContain('schedule:');
    expect(codeqlWorkflow).toMatch(/cron: '\d+ \d+ \* \* \d'/);
    expect(codeqlWorkflow).toContain('languages: javascript-typescript');
    expect(codeqlWorkflow).toMatch(/permissions:\n {6}contents: read\n {6}security-events: write/);
  });

  it('runs Scorecard analysis on the default branch and a weekly schedule, publishing to code scanning', () => {
    const scorecardWorkflow = readWorkflow('scorecard.yml');

    expect(scorecardWorkflow).toMatch(/on:\n {2}push:\n {4}branches:\n {6}- main/);
    expect(scorecardWorkflow).toContain('schedule:');
    expect(scorecardWorkflow).toMatch(/cron: '\d+ \d+ \* \* \d'/);
    expect(scorecardWorkflow).toContain('publish_results: true');
    expect(scorecardWorkflow).toContain('uses: github/codeql-action/upload-sarif@');
    expect(scorecardWorkflow).not.toContain('pull_request:');
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
