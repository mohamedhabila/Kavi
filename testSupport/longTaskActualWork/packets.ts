import { readFileSync } from 'fs';
import path from 'path';

export const ACTUAL_WORK_PACKET_COUNT = 20;
const PACKET_MAX_CHARS = 7_000;
const PROJECT_ROOT = path.resolve(__dirname, '../..');

type SourcePacketSpec = {
  title: string;
  question: string;
  sources: string[];
};

const SOURCE_PACKET_SPECS: SourcePacketSpec[] = [
  {
    title: 'Worker registry and lifecycle ownership',
    question: 'Trace process ownership, persistence boundaries, and terminal-state truth.',
    sources: [
      'src/services/agents/subAgent.ts',
      'src/services/agents/lifecycle/runPhase.ts',
    ],
  },
  {
    title: 'Mobile spawn bounds and launch scaffolding',
    question: 'Assess nesting, concurrency, iteration, timeout, and least-privilege controls.',
    sources: [
      'src/services/agents/mobileSpawnPolicy.ts',
      'src/services/agents/subAgentLaunchScaffolding.ts',
    ],
  },
  {
    title: 'Worker spawn and continuation tools',
    question: 'Find race, identity, duplicate-spawn, and continuation failure modes.',
    sources: [
      'src/engine/tools/builtin-session-spawn.ts',
      'src/engine/tools/builtin-session-send.ts',
    ],
  },
  {
    title: 'Worker waiting and result evidence',
    question: 'Check bounded waits, terminal evidence, output retrieval, and misleading status risks.',
    sources: [
      'src/engine/tools/builtin-session-wait.ts',
      'src/engine/tools/builtin-session-resultSupport.ts',
    ],
  },
  {
    title: 'Loop control and recovery',
    question: 'Separate useful repeated work from loops without weakening hard safety ceilings.',
    sources: ['src/engine/loopDetection.ts', 'src/engine/graph/loopRecovery.ts'],
  },
  {
    title: 'Scheduler claim semantics',
    question: 'Audit claim ownership, due evaluation, retry admission, and duplicate execution.',
    sources: ['src/services/scheduler/engine.ts', 'src/services/scheduler/attemptRecovery.ts'],
  },
  {
    title: 'Scheduled job execution lifecycle',
    question: 'Trace execution from claim through settlement and terminal reporting.',
    sources: [
      'src/services/scheduler/jobExecutor.ts',
      'src/services/scheduler/executionLifecycle.ts',
    ],
  },
  {
    title: 'Scheduler persistence and state recovery',
    question: 'Assess crash consistency, exact-generation recovery, and stale state handling.',
    sources: [
      'src/services/scheduler/persistence.ts',
      'src/services/scheduler/statePersistenceRecovery.ts',
    ],
  },
  {
    title: 'Durable recovery orchestration',
    question: 'Map durable ownership and replay protection across recovery entry points.',
    sources: [
      'src/services/executionJournal/durableRecoveryLifecycle.ts',
      'src/services/executionJournal/recoveryCoordinator.ts',
    ],
  },
  {
    title: 'External operation reconciliation',
    question: 'Inspect terminal correlation, ambiguous outcomes, and duplicate-effect defenses.',
    sources: [
      'src/services/executionJournal/externalHandleReconciliation.ts',
      'src/services/executionJournal/externalToolDurabilityLifecycle.ts',
    ],
  },
  {
    title: 'iOS recovery and wake execution',
    question: 'Identify what survives suspension or restart and what remains process-bound.',
    sources: [
      'src/services/executionJournal/iosDurableRecoveryLifecycle.ts',
      'src/services/executionJournal/iosDurableWakeRunner.ts',
    ],
  },
  {
    title: 'Android durable recovery',
    question: 'Review headless scheduling, persisted candidates, and terminal release behavior.',
    sources: [
      'src/services/executionJournal/androidDurableRecoveryLifecycle.ts',
      'src/services/executionJournal/androidDurableRecoveryScheduling.ts',
    ],
  },
  {
    title: 'Startup and foreground model recovery',
    question: 'Trace cold-start ordering, interrupted work, and final response publication.',
    sources: [
      'src/services/startupRecovery.ts',
      'src/services/executionJournal/foregroundModelExecutionRecovery.ts',
    ],
  },
  {
    title: 'Foreground run execution and completion',
    question: 'Find completion races, pending-work gaps, and premature delivery paths.',
    sources: [
      'src/engine/graph/foregroundRun/execution.ts',
      'src/engine/graph/foregroundRun/completionFlow.ts',
    ],
  },
  {
    title: 'Interrupted response and final preview recovery',
    question: 'Assess whether verified work can be recovered without duplicate user-visible replies.',
    sources: [
      'src/engine/graph/foregroundRun/interruptedResponseRecovery.ts',
      'src/engine/graph/foregroundRun/finalPreviewRecovery.ts',
    ],
  },
  {
    title: 'Chat and agent-run persistence',
    question: 'Audit persisted message, tool, graph, and active-run invariants across hydration.',
    sources: ['src/store/chatStorePersistence.ts', 'src/store/chatPersistenceAgentRuns.ts'],
  },
  {
    title: 'Long-term memory retrieval and consistency',
    question: 'Check recall authority, next-turn consistency, and stale-memory failure modes.',
    sources: [
      'src/services/memory/livingMemoryBridge.ts',
      'src/services/memory/nextTurnConsistency.ts',
    ],
  },
  {
    title: 'Semantic memory write authority',
    question: 'Audit evidence grounding, identifier preservation, replacement, and privacy boundaries.',
    sources: [
      'src/services/memory/memoryRememberSemanticEvidence.ts',
      'src/engine/tools/builtin-definitions-memory.ts',
    ],
  },
  {
    title: 'Live foreground evaluation fidelity',
    question: 'Identify where the harness matches production chat and where claims must stay narrow.',
    sources: [
      'src/acceptance/e2eAgent/foregroundScenarioDriver.ts',
      'src/acceptance/e2eAgent/scenarioRunner.ts',
    ],
  },
  {
    title: 'User-visible worker progress',
    question: 'Assess whether long work remains understandable, interruptible, and recoverable in chat.',
    sources: [
      'src/screens/ChatScreen.tsx',
      'src/screens/subAgentLifecyclePresentation.ts',
      'src/services/agents/delegatedWorkQueuePresentation.ts',
    ],
  },
];

export function actualWorkPacketPath(index: number): string {
  return `packets/packet-${String(index + 1).padStart(2, '0')}.md`;
}

function packetId(index: number): string {
  return `PACKET_${String(index + 1).padStart(2, '0')}`;
}

function boundedSourceExcerpt(sourcePath: string, budget: number): string {
  const source = readFileSync(path.join(PROJECT_ROOT, sourcePath), 'utf8');
  if (source.length <= budget) return source;
  const omission = '\n\n... evaluator-bounded middle excerpt omitted ...\n\n';
  const side = Math.max(1, Math.floor((budget - omission.length) / 2));
  return `${source.slice(0, side)}${omission}${source.slice(-side)}`;
}

export function buildActualWorkSourcePackets(): Array<{ path: string; content: string }> {
  if (SOURCE_PACKET_SPECS.length !== ACTUAL_WORK_PACKET_COUNT) {
    throw new Error(`Expected ${ACTUAL_WORK_PACKET_COUNT} source packet specs.`);
  }

  return SOURCE_PACKET_SPECS.map((spec, index) => {
    const id = packetId(index);
    const next =
      index + 1 < ACTUAL_WORK_PACKET_COUNT
        ? actualWorkPacketPath(index + 1)
        : 'none — synthesize final report';
    const checkpoint = [4, 9, 14].includes(index)
      ? `After this packet, write audit/checkpoint-${String(index + 1).padStart(2, '0')}.md.`
      : 'Do not write a checkpoint after this packet.';
    const header = [
      `# ${id}: ${spec.title}`,
      '',
      `Evidence token: ARCH_EVIDENCE_${String(index + 1).padStart(2, '0')}`,
      `Audit question: ${spec.question}`,
      `Sequence: ${index + 1}/${ACTUAL_WORK_PACKET_COUNT}. Next packet: ${next}.`,
      checkpoint,
      'Ground every finding in named functions, types, or control paths from the excerpts.',
      'Distinguish observed code behavior from inference and from missing device evidence.',
      '',
    ].join('\n');
    const sourceBudget = Math.floor(
      (PACKET_MAX_CHARS - header.length - spec.sources.length * 100) / spec.sources.length,
    );
    const sections = spec.sources.map(
      (sourcePath) =>
        `## Source: ${sourcePath}\n\n\`\`\`typescript\n${boundedSourceExcerpt(sourcePath, sourceBudget)}\n\`\`\``,
    );
    const content = `${header}${sections.join('\n\n')}`;
    if (content.length > PACKET_MAX_CHARS) {
      throw new Error(`${id} exceeded the ${PACKET_MAX_CHARS}-character packet limit.`);
    }
    return { path: actualWorkPacketPath(index), content };
  });
}
