import type { AgentRunTaskOwner, AgentRunWorkstream } from '../../types/agentRun';

const WORKSTREAM_OWNER_VALUES = new Set<AgentRunTaskOwner>(['supervisor', 'worker', 'either']);

function trimText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function sanitizeWorkflowText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeLookupKey(value: string): string {
  return sanitizeWorkflowText(value).toLowerCase().trim();
}

export function normalizeWorkflowDependencyReference(
  value: string | undefined,
): string | undefined {
  const trimmedValue = trimText(value);
  return trimmedValue ? sanitizeWorkflowText(trimmedValue) : undefined;
}

function normalizeTextList(items?: string[]): string[] | undefined {
  const normalized = Array.from(
    new Set(
      (items ?? []).map((item) => trimText(item)).filter((item): item is string => Boolean(item)),
    ),
  );

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeWorkstreamOwner(
  value: AgentRunWorkstream['owner'],
): AgentRunTaskOwner | undefined {
  return value && WORKSTREAM_OWNER_VALUES.has(value) ? value : undefined;
}

function resolveUniqueWorkstreamId(
  candidate: string | undefined,
  index: number,
  usedIds: Set<string>,
): string {
  const baseId = trimText(candidate) || `workstream-${index + 1}`;
  if (!usedIds.has(baseId)) {
    usedIds.add(baseId);
    return baseId;
  }

  let suffix = 2;
  let nextId = `${baseId}-${suffix}`;
  while (usedIds.has(nextId)) {
    suffix += 1;
    nextId = `${baseId}-${suffix}`;
  }

  usedIds.add(nextId);
  return nextId;
}

function buildWorkstreamLookup(
  workstreams: ReadonlyArray<Pick<AgentRunWorkstream, 'id' | 'title'>>,
): Map<string, string> {
  const lookup = new Map<string, string>();

  for (const workstream of workstreams) {
    lookup.set(normalizeLookupKey(workstream.id), workstream.id);
    lookup.set(normalizeLookupKey(workstream.title), workstream.id);
  }

  return lookup;
}

export function resolveWorkflowWorkstreamReference(
  workstreams: ReadonlyArray<Pick<AgentRunWorkstream, 'id' | 'title'>>,
  reference: string | undefined,
): string | undefined {
  const normalizedReferenceText = normalizeWorkflowDependencyReference(reference);
  if (!normalizedReferenceText) {
    return undefined;
  }

  const lookup = buildWorkstreamLookup(workstreams);
  const directMatch = lookup.get(normalizeLookupKey(normalizedReferenceText));
  if (directMatch) {
    return directMatch;
  }

  return undefined;
}

export function normalizeWorkflowWorkstreams(
  workstreams?: AgentRunWorkstream[],
): AgentRunWorkstream[] {
  const usedIds = new Set<string>();

  const normalizedWorkstreams = (workstreams ?? [])
    .map<AgentRunWorkstream | null>((workstream, index) => {
      const title = trimText(sanitizeWorkflowText(workstream.title));
      if (!title) {
        return null;
      }

      const normalizedWorkstream: AgentRunWorkstream = {
        id: resolveUniqueWorkstreamId(workstream.id, index, usedIds),
        title,
      };

      const goal = trimText(workstream.goal);
      const expectedOutput = trimText(workstream.expectedOutput);
      const successCriteria = normalizeTextList(workstream.successCriteria);
      const dependencies = normalizeTextList(workstream.dependencies)
        ?.map((dependency) => normalizeWorkflowDependencyReference(dependency))
        .filter((dependency): dependency is string => Boolean(dependency));
      const owner = normalizeWorkstreamOwner(workstream.owner);
      const requirements = normalizeTextList(workstream.requirements);
      const requiredCapabilities = normalizeTextList(workstream.requiredCapabilities);

      if (goal) {
        normalizedWorkstream.goal = goal;
      }
      if (expectedOutput) {
        normalizedWorkstream.expectedOutput = expectedOutput;
      }
      if (successCriteria) {
        normalizedWorkstream.successCriteria = successCriteria;
      }
      if (dependencies) {
        normalizedWorkstream.dependencies = dependencies;
      }
      if (owner) {
        normalizedWorkstream.owner = owner;
      }
      if (requirements) {
        normalizedWorkstream.requirements = requirements;
      }
      if (requiredCapabilities) {
        normalizedWorkstream.requiredCapabilities = requiredCapabilities;
      }

      return normalizedWorkstream;
    })
    .filter((workstream): workstream is AgentRunWorkstream => workstream !== null);

  return normalizedWorkstreams.map((workstream) => {
    const dependencyIds = Array.from(
      new Set(
        (workstream.dependencies ?? [])
          .map((dependency) => {
            const normalizedDependency = normalizeWorkflowDependencyReference(dependency);
            if (!normalizedDependency) {
              return undefined;
            }

            return (
              resolveWorkflowWorkstreamReference(normalizedWorkstreams, normalizedDependency) ??
              normalizedDependency
            );
          })
          .filter((dependency): dependency is string =>
            Boolean(dependency && dependency !== workstream.id),
          ),
      ),
    );

    return {
      ...workstream,
      dependencies: dependencyIds.length > 0 ? dependencyIds : undefined,
    };
  });
}

export function inferWorkflowWorkstreamId(
  workstreams: ReadonlyArray<AgentRunWorkstream>,
  params: {
    workstreamId?: string;
    name?: string;
    prompt?: string;
  },
): string | undefined {
  return resolveWorkflowWorkstreamReference(workstreams, params.workstreamId);
}
