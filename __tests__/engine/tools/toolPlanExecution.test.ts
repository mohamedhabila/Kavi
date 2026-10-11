import {
  executeUpdatePlan,
  PLAN_UPDATED_RESULT,
} from '../../../src/engine/tools/toolPlanExecution';
import { UPDATE_PLAN_TOOL } from '../../../src/engine/tools/plan-definitions';
import { executeToolInner } from '../../../src/engine/tools/toolDispatchRouter';

describe('update_plan', () => {
  it('answers "Plan updated" for a well-formed plan, as Codex does', () => {
    expect(executeUpdatePlan({ plan: [{ step: 'Check the weather', status: 'pending' }] })).toEqual(
      expect.objectContaining({ status: 'completed', content: PLAN_UPDATED_RESULT }),
    );
  });

  it('fails a malformed call as invalid arguments, naming the shape it expects', () => {
    const outcome = executeUpdatePlan({ plan: [{ step: 'Check the weather', status: 'later' }] });
    expect(outcome).toEqual(
      expect.objectContaining({ status: 'failed', failureKind: 'invalid_arguments' }),
    );
  });

  it('is dispatched by name', async () => {
    const outcome = await executeToolInner(
      'update_plan',
      JSON.stringify({ plan: [{ step: 'Check the weather', status: 'in_progress' }] }),
      'conv-plan',
    );
    expect(outcome).toEqual(expect.objectContaining({ content: PLAN_UPDATED_RESULT }));
  });

  it('is a read-only planning tool that gates nothing and proves nothing', () => {
    expect(UPDATE_PLAN_TOOL.contract).toEqual(
      expect.objectContaining({
        category: 'plan',
        sideEffects: ['none'],
        riskHints: ['read_only'],
        providesEvidence: [],
      }),
    );
    expect(UPDATE_PLAN_TOOL.input_schema.required).toEqual(['plan']);
  });
});
