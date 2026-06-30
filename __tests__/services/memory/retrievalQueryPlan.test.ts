import { planRetrievalSignals } from '../../../src/services/memory/retrievalQueryPlan';

describe('planRetrievalSignals', () => {
  it('extracts quoted content from user intent lines, not machine-dense action schemas', () => {
    const plan = planRetrievalSignals([
      [
        'Filter the admin page by `qtarget value`.',
        "scroll(delta_x: float, delta_y: float), click(bid: str, button='left')",
      ].join('\n'),
    ]);

    expect(plan.supportingSignals).toContain('qtarget value');
    expect(plan.supportingSignals).not.toContain('left');
    expect(plan.droppedSignals.join('\n')).toContain("button='left'");
  });

  it('keeps natural parenthetical clarifications in the primary retrieval signal', () => {
    const query =
      'Find total possible (qcolor, qstorage) combinations and answer with a short phrase.';

    const plan = planRetrievalSignals([query]);

    expect(plan.primarySignals).toContain(query);
    expect(plan.droppedSignals).toHaveLength(0);
  });

  it('preserves user line boundaries as separate primary retrieval signals', () => {
    const plan = planRetrievalSignals([
      ['Find qprimary-task evidence on the active surface.', 'Return qformat-tail only.'].join('\n'),
    ]);

    expect(plan.primarySignals).toEqual([
      'Find qprimary-task evidence on the active surface.',
      'Return qformat-tail only.',
    ]);
  });
});
