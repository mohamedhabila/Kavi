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
});
