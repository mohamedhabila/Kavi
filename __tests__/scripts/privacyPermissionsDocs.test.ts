const { readFileSync } = require('fs');
const { join } = require('path');

function readPrivacyDoc(): string {
  return readFileSync(join(__dirname, '../../docs/privacy-and-permissions.md'), 'utf8');
}

describe('privacy and permissions documentation', () => {
  it('documents agent execution boundaries for contributor-facing surfaces', () => {
    const doc = readPrivacyDoc();

    expect(doc).toContain('## Agent Execution Boundaries');
    expect(doc).toContain('Primary mobile graph');
    expect(doc).toContain('On-device model');
    expect(doc).toContain('Configured LLM provider');
    expect(doc).toContain('Built-in tools');
    expect(doc).toContain('MCP, SSH, workspace, and browser');
    expect(doc).toContain('Background and sub-agent work');
    expect(doc).toContain('must not expand permissions beyond the initiating workflow');
  });
});
