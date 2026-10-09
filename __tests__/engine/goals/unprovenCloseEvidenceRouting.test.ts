import { routeToolEvidenceToActiveGoals } from '../../../src/engine/goals/evidenceRouting';
import { areBlockingGoalsStructurallyComplete } from '../../../src/engine/goals/completionEvidence';
import { addGoalEvidence } from '../../../src/engine/goals/graphState';
import type { AgentGoal } from '../../../src/types/agentRun';

// The result of an unproven close tells the model to produce the missing evidence. That
// evidence used to route only to open goals, so the re-run landed nowhere and the close
// could never become proven — the run spent its remaining steps on work that could not
// count.

function goal(overrides: Partial<AgentGoal> & { id: string }): AgentGoal {
  return {
    title: overrides.id,
    status: 'completed',
    completionPolicy: 'blocking',
    dependencies: [],
    evidence: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as AgentGoal;
}

const READ_FILE = [{ name: 'read_file', contract: { capabilities: ['read'] } }] as never;

describe('evidence for a goal closed without proof', () => {
  it('lands the evidence its own criteria name, and the close becomes proven', () => {
    const verify = goal({ id: 'verify', successCriteria: ['evidence.tool:read_file'] });

    const routed = routeToolEvidenceToActiveGoals({
      toolName: 'read_file',
      toolDefinitions: READ_FILE,
      goals: [verify],
      evidenceStrings: ['read_file:E2E-GATE-FU-42'],
    });

    expect(routed).toEqual([
      expect.objectContaining({ goalId: 'verify', evidence: 'read_file:E2E-GATE-FU-42' }),
    ]);
    const proven = addGoalEvidence([verify], 'verify', routed[0]!.evidence);
    expect(areBlockingGoalsStructurallyComplete(proven)).toBe(true);
  });

  it('does not hand an unproven close evidence its criteria do not name', () => {
    const routed = routeToolEvidenceToActiveGoals({
      toolName: 'read_file',
      toolDefinitions: READ_FILE,
      goals: [goal({ id: 'write', successCriteria: ['evidence.artifact:report.md'] })],
      evidenceStrings: ['read_file:notes'],
    });

    expect(routed).toEqual([]);
  });

  it('leaves a proven close alone', () => {
    const routed = routeToolEvidenceToActiveGoals({
      toolName: 'read_file',
      toolDefinitions: READ_FILE,
      goals: [
        goal({
          id: 'done',
          successCriteria: ['evidence.tool:read_file'],
          evidence: ['read_file:earlier'],
        }),
      ],
      evidenceStrings: ['read_file:later'],
    });

    expect(routed).toEqual([]);
  });
});
