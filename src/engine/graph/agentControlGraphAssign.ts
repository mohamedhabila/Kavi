import { assign } from 'xstate';
import { buildTerminalAssignment } from './agentControlGraphInternals';
import type {
  AgentControlGraphEvent,
  AgentControlGraphMachineContext,
  TerminalAgentControlGraphEvent,
} from './agentControlGraphTypes';

export type AgentControlGraphAssignArgs = {
  context: AgentControlGraphMachineContext;
  event: AgentControlGraphEvent;
};

type GraphAssignment = Parameters<
  typeof assign<
    AgentControlGraphMachineContext,
    AgentControlGraphEvent,
    undefined,
    AgentControlGraphEvent,
    never
  >
>[0];

export const assignAgentControlGraph = (assignment: GraphAssignment) =>
  assign<
    AgentControlGraphMachineContext,
    AgentControlGraphEvent,
    undefined,
    AgentControlGraphEvent,
    never
  >(assignment);

export const recordAgentControlGraphTerminal = (
  eventType: TerminalAgentControlGraphEvent['type'],
) =>
  assignAgentControlGraph(({ context, event }: AgentControlGraphAssignArgs) => {
    if (event.type !== eventType) {
      return {};
    }
    return buildTerminalAssignment(context, event as TerminalAgentControlGraphEvent);
  });
