import { ACTUAL_WORK_PACKET_COUNT } from './packets';

export const PRIMARY_MARKER = 'PRIMARY_ARCHITECTURE_AUDIT_COMPLETE_20';
export const VERIFIER_MARKER = 'VERIFIED_ARCHITECTURE_AUDIT_COMPLETE_20';
export const REMEDIATOR_MARKER = 'REMEDIATED_ARCHITECTURE_AUDIT_COMPLETE_20';
export const PRIMARY_REPORT_PATH = 'audit/primary-report.md';
export const VERIFIED_REPORT_PATH = 'audit/verified-report.md';
export const EXECUTION_PLAN_PATH = 'audit/execution-plan.md';
export const CHECKPOINT_PATHS = [
  'audit/checkpoint-05.md',
  'audit/checkpoint-10.md',
  'audit/checkpoint-15.md',
] as const;

export function buildActualWorkPrimaryPrompt(packetPaths: ReadonlyArray<string>): string {
  return [
    'Your first and only tool call in this turn must be sessions_spawn. Do not read or write any file yourself.',
    'Call it with name="architecture-audit-primary", tools=["read_file","write_file"], and waitForCompletion=false, then reply as soon as the worker is running.',
    'Do not omit name, tools, or waitForCompletion from the sessions_spawn arguments.',
    `Its bounded task is to audit exactly these ${ACTUAL_WORK_PACKET_COUNT} packets in order: ${packetPaths.join(', ')}.`,
    'It must call read_file exactly once per packet, one packet per tool iteration, never batch or parallelize reads, and never reread a packet.',
    'For each packet, reason about the stated audit question, retain grounded code evidence, distinguish observation from inference, and carry unresolved cross-file questions forward.',
    'Immediately after packets 05, 10, and 15, write the corresponding checkpoint path shown in the packet. Each checkpoint must be 1,000–2,500 characters, cover only those five new packets without repeating a prior checkpoint body, and include their five evidence tokens, named code symbols, risks, counterevidence, and open questions. Treat 2,500 characters as a hard maximum.',
    `After packet 20, write exactly one final report at ${PRIMARY_REPORT_PATH}. It must be 5,000–8,000 characters, include all 20 ARCH_EVIDENCE tokens, start with PACKETS_REVIEWED: 20, include DECISION: GO, CONDITIONAL_GO, or HOLD, and contain sections for proven invariants, critical findings, product risks, missing evidence, and prioritized remediations. Treat 8,000 characters as a hard maximum.`,
    `After that verified write, return exactly ${PRIMARY_MARKER} plus the decision. Do not use wait as work and do not finish from packet headers alone.`,
    'Use deep reasoning, but keep every conclusion grounded in the supplied source excerpts.',
  ].join(' ');
}

export function buildActualWorkContinuationPrompt(packetPaths: ReadonlyArray<string>): string {
  return [
    'Resume from the persisted chat and do not restart or duplicate the primary worker.',
    `Wait for the existing architecture-audit-primary session and inspect its terminal status and output. Treat it as complete when status is completed and the output contains ${PRIMARY_MARKER}, or explicitly states that all 20 packets were reviewed, names ${PRIMARY_REPORT_PATH}, and gives a GO, CONDITIONAL_GO, or HOLD decision.`,
    `If the primary is incomplete or failed, use sessions_send exactly once on that same session with waitForCompletion=true and waitTimeoutMs=720000. Tell it to inspect ${CHECKPOINT_PATHS.join(', ')}, continue only the missing packet range, create any missing checkpoint and ${PRIMARY_REPORT_PATH}, and return grounded completion evidence. Never use sessions_spawn to replace the primary.`,
    'After that single continuation, proceed only if its terminal output satisfies the same primary completion rule. Otherwise report the blocker and stop without downstream workers.',
    'Then call sessions_spawn with name="architecture-audit-verifier", tools=["read_file","write_file"], and waitForCompletion=true. Do not omit any of those arguments.',
    `The verifier must read exactly these 10 files once each, sequentially: ${CHECKPOINT_PATHS.join(', ')}, ${PRIMARY_REPORT_PATH}, ${packetPaths.slice(0, 6).join(', ')}.`,
    'It must adversarially cross-check the primary report against the six sampled packets, identify unsupported claims, confirm or overturn severity and decision, and verify that every ARCH_EVIDENCE token is represented in the primary evidence chain.',
    `It must write exactly one report at ${VERIFIED_REPORT_PATH}, 5,000–8,000 characters, beginning PACKETS_VERIFIED: 20, containing all 20 ARCH_EVIDENCE tokens, a VERIFIED_DECISION line, confirmed findings, rejected findings, residual risks, device-only gaps, and an execution-ready remediation order. Treat 8,000 characters as a hard maximum.`,
    `After writing it, the verifier must return exactly ${VERIFIER_MARKER} plus the verified decision. It may not call wait.`,
    `When it completes, accept ${VERIFIER_MARKER} or an explicit statement that all 20 packet claims were verified with a verified decision. If neither completion form is present, stop without spawning. Then call sessions_spawn with name="architecture-audit-remediator", tools=["read_file","write_file"], and waitForCompletion=true. Do not omit any of those arguments.`,
    `The remediator must read exactly these five files once each, sequentially: ${VERIFIED_REPORT_PATH}, ${PRIMARY_REPORT_PATH}, ${CHECKPOINT_PATHS.join(', ')}.`,
    'It must turn the verified findings into an implementation sequence, reconcile contradictions between the two reports, map every action to named code symbols and tests, and preserve uncertainty where device evidence is still missing.',
    `It must write exactly one plan at ${EXECUTION_PLAN_PATH}, 5,000–8,000 characters, beginning REMEDIATION_PLAN: 20, containing all 20 ARCH_EVIDENCE tokens, an EXECUTION_ORDER section, acceptance criteria, rollback triggers, test coverage, device-only validation, and deferred non-goals. Treat 8,000 characters as a hard maximum.`,
    `After writing it, the remediator must return exactly ${REMEDIATOR_MARKER} plus the final decision. It may not call wait.`,
    `When the remediator is terminal completed, accept ${REMEDIATOR_MARKER} or an explicit statement that the remediation plan was completed with a final decision. Report that the plan is ready without reading or writing any workspace file yourself.`,
  ].join(' ');
}

export function buildActualWorkFinalReviewPrompt(): string {
  return [
    `Read ${EXECUTION_PLAN_PATH} exactly once.`,
    'Report its final decision, the first three execution actions, and any device-only blocker.',
    'Do not call any other tool and do not write or modify a file.',
  ].join(' ');
}
