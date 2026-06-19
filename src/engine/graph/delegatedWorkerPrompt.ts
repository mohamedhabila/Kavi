import { readMeaningfulExpectedOutput } from '../expectedOutputSemantics';

function trimText(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeTextList(values: ReadonlyArray<string> | undefined): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => trimText(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function buildListSection(title: string, values: string[]): string | undefined {
  if (values.length === 0) {
    return undefined;
  }
  return `${title}:\n${values.map((value) => `- ${value}`).join('\n')}`;
}

export function buildGraphDelegatedWorkerPrompt(params: {
  id: string;
  title: string;
  goal?: string;
  handoff?: string;
  requirements?: string[];
  successCriteria?: string[];
  dependencies?: string[];
  expectedOutput?: string;
  availableWorkerTools?: string[];
}): string {
  const expectedOutput = readMeaningfulExpectedOutput(params.expectedOutput);
  const handoff = expectedOutput ? undefined : trimText(params.handoff);
  const requirements = normalizeTextList(params.requirements);
  const hasExplicitWorkerToolAvailability = Array.isArray(params.availableWorkerTools);
  const availableWorkerTools = hasExplicitWorkerToolAvailability
    ? normalizeTextList(params.availableWorkerTools)
    : undefined;
  const sections = [
    'You are the worker assigned to one graph-owned task.',
    `Assigned task: ${params.id}`,
    `Task: ${params.goal ?? params.title}`,
    expectedOutput ? `Expected output: ${expectedOutput}` : undefined,
    handoff ? `Supervisor handoff:\n${handoff}` : undefined,
    params.goal && params.goal !== params.title ? `Title: ${params.title}` : undefined,
    buildListSection('Semantic task requirements', requirements),
    buildListSection('Success criteria', normalizeTextList(params.successCriteria)),
    buildListSection('Satisfied dependencies', normalizeTextList(params.dependencies)),
    hasExplicitWorkerToolAvailability
      ? availableWorkerTools && availableWorkerTools.length > 0
        ? 'A constrained worker tool subset is available in this session. Use the available tools when they are needed to inspect resources, verify results, or perform required changes.'
        : 'Worker tools available: none. Answer directly when the prompt has enough information; otherwise report the blocker.'
      : requirements.length > 0
        ? 'Worker tool scope is not pre-pinned. Use available tools only when needed to satisfy the semantic task requirements above.'
        : 'Worker tools available: none. Answer directly when the prompt has enough information; otherwise report the blocker.',
    [
      'Boundaries:',
      '- Complete only this assigned task.',
      '- The graph-assigned task above is authoritative; use the supervisor handoff only when consistent with it.',
      '- Do not perform sibling tasks, parent orchestration, monitoring, or final-review work.',
      '- Do not claim you spawned, registered, monitored, or reviewed a worker; the parent runtime already launched you.',
      '- Return the assigned deliverable, not a narrative about the graph or orchestration.',
      '- If Expected output is present, return exactly that output and nothing else.',
      '- Treat wording about launching, spawning, delegating, or starting a worker as parent-side orchestration that is already done.',
      '- If the assigned task can be satisfied from this prompt, answer directly without tools.',
      '- If required information or capabilities are unavailable, report the blocker instead of inventing work.',
    ].join('\n'),
  ];

  return sections.filter((section): section is string => Boolean(section)).join('\n\n');
}
