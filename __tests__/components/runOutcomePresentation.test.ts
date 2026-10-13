import { buildRunOutcomeEntries } from '../../src/components/chat/runOutcomePresentation';
import type { ToolCall } from '../../src/types/message';
import type {
  ToolEffectKind,
  ToolEffectReceipt,
  ToolEffectState,
} from '../../src/types/toolEffectReceipt';

function receipt(
  effectKind: ToolEffectKind,
  effectState: ToolEffectState,
  resource?: ToolEffectReceipt['resource'],
): ToolEffectReceipt {
  return {
    version: 2,
    receiptId: `ter_${effectKind}_${effectState}`,
    toolCallId: 'tc',
    toolName: 'tool',
    contractIdentity: {} as ToolEffectReceipt['contractIdentity'],
    executionRunId: 'run-1',
    transportState: 'returned',
    effectKind,
    effectState,
    verificationState: 'verified',
    requestDigest: 'sha256:a',
    resultDigest: 'sha256:b',
    ...(resource ? { resource } : {}),
    recordedAt: 1,
  };
}

function call(
  id: string,
  name: string,
  args: Record<string, unknown> | string,
  receipts: ToolEffectReceipt[] = [],
): ToolCall {
  return {
    id,
    name,
    arguments: typeof args === 'string' ? args : JSON.stringify(args),
    status: 'completed',
    ...(receipts.length ? { effectReceipts: receipts } : {}),
  };
}

describe('what a reply actually did', () => {
  it('lists the changes the receipts prove, in order, with what each touched', () => {
    const entries = buildRunOutcomeEntries([
      call('read', 'read_file', { path: 'inbox/01.txt' }, [receipt('observation.read', 'none')]),
      call('write', 'write_file', { path: 'trips/lisbon.md', content: 'x' }, [
        receipt('artifact.write', 'applied', { kind: 'workspace_file', id: 'trips/lisbon.md' }),
      ]),
      call('event', 'calendar_create_event', { title: 'Flight KV 418' }, [
        receipt('calendar.create', 'applied', { kind: 'calendar_event', id: 'e-1' }),
      ]),
      call('sms', 'sms_compose', { recipients: ['+15550101001'], message: 'Landing 14:25' }, [
        receipt('communication.draft_handoff', 'handed_off'),
      ]),
    ]);

    expect(entries).toEqual([
      expect.objectContaining({
        effectKind: 'artifact.write',
        state: 'done',
        detail: 'trips/lisbon.md',
      }),
      expect.objectContaining({
        effectKind: 'calendar.create',
        state: 'done',
        detail: 'Flight KV 418',
      }),
      expect.objectContaining({
        effectKind: 'communication.draft_handoff',
        state: 'done',
        detail: '+15550101001',
      }),
    ]);
  });

  // A reply once said it had saved the trip sheet and created the calendar event when
  // only the text had been drafted; the rows come from receipts, so they cannot agree.
  it('shows only what happened, whatever the reply claims', () => {
    const entries = buildRunOutcomeEntries([
      call('catalog', 'tool_catalog', { query: 'calendar create event' }),
      call('sms', 'sms_compose', { recipients: ['+15550101001'] }, [
        receipt('communication.draft_handoff', 'handed_off'),
      ]),
    ]);

    expect(entries.map((entry) => entry.effectKind)).toEqual(['communication.draft_handoff']);
  });

  it('marks a change that did not go through, and one still in progress', () => {
    const entries = buildRunOutcomeEntries([
      call('reminder', 'reminder', { title: 'Check in online' }, [
        receipt('reminder.schedule', 'failed'),
      ]),
      call('worker', 'sessions_spawn', { name: 'triage' }, [receipt('workflow.start', 'pending')]),
    ]);

    expect(entries.map((entry) => [entry.state, entry.detail])).toEqual([
      ['failed', 'Check in online'],
      ['pending', 'triage'],
    ]);
  });

  it('reads the latest receipt of a call and lets a retry that worked replace the failure', () => {
    const entries = buildRunOutcomeEntries([
      call('first', 'write_file', { path: 'out/summary.md' }, [
        receipt('artifact.write', 'failed'),
      ]),
      call('second', 'write_file', { path: 'out/summary.md' }, [
        receipt('artifact.write', 'pending'),
        receipt('artifact.write', 'applied', { kind: 'workspace_file', id: 'out/summary.md' }),
      ]),
    ]);

    expect(entries).toEqual([
      expect.objectContaining({ id: 'second', state: 'done', detail: 'out/summary.md' }),
    ]);
  });

  it('leaves out reads, calculations, calls without receipts and effect-free outcomes', () => {
    expect(
      buildRunOutcomeEntries([
        call('search', 'web_search', { queries: ['lisbon'] }, [
          receipt('observation.read', 'none'),
        ]),
        call('code', 'javascript', { code: '1+1' }, [receipt('compute.execute', 'applied')]),
        call('list', 'reminder', { action: 'list' }, [receipt('reminder.schedule', 'none')]),
        call('bare', 'write_file', { path: 'a.md' }),
      ]),
    ).toEqual([]);
  });

  it('keeps the row when the arguments cannot be read, and shortens a long detail', () => {
    const long = 'x'.repeat(200);
    const entries = buildRunOutcomeEntries([
      call('bad', 'memory_remember', '{not json', [receipt('memory.write', 'applied')]),
      call('long', 'memory_remember', { content: long }, [receipt('memory.write', 'applied')]),
    ]);

    expect(entries[0]).toEqual(expect.objectContaining({ id: 'bad', state: 'done' }));
    expect(entries[0].detail).toBeUndefined();
    expect(Array.from(entries[1].detail ?? '')).toHaveLength(80);
    expect(entries[1].detail?.endsWith('…')).toBe(true);
  });
});
