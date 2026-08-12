import { collectDelegatedWorkspaceWrites } from '../../../src/engine/graph/delegatedWorkspaceWrites';
import { collectDelegatedArtifactEvidence } from '../../../src/engine/graph/delegatedToolEvidence';
import type { Message } from '../../../src/types/message';

// Traced live on an Android emulator. A worker wrote artifacts/tl4/risks.md and terminated
// verified_success, and its terminal result still carried artifactCount: 0, artifacts: null
// — because a worker's artifacts come from message attachments, and a file written with
// write_file attaches nothing.
//
// Delegated-artifact evidence reads that field, so the supervisor's
// evidence.artifact:artifacts/tl4/risks.md criterion could never be satisfied by the
// delegation. The model read the graph correctly and rewrote the file itself:
//
//   "The risks.md and verify goals need the artifact evidence recorded by a parent
//    write_file. Let me write risks.md with the verified worker content to register
//    that evidence."

function toolResult(name: string, content: string): Message {
  return {
    id: `m-${name}-${content.length}`,
    role: 'tool',
    content,
    timestamp: 0,
    toolCallId: 'call-1',
    toolCalls: [{ id: 'call-1', name, arguments: '{}', status: 'completed', result: content }],
  } as Message;
}

const WROTE_RISKS = JSON.stringify({
  status: 'written',
  path: 'artifacts/tl4/risks.md',
  size: 2417,
  summary: 'Wrote 2417 chars to artifacts/tl4/risks.md and verified readback',
});

describe('a worker gets credit for the files it wrote', () => {
  it('reports the path a write_file result verified', () => {
    expect(collectDelegatedWorkspaceWrites([toolResult('write_file', WROTE_RISKS)])).toEqual([
      expect.objectContaining({ workspacePath: 'artifacts/tl4/risks.md' }),
    ]);
  });

  it('reports an edited path too', () => {
    const edited = JSON.stringify({ status: 'edited', path: 'artifacts/tl4/report.md' });
    expect(collectDelegatedWorkspaceWrites([toolResult('file_edit', edited)])).toEqual([
      expect.objectContaining({ workspacePath: 'artifacts/tl4/report.md' }),
    ]);
  });

  it('does not repeat a path written twice', () => {
    const messages = [toolResult('write_file', WROTE_RISKS), toolResult('write_file', WROTE_RISKS)];
    expect(collectDelegatedWorkspaceWrites(messages)).toHaveLength(1);
  });
});

describe('results that prove no file exists', () => {
  it('ignores a read, which names a path it did not create', () => {
    const read = JSON.stringify({ status: 'ok', path: 'artifacts/tl4/risks.md', content: '# x' });
    expect(collectDelegatedWorkspaceWrites([toolResult('read_file', read)])).toEqual([]);
  });

  it('ignores a refused write, which names a path and wrote nothing', () => {
    const refused = JSON.stringify({ status: 'error', path: 'artifacts/tl4/risks.md' });
    expect(collectDelegatedWorkspaceWrites([toolResult('write_file', refused)])).toEqual([]);
  });

  it('ignores a result that is not JSON', () => {
    expect(collectDelegatedWorkspaceWrites([toolResult('write_file', 'wrote the file')])).toEqual(
      [],
    );
  });

  it('handles a transcript with no tool results', () => {
    expect(collectDelegatedWorkspaceWrites([])).toEqual([]);
  });
});

describe('the supervisor can now count a delegated deliverable', () => {
  it('credits the worker path through the evidence collector', () => {
    // The shape the terminal result carries once the worker's writes are collected.
    const evidence = collectDelegatedArtifactEvidence({
      hostToolName: 'sessions_wait',
      result: JSON.stringify({
        status: 'completed',
        completionState: 'verified_success',
        artifacts: collectDelegatedWorkspaceWrites([toolResult('write_file', WROTE_RISKS)]),
      }),
    });

    expect(evidence.some((entry) => entry.includes('artifacts/tl4/risks.md'))).toBe(true);
  });

  it('credits nothing when the worker did not finish verified', () => {
    const evidence = collectDelegatedArtifactEvidence({
      hostToolName: 'sessions_wait',
      result: JSON.stringify({
        status: 'error',
        completionState: 'incomplete',
        artifacts: collectDelegatedWorkspaceWrites([toolResult('write_file', WROTE_RISKS)]),
      }),
    });

    expect(evidence).toEqual([]);
  });
});

describe('tools this module never names', () => {
  // Which tools write, which statuses mean the file landed, and where the path sits are
  // all read from the code-owned effect contracts. image_generate proves it: a different
  // status word ("generated") and a different path key ("workspacePath") than write_file,
  // handled without naming the tool here.
  it('credits an image tool with its own status word and path key', () => {
    const generated = JSON.stringify({
      status: 'generated',
      workspacePath: 'artifacts/tl4/diagram.png',
    });

    expect(collectDelegatedWorkspaceWrites([toolResult('image_generate', generated)])).toEqual([
      expect.objectContaining({ workspacePath: 'artifacts/tl4/diagram.png' }),
    ]);
  });

  it('ignores an artifact.write whose resource is not a workspace file', () => {
    // canvas_create declares artifact.write, but its resource is a canvas surface
    // identified by surfaceId — not a path an evidence.artifact criterion can match.
    const created = JSON.stringify({ status: 'created', surfaceId: 'surface-1' });
    expect(collectDelegatedWorkspaceWrites([toolResult('canvas_create', created)])).toEqual([]);
  });

  it('ignores a tool with no effect contract at all', () => {
    const done = JSON.stringify({ status: 'written', path: 'artifacts/tl4/x.md' });
    expect(collectDelegatedWorkspaceWrites([toolResult('mcp__acme__save', done)])).toEqual([]);
  });
});
