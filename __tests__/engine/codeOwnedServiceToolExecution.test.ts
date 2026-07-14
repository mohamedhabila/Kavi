jest.mock('../../src/services/storage/SecureStorage', () => ({
  getSecure: jest.fn(async () => 'weather-key'),
}));

import { buildCodeOwnedToolContractIdentity } from '../../src/engine/toolExecution/toolContractIdentity';
import { executeTool } from '../../src/engine/tools';
import { registerBuiltInServiceSkills } from '../../src/services/integrations/registry';
import { getSkillToolDefinitions, unregisterSkill } from '../../src/services/skills/manager';
import type { ToolEffectReceipt } from '../../src/types/toolEffectReceipt';
import type { ToolRuntimeOutcome } from '../../src/types/toolRuntimeOutcome';

const CODE_OWNED_SKILL_IDS = [
  'communication',
  'finance',
  'github',
  'knowledge',
  'media',
  'productivity',
  'weather',
];
const mockFetch = jest.fn();

async function executeCodeOwnedServiceTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ result: ToolRuntimeOutcome; receipt: ToolEffectReceipt }> {
  const declaration = getSkillToolDefinitions().find((tool) => tool.name === name);
  if (!declaration) throw new Error(`Missing declaration: ${name}`);
  let receipt: ToolEffectReceipt | undefined;
  const result = await executeTool(name, JSON.stringify(args), 'conversation-service', {
    toolCallId: `call-${name}`,
    agentRunId: 'run-service',
    executionRunId: 'execution-run-service',
    runtimeToolDeclaration: declaration,
    captureEffectReceipt: (captured) => {
      receipt = captured;
    },
  });
  if (!receipt) throw new Error(`Missing receipt: ${name}`);
  return { result, receipt };
}

beforeEach(() => {
  mockFetch.mockReset();
  (global as { fetch?: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
  registerBuiltInServiceSkills();
});

afterEach(() => {
  for (const skillId of CODE_OWNED_SKILL_IDS) unregisterSkill(skillId);
});

describe('code-owned service tool execution', () => {
  it('keeps reviewed weather, finance, and communication definitions code-owned', async () => {
    await expect(
      Promise.all(
        [
          'skill__weather__current',
          'skill__finance__crypto_price',
          'skill__communication__draft_email',
        ].map((name) => buildCodeOwnedToolContractIdentity(name)),
      ),
    ).resolves.toEqual([
      expect.objectContaining({ kind: 'code_owned', toolName: 'skill__weather__current' }),
      expect.objectContaining({ kind: 'code_owned', toolName: 'skill__finance__crypto_price' }),
      expect.objectContaining({
        kind: 'code_owned',
        toolName: 'skill__communication__draft_email',
      }),
    ]);
  });

  it('returns verified effect-free service results instead of reconciliation errors', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ name: 'Amsterdam', country: 'NL', lat: 52.37, lon: 4.9 }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'Amsterdam',
          dt: 1,
          main: { temp: 20, feels_like: 20, humidity: 50, pressure: 1010 },
          weather: [{ description: 'clear' }],
          wind: { speed: 2 },
          clouds: { all: 0 },
          sys: { country: 'NL' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ bitcoin: { usd: 60_000 } }),
      });

    const weather = await executeCodeOwnedServiceTool('skill__weather__current', {
      location: 'Amsterdam',
    });
    const finance = await executeCodeOwnedServiceTool('skill__finance__crypto_price', {
      coinId: 'bitcoin',
      vsCurrency: 'USD',
    });
    const communication = await executeCodeOwnedServiceTool('skill__communication__draft_email', {
      subject: 'Hello',
      context: 'Follow up',
    });

    for (const execution of [weather, finance, communication]) {
      expect(execution.result.status).toBe('completed');
      expect(JSON.parse(execution.result.content)).not.toHaveProperty(
        'code',
        'tool_effect_reconciliation_required',
      );
      expect(execution.receipt).toMatchObject({
        contractIdentity: { kind: 'code_owned' },
        transportState: 'returned',
        effectState: 'none',
        verificationState: 'not_applicable',
      });
    }
  });
});
