import {
  buildUnsupportedEffectContractBlock,
  resolveUnsupportedEffectContract,
} from '../../src/engine/toolExecution/toolEffectCompletionContract';
import {
  buildToolEffectReceipt,
  digestToolEffectRequest,
  digestToolEffectText,
} from '../../src/engine/toolExecution/toolEffectReceipt';
import * as receiptContracts from '../../src/engine/toolExecution/toolEffectReceiptContracts';

describe('unsupported effect contracts', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ['read_file', { path: 'artifacts/out.txt' }],
    ['sessions_spawn', { prompt: 'Research the release.' }],
    ['cron', { action: 'list' }],
    ['cron', { action: 'create', name: 'Brief', schedule: '0 9 * * *', prompt: 'Brief me.' }],
    ['mcp__docs__fetch', { path: '/docs' }],
    ['phone_call', { phoneNumber: '+15550100' }],
    ['share_text', { text: 'test' }],
    ['canvas_create', { html: '<p>test</p>' }],
    ['write_file', { path: 'artifacts/out.txt', content: 'EXPECTED' }],
    ['memory_remember', { subject: 'user', predicate: 'city', value: 'Utrecht' }],
  ])('lets %s run with structured arguments', (toolName, args) => {
    expect(
      resolveUnsupportedEffectContract({ toolName, argumentsText: JSON.stringify(args) }),
    ).toBeNull();
  });

  it.each(['not-json', '[]', '"text"', 'null'])(
    'refuses an effectful call whose arguments are %s',
    (argumentsText) => {
      expect(resolveUnsupportedEffectContract({ toolName: 'write_file', argumentsText })).toEqual({
        toolName: 'write_file',
        code: 'effect_arguments_invalid',
      });
    },
  );

  it('does not inspect the arguments of an effect-free call', () => {
    expect(
      resolveUnsupportedEffectContract({ toolName: 'read_file', argumentsText: 'not-json' }),
    ).toBeNull();
  });

  it('refuses a declared effect the code-owned contracts cannot describe', () => {
    jest.spyOn(receiptContracts, 'getCodeOwnedToolEffectContract').mockReturnValue(undefined);

    expect(
      resolveUnsupportedEffectContract({
        toolName: 'write_file',
        argumentsText: JSON.stringify({ path: 'a.txt', content: 'x' }),
      }),
    ).toEqual({ toolName: 'write_file', code: 'effect_contract_unavailable' });
  });

  it('tells the model not to run or claim the refused effect', () => {
    const block = JSON.parse(
      buildUnsupportedEffectContractBlock({
        toolName: 'write_file',
        code: 'effect_arguments_invalid',
      }),
    );

    expect(block).toEqual({
      status: 'error',
      code: 'effect_arguments_invalid',
      tool: 'write_file',
      message:
        'The code-owned effect contract cannot prove this mutation. Do not execute or claim completion.',
    });
  });

  it('keeps request identity stable across reordered and whitespace-varied JSON retries', async () => {
    const first = '{"path":"artifacts/out.txt","content":"EXPECTED"}';
    const retry = '{  "content" : "EXPECTED", "path" : "artifacts/out.txt" }';
    const contentDigest = await digestToolEffectText('EXPECTED');

    const receipt = await buildToolEffectReceipt({
      executionRunId: 'execution-run-1',
      toolCallId: 'tc-write-retry',
      toolName: 'write_file',
      argumentsText: retry,
      resultText: JSON.stringify({
        status: 'written',
        path: 'artifacts/out.txt',
        sha256: contentDigest.slice(7),
      }),
      transportState: 'returned',
    });

    expect(await digestToolEffectRequest(retry)).toBe(await digestToolEffectRequest(first));
    expect(receipt.requestDigest).toBe(await digestToolEffectRequest(first));
  });
});
