import type { Message } from '../../types/message';
import type {
  AgentControlGraphOpenWorkCloseoutDecision,
  AgentControlGraphOpenWorkPhasePresentation,
} from './asyncOpenWork';
import { buildAgentControlGraphOpenWorkPhasePresentation } from './asyncOpenWork';

type AssistantCloseoutCandidate =
  | Pick<Message, 'role' | 'content' | 'subAgentEvent' | 'toolCalls' | 'assistantMetadata'>
  | undefined;

type GraphCloseoutLogEntry = {
  kind: 'state';
  level: 'warning';
  title: string;
  detail: string;
};

export type AgentControlGraphOpenWorkCloseoutEffect =
  | { type: 'none' }
  | {
      type: 'async-operations';
      phasePresentation: AgentControlGraphOpenWorkPhasePresentation;
      logEntry: GraphCloseoutLogEntry;
    };

export function buildAgentControlGraphOpenWorkCloseoutEffect(params: {
  currentAssistantMessage?: AssistantCloseoutCandidate;
  decision: AgentControlGraphOpenWorkCloseoutDecision;
  turnSummary: string;
}): AgentControlGraphOpenWorkCloseoutEffect {
  if (params.decision.type === 'none') {
    return { type: 'none' };
  }

  const phasePresentation = buildAgentControlGraphOpenWorkPhasePresentation(params.decision);
  if (!phasePresentation) {
    return { type: 'none' };
  }

  return {
    type: 'async-operations',
    phasePresentation,
    logEntry: {
      kind: 'state',
      level: params.decision.logLevel,
      title: params.decision.logTitle,
      detail: `${params.turnSummary} · ${phasePresentation.checkpointDetail}`,
    },
  };
}
