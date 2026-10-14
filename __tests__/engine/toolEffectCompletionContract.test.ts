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
    'read_file',
    'sessions_spawn',
    'cron',
    'mcp__docs__fetch',
    'phone_call',
    'share_text',
    'canvas_create',
    'write_file',
    'memory_remember',
  ])('lets %s run', (toolName) => {
    expect(resolveUnsupportedEffectContract({ toolName })).toBeNull();
  });

  it('refuses a declared effect the code-owned contracts cannot describe', () => {
    jest.spyOn(receiptContracts, 'getCodeOwnedToolEffectContract').mockReturnValue(undefined);

    expect(resolveUnsupportedEffectContract({ toolName: 'write_file' })).toEqual({
      toolName: 'write_file',
      code: 'effect_contract_unavailable',
    });
  });

  it('tells the model not to run or claim the refused effect', () => {
    const block = JSON.parse(
      buildUnsupportedEffectContractBlock({
        toolName: 'write_file',
        code: 'effect_contract_unavailable',
      }),
    );

    expect(block).toEqual({
      status: 'error',
      code: 'effect_contract_unavailable',
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
