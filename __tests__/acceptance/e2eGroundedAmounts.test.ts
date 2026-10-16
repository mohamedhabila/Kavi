import { amountValue, ungroundedAmounts } from '../../src/acceptance/e2eAgent/e2eGroundedAmounts';
import { evaluateE2ERubric } from '../../src/acceptance/e2eAgent/rubricEvaluators';
import type { E2EScenarioResult } from '../../src/acceptance/e2eAgent/types';

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

type TurnTrace = E2EScenarioResult['turnTraces'][number];

const PAGE =
  'Basic Droplets start at $4/mo (512 MiB) and $6/mo for 1 GiB. Hetzner CX23 costs €5,49. OVH VPS-1 is US$4.54.';

function result(answer: string, toolResults: TurnTrace['toolResults']): E2EScenarioResult {
  const turn = {
    turnIndex: 0,
    user: { messageId: 'u', text: 'Which server?', timestamp: 1 },
    finalAssistant: {
      messageId: 'a',
      text: answer,
      timestamp: 2,
      completionStatus: 'complete',
      finishReason: 'stop',
      terminalReason: null,
    },
    finalAssistantCandidateCount: 1,
    toolCalls: [{ id: 'call-1', name: 'setup_guide', arguments: '{"topic":"server"}' }],
    toolResults,
  } as unknown as TurnTrace;
  return { fixtureId: 'grounded', turnTraces: [turn] } as unknown as E2EScenarioResult;
}

const RUBRIC = { kind: 'turn_grounded_amounts', turnIndex: 0, toolName: 'setup_guide' } as const;
const GUIDE_RESULT = { toolCallId: 'call-1', name: 'setup_guide', content: PAGE, isError: false };

describe('grounded amounts', () => {
  it('reads amounts as values in the ways languages write them', () => {
    expect(amountValue('4.50')).toBe(4.5);
    expect(amountValue('4,50')).toBe(4.5);
    expect(amountValue('5,49')).toBe(5.49);
    expect(amountValue('1,000')).toBe(1000);
    expect(amountValue('1.000')).toBe(1000);
    expect(amountValue('1 000')).toBe(1000);
    expect(amountValue('12')).toBe(12);
  });

  it('accepts amounts the tools returned, however the answer writes them', () => {
    expect(
      ungroundedAmounts(
        'DigitalOcean is $6 a month (or $4), Hetzner 5,49 € and OVH US$ 4.54; 2 GB costs nothing extra.',
        [PAGE],
      ),
    ).toEqual([]);
    expect(ungroundedAmounts('Cuesta 6 USD al mes.', [PAGE])).toEqual([]);
  });

  it('accepts an estimate built from a price the answer quotes, not a rounded price', () => {
    const bland = 'Start: $0/month and $0.14 per minute. Build: $299/month.';

    expect(
      ungroundedAmounts('Cuesta 0,14 $ el minuto: una reserva de 2 o 3 minutos, 0,28 $ o 0,42 $.', [
        bland,
      ]),
    ).toEqual([]);
    expect(
      ungroundedAmounts('0,14 $ por minuto: 10 reservas de 2 minutos, unos 3 $.', [bland]),
    ).toEqual([]);
    expect(
      ungroundedAmounts('0,14 $ por minuto: entre 0,15 $ y 0,30 $ por reserva.', [bland]),
    ).toEqual(['0,15 $', '0,30 $']);
    expect(ungroundedAmounts('A booking costs about $0.42.', [bland])).toEqual(['$0.42']);
    expect(ungroundedAmounts('$0.14 a minute; Linode is $5.', [bland])).toEqual(['$5']);
  });

  it('accepts a price rounded to the digits written, and totals built from quoted prices', () => {
    const pages = 'Droplets: $6/mo for 1 GiB. Domains: .COM from $11.08.';

    expect(
      ungroundedAmounts(
        'The Droplet is $6 a month and a .com about $11 a year: about $7 a month, or about $83 a year.',
        [pages],
      ),
    ).toEqual([]);
    expect(ungroundedAmounts('Budget about $5–6 a month.', [pages])).toEqual(['$5']);
    expect(ungroundedAmounts('Apple charges $99 a year; the Droplet is $6.', [pages])).toEqual([
      '$99',
    ]);
  });

  it('takes a free plan stated as $0 at its word', () => {
    expect(
      ungroundedAmounts('Oracle Cloud Always Free costs $0.', ['Always Free resources']),
    ).toEqual([]);
  });

  it('counts only what a page states as money, not any number on it', () => {
    expect(
      ungroundedAmounts('The Play Console fee is $25.', ['25 GB of storage, 2025 terms']),
    ).toEqual(['$25']);
  });

  it('names the amounts no tool returned, or returned in another currency', () => {
    expect(ungroundedAmounts('Linode is $9 and Vultr $3.50, DigitalOcean $6.', [PAGE])).toEqual([
      '$9',
      '$3.50',
    ]);
    expect(ungroundedAmounts('Hetzner CX23 is $5.49.', [PAGE])).toEqual(['$5.49']);
  });

  it('passes a turn that called the guide and quoted only what it read', () => {
    expect(
      evaluateE2ERubric(result('Start with the $6/mo Droplet.', [GUIDE_RESULT]), RUBRIC),
    ).toMatchObject({ passed: true });
  });

  it('fails a turn that quoted a price from memory', () => {
    expect(
      evaluateE2ERubric(result('A Hetzner CX22 is €3.79.', [GUIDE_RESULT]), RUBRIC),
    ).toMatchObject({ passed: false, detail: expect.stringContaining('€3.79') });
  });

  it('fails a turn whose guide call failed or never happened', () => {
    expect(
      evaluateE2ERubric(result('It is $6.', [{ ...GUIDE_RESULT, isError: true }]), RUBRIC),
    ).toMatchObject({ passed: false, detail: expect.stringContaining('did not call setup_guide') });
    expect(evaluateE2ERubric(result('It is $6.', []), RUBRIC)).toMatchObject({ passed: false });
  });
});
