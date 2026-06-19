import { readFileSync } from 'node:fs';
import path from 'node:path';

const SUB_AGENT_COMPLETION_SOURCES = [
  'src/services/agents/lifecycle/terminalizePhase.ts',
  'src/services/agents/subAgentFinalization.ts',
  'src/screens/subAgentTerminalReview.ts',
  'src/screens/terminalBackgroundReviewHandler.ts',
  'src/screens/useTerminalBackgroundReviewQueue.ts',
  'src/services/agents/subAgentGoalGraphEffects.ts',
];

describe('sub-agent completion path has no Pilot worker review hooks', () => {
  it('does not reference removed Pilot worker review modules in hot-path sources', () => {
    const forbiddenPatterns = [
      /agentWorkflowPilot/,
      /AgentRunPilotEvaluation/,
      /latestPilotEvaluation/,
      /pilot-v2/,
      /mode:\s*['"]pilot['"]/,
    ];

    for (const relativePath of SUB_AGENT_COMPLETION_SOURCES) {
      const source = readFileSync(path.join(process.cwd(), relativePath), 'utf8');
      for (const pattern of forbiddenPatterns) {
        expect(source).not.toMatch(pattern);
      }
    }
  });
});
