import { connectE2EMailIntegration } from '../../src/acceptance/e2eAgent/e2eMailIntegration';
import {
  getE2ENativeMobileFixtureStateSnapshot,
  resetE2ENativeMobileFixtures,
} from '../../src/acceptance/e2eAgent/e2eNativeMobileFixtures';
import { PHONE_WORLD_MAILBOX } from '../../src/acceptance/e2eAgent/scenariosPhoneWorld';
import { executeToolInner } from '../../src/engine/tools/toolDispatchRouter';
import { mcpManager } from '../../src/services/mcp/manager';
import { useApprovalStore } from '../../src/services/remote/approvalStore';

async function call(name: string, args: Record<string, unknown>) {
  const outcome = await executeToolInner(`mcp__mail__${name}`, JSON.stringify(args), 'conv-mail');
  return outcome;
}

describe('e2e mail integration', () => {
  beforeEach(() => {
    resetE2ENativeMobileFixtures();
  });

  afterAll(() => {
    mcpManager.disconnectAll();
  });

  it('serves the inbox to Kavi as a mail integration and records replies on the phone', async () => {
    const mail = await connectE2EMailIntegration(PHONE_WORLD_MAILBOX);
    try {
      expect(mcpManager.getStatus('mail')).toMatchObject({ state: 'connected' });
      expect(useApprovalStore.getState().isAllowlisted('mcp__mail__mail_draft_reply')).toBe(true);

      const search = await call('mail_search', { query: 'rui' });
      expect(search.status).toBe('completed');
      expect(search.content).toContain('"m-5"');
      expect(search.content.indexOf('"m-5"')).toBeLessThan(search.content.indexOf('"m-2"'));

      // Every word must appear somewhere in the mail, in any order, ignoring case.
      const words = await call('mail_search', { query: 'RUI month rent' });
      expect(JSON.parse(words.content)).toMatchObject({
        count: 2,
        messages: [{ id: 'm-5' }, { id: 'm-2' }],
      });
      const unmatched = await call('mail_search', { query: 'rent landlord' });
      expect(JSON.parse(unmatched.content)).toEqual({ count: 0, messages: [] });

      const read = await call('mail_read', { id: 'm-4' });
      expect(read.content).toContain('Check-in');

      const draft = await call('mail_draft_reply', {
        message_id: 'm-5',
        body: "I'll pay on Friday.",
      });
      expect(draft.content).toContain('drafted');
      expect(getE2ENativeMobileFixtureStateSnapshot().mail).toEqual({
        replyCount: 1,
        sentCount: 0,
        lastReplyTo: 'm-5',
        lastReplyBody: "I'll pay on Friday.",
        lastReplySent: false,
      });

      await call('mail_send_draft', { draft_id: 'draft-1' });
      expect(getE2ENativeMobileFixtureStateSnapshot().mail).toMatchObject({
        replyCount: 1,
        sentCount: 1,
        lastReplySent: true,
      });

      const missing = await call('mail_draft_reply', { message_id: 'm-99', body: 'Hello' });
      expect(missing.content).toContain('not_found');
      expect(getE2ENativeMobileFixtureStateSnapshot().mail.replyCount).toBe(1);
    } finally {
      await mail.disconnect();
    }

    expect(mcpManager.getStatus('mail')?.state).not.toBe('connected');
    expect(useApprovalStore.getState().isAllowlisted('mcp__mail__mail_draft_reply')).toBe(false);
  });
});
