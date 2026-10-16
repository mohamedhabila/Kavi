const mockGetSecure = jest.fn();
jest.mock('../../../../src/services/storage/SecureStorage', () => ({
  getSecure: (...args: unknown[]) => mockGetSecure(...args),
}));

import { resolveDirectSendReview } from '../../../../src/engine/tools/native/directSendReview';
import {
  CODE_OWNED_EFFECT_FREE_SERVICE_TOOL_NAMES,
  createCodeOwnedServiceToolDefinitions,
} from '../../../../src/services/integrations/codeOwnedServiceTools';
import { createCommunicationSkill } from '../../../../src/services/integrations/communication/skill';
import { buildApprovalGrantCandidate } from '../../../../src/services/remote/approvalGrants';
import { requiresActionApproval } from '../../../../src/services/remote/approvalPolicy';
import { SETUP_TOPICS } from '../../../../src/services/setup/setupGuideTypes';

const CALL = 'skill__communication__agent_call';
const CALL_ARGS = {
  phoneNumber: '+1 415 555 0100',
  callerName: 'Sam',
  language: 'en-US',
  opening: "I'd like to book a table for two tonight at 8.",
  goal: 'Book a table for two tonight at 8 pm; 7:30 to 9 pm is fine.',
  mayShare: 'Booking name Sam Lee',
};

function tool(name: string) {
  const found = createCommunicationSkill().tools.find((candidate) => candidate.name === name);
  if (!found?.handler) throw new Error(`no ${name} tool`);
  return (args: Record<string, unknown>) => found.handler!(args, {});
}

function answer(status: number, body: unknown) {
  global.fetch = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

function parsed(outcome: { content: string }) {
  return JSON.parse(outcome.content) as Record<string, unknown>;
}

const realFetch = global.fetch;
beforeEach(() => {
  mockGetSecure.mockReset();
  mockGetSecure.mockResolvedValue('bland-key');
});
afterAll(() => {
  global.fetch = realFetch;
});

describe('agent_call', () => {
  it('starts the call and hands back the id to follow it with', async () => {
    answer(200, {
      status: 'success',
      message: 'Call successfully queued.',
      call_id: 'c-123456789',
    });

    const outcome = await tool('agent_call')(CALL_ARGS);

    expect(outcome.status).toBe('completed');
    expect(parsed(outcome)).toMatchObject({
      status: 'call_started',
      callId: 'c-123456789',
      number: '+1 415 555 0100',
      maxMinutes: 5,
      language: 'en-US',
      next: expect.stringContaining('skill__communication__agent_call_status'),
    });
    const sent = JSON.parse(String(jest.mocked(global.fetch).mock.calls[0]![1]!.body));
    expect(sent).toMatchObject({ phone_number: '+14155550100', record: true });
  });

  it('refuses unusable arguments without calling Bland', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;

    const outcome = await tool('agent_call')({ ...CALL_ARGS, phoneNumber: '911' });

    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'invalid_arguments' });
    expect(parsed(outcome).error).toContain('phone_call');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends a rejected key back to the setup guide that fixes it', async () => {
    answer(401, { data: null, errors: [{ error: 'AUTH_FAILURE', message: 'Unauthorized' }] });

    const outcome = await tool('agent_call')(CALL_ARGS);

    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'auth' });
    expect(parsed(outcome)).toMatchObject({
      status: 'auth_failed',
      next: expect.stringContaining('setup_guide with topic phone_calls'),
    });
    expect(SETUP_TOPICS).toContain('phone_calls');
  });

  it('says what to do about missing credit and the rate limit', async () => {
    answer(402, { status: 'error', message: 'Insufficient balance.' });
    const credit = await tool('agent_call')(CALL_ARGS);
    expect(credit).toMatchObject({ status: 'failed', failureKind: 'permission' });
    expect(parsed(credit)).toMatchObject({
      status: 'needs_credit',
      next: expect.stringContaining('app.bland.ai'),
    });

    answer(429, { status: 'error', message: 'Rate limit exceeded' });
    const limited = await tool('agent_call')(CALL_ARGS);
    expect(limited).toMatchObject({ status: 'failed', failureKind: 'rate_limited' });
    expect(parsed(limited).next).toContain('10 seconds');
  });

  it('never calls twice when it cannot tell whether the call went out', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('Network request failed');
    }) as unknown as typeof fetch;

    const outcome = await tool('agent_call')(CALL_ARGS);

    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'reconciliation_required' });
    expect(parsed(outcome)).toMatchObject({
      status: 'unknown',
      next: expect.stringContaining('Do not call again'),
    });
  });

  it('points the person to setup when no key is set', async () => {
    mockGetSecure.mockResolvedValue(null);

    const outcome = await tool('agent_call')(CALL_ARGS);

    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'unavailable' });
    expect(parsed(outcome)).toMatchObject({ status: 'not_configured' });
  });
});

describe('agent_call_status and agent_call_stop', () => {
  it('reads the call once for a wait of 0', async () => {
    answer(200, { completed: false, queue_status: 'started' });

    const outcome = await tool('agent_call_status')({ callId: 'c-123456789', waitSeconds: 0 });

    expect(parsed(outcome)).toEqual({
      status: 'in_progress',
      callId: 'c-123456789',
      queueStatus: 'started',
      transcript: [],
    });
  });

  it('ends a call', async () => {
    answer(200, { status: 'success', message: 'Call ended successfully.' });

    const outcome = await tool('agent_call_stop')({ callId: 'c-123456789' });

    expect(parsed(outcome)).toEqual({
      status: 'stopped',
      callId: 'c-123456789',
      message: 'Call ended successfully.',
    });
    expect(jest.mocked(global.fetch).mock.calls[0]![0]).toBe(
      'https://api.bland.ai/v1/calls/c-123456789/stop',
    );
  });

  it('refuses a call id that is not one', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;

    for (const name of ['agent_call_status', 'agent_call_stop']) {
      await expect(tool(name)({ callId: '../calls' })).resolves.toMatchObject({
        status: 'failed',
        failureKind: 'invalid_arguments',
      });
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('how the calling tools are offered', () => {
  const definitions = createCodeOwnedServiceToolDefinitions().filter((definition) =>
    definition.name.startsWith('skill__communication__'),
  );

  it('offers all three only once the Bland key is set', () => {
    expect(definitions.map((definition) => definition.name)).toEqual([
      CALL,
      'skill__communication__agent_call_status',
      'skill__communication__agent_call_stop',
    ]);
    for (const definition of definitions) {
      expect(definition.contract?.runtimeRequirements).toEqual(['secret:BLAND_API_KEY']);
    }
  });

  it('asks before every call, never remembering an approval; following and ending need none', () => {
    expect(requiresActionApproval(CALL, CALL_ARGS)).toBe(true);
    expect(
      buildApprovalGrantCandidate({ toolName: CALL, riskLevel: 'low', destructive: false }),
    ).toBeUndefined();
    expect(
      buildApprovalGrantCandidate({
        toolName: 'skill__github__create_issue',
        riskLevel: 'low',
        destructive: false,
      }),
    ).toBeDefined();
    expect(requiresActionApproval('skill__communication__agent_call_status', {})).toBe(false);
    expect(requiresActionApproval('skill__communication__agent_call_stop', {})).toBe(false);
    expect(CODE_OWNED_EFFECT_FREE_SERVICE_TOOL_NAMES).toContain(
      'skill__communication__agent_call_status',
    );
    expect(CODE_OWNED_EFFECT_FREE_SERVICE_TOOL_NAMES).not.toContain(CALL);
  });

  it('shows the number, the opening, the goal, what is shared and the cost on the approval card', async () => {
    await expect(resolveDirectSendReview(CALL, { ...CALL_ARGS, maxMinutes: 3 })).resolves.toEqual({
      title: 'Kavi calls +1 415 555 0100 for you',
      description:
        "Says: I'd like to book a table for two tonight at 8. · Goal: Book a table for two tonight at 8 pm; 7:30 to 9 pm is fine. · May share: Booking name Sam Lee · Up to 3 min, charged to your Bland account",
    });
  });

  it('keeps a long brief within the card and its cost line visible', async () => {
    const review = await resolveDirectSendReview(CALL, {
      ...CALL_ARGS,
      opening: 'o'.repeat(250),
      goal: 'g'.repeat(550),
      mayShare: 's'.repeat(250),
    });

    expect(Array.from(review!.description).length).toBeLessThanOrEqual(500);
    expect(review!.description).toMatch(/Up to 5 min, charged to your Bland account$/u);
  });

  it('falls back to the redacted summary when the number or brief is missing', async () => {
    await expect(
      resolveDirectSendReview(CALL, { ...CALL_ARGS, phoneNumber: 'abc' }),
    ).resolves.toBeUndefined();
    await expect(
      resolveDirectSendReview(CALL, { ...CALL_ARGS, goal: '' }),
    ).resolves.toBeUndefined();
  });
});
