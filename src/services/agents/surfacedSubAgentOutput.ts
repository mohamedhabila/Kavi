export const SURFACED_SUB_AGENT_OUTPUT_GUIDANCE =
  'This output is intended to be surfaced directly to the user by the runtime. Do not restate the same content in assistant text unless you are adding materially new information.';

const MAX_SURFACED_OUTPUT_CHARS = 200_000;

export interface SessionSurfaceOutputOptions {
  prefix?: string;
  suffix?: string;
  startMarker?: string;
  endMarker?: string;
  includeStartMarker?: boolean;
  includeEndMarker?: boolean;
  maxChars?: number;
  fallbackToFullOutput?: boolean;
  trim?: boolean;
}

export interface SurfacedSubAgentOutputPayload {
  status: 'surfaced';
  sessionId: string;
  output: string;
  outputLength: number;
  sourceOutputLength: number;
  selectionApplied: boolean;
  usedFullOutput: boolean;
  guidance: string;
  truncated?: boolean;
  startMarker?: string;
  endMarker?: string;
  selectionFallbackReason?: string;
}

interface SurfaceSelectionResult {
  selectedOutput: string;
  selectionApplied: boolean;
  usedFullOutput: boolean;
  selectionFallbackReason?: string;
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return value.trim().length > 0 ? value : undefined;
}

function normalizeLiteralString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return value.length > 0 ? value : undefined;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeMaxChars(value: unknown): number | undefined {
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return undefined;
  }

  return Math.min(MAX_SURFACED_OUTPUT_CHARS, Math.floor(numericValue));
}

function selectSurfacedOutputSlice(
  sourceOutput: string,
  options: Required<
    Pick<
      SessionSurfaceOutputOptions,
      'includeStartMarker' | 'includeEndMarker' | 'fallbackToFullOutput' | 'trim'
    >
  > &
    Pick<SessionSurfaceOutputOptions, 'startMarker' | 'endMarker'>,
): { result?: SurfaceSelectionResult; error?: string } {
  const { startMarker, endMarker, includeStartMarker, includeEndMarker, fallbackToFullOutput, trim } =
    options;

  if (!startMarker && !endMarker) {
    const selectedOutput = trim ? sourceOutput.trim() : sourceOutput;
    return {
      result: {
        selectedOutput,
        selectionApplied: false,
        usedFullOutput: true,
      },
    };
  }

  let startIndex = 0;
  let endIndex = sourceOutput.length;
  let selectionApplied = false;
  let searchStartIndex = 0;

  if (startMarker) {
    const matchedStartIndex = sourceOutput.indexOf(startMarker);
    if (matchedStartIndex < 0) {
      if (fallbackToFullOutput) {
        return {
          result: {
            selectedOutput: trim ? sourceOutput.trim() : sourceOutput,
            selectionApplied: false,
            usedFullOutput: true,
            selectionFallbackReason: `Start marker not found: ${startMarker}`,
          },
        };
      }

      return {
        error: `Unable to surface worker output because startMarker was not found: ${startMarker}`,
      };
    }

    selectionApplied = true;
    searchStartIndex = matchedStartIndex + startMarker.length;
    startIndex = includeStartMarker ? matchedStartIndex : searchStartIndex;
  }

  if (endMarker) {
    const matchedEndIndex = sourceOutput.indexOf(endMarker, searchStartIndex);
    if (matchedEndIndex < 0) {
      if (fallbackToFullOutput) {
        return {
          result: {
            selectedOutput: trim ? sourceOutput.trim() : sourceOutput,
            selectionApplied: false,
            usedFullOutput: true,
            selectionFallbackReason: `End marker not found: ${endMarker}`,
          },
        };
      }

      return {
        error: `Unable to surface worker output because endMarker was not found: ${endMarker}`,
      };
    }

    selectionApplied = true;
    endIndex = includeEndMarker ? matchedEndIndex + endMarker.length : matchedEndIndex;
  }

  if (endIndex < startIndex) {
    if (fallbackToFullOutput) {
      return {
        result: {
          selectedOutput: trim ? sourceOutput.trim() : sourceOutput,
          selectionApplied: false,
          usedFullOutput: true,
          selectionFallbackReason: 'Selected output bounds were invalid; using the full worker output instead.',
        },
      };
    }

    return {
      error:
        'Unable to surface worker output because the requested startMarker/endMarker bounds produced an invalid range.',
    };
  }

  const slicedOutput = sourceOutput.slice(startIndex, endIndex);
  const selectedOutput = trim ? slicedOutput.trim() : slicedOutput;

  if (selectedOutput.length > 0) {
    return {
      result: {
        selectedOutput,
        selectionApplied,
        usedFullOutput: false,
      },
    };
  }

  if (fallbackToFullOutput) {
    return {
      result: {
        selectedOutput: trim ? sourceOutput.trim() : sourceOutput,
        selectionApplied: false,
        usedFullOutput: true,
        selectionFallbackReason:
          'Selected output range was empty after applying the requested boundaries.',
      },
    };
  }

  return {
    error:
      'Unable to surface worker output because the selected range was empty after applying the requested boundaries.',
  };
}

export function createSurfacedSubAgentOutputPayload(params: {
  sessionId: string;
  sourceOutput: string;
  options?: SessionSurfaceOutputOptions;
}): { payload?: SurfacedSubAgentOutputPayload; error?: string } {
  const sessionId = normalizeNonEmptyString(params.sessionId);
  if (!sessionId) {
    return { error: 'sessionId is required to surface worker output.' };
  }

  const sourceOutput = typeof params.sourceOutput === 'string' ? params.sourceOutput : '';
  if (!sourceOutput.trim()) {
    return { error: 'The worker has no terminal output to surface.' };
  }

  const options = params.options ?? {};
  const startMarker = normalizeNonEmptyString(options.startMarker);
  const endMarker = normalizeNonEmptyString(options.endMarker);
  const prefix = normalizeLiteralString(options.prefix) ?? '';
  const suffix = normalizeLiteralString(options.suffix) ?? '';
  const includeStartMarker = normalizeBoolean(options.includeStartMarker, false);
  const includeEndMarker = normalizeBoolean(options.includeEndMarker, false);
  const fallbackToFullOutput = normalizeBoolean(options.fallbackToFullOutput, true);
  const trim = normalizeBoolean(options.trim, true);
  const maxChars = normalizeMaxChars(options.maxChars);

  const selection = selectSurfacedOutputSlice(sourceOutput, {
    startMarker,
    endMarker,
    includeStartMarker,
    includeEndMarker,
    fallbackToFullOutput,
    trim,
  });
  if (selection.error || !selection.result) {
    return { error: selection.error || 'Unable to surface the requested worker output.' };
  }

  let selectedOutput = selection.result.selectedOutput;
  let truncated = false;
  if (maxChars && selectedOutput.length > maxChars) {
    selectedOutput = selectedOutput.slice(0, maxChars).trimEnd();
    truncated = true;
  }

  const output = `${prefix}${selectedOutput}${suffix}`;
  if (!output.trim()) {
    return { error: 'The surfaced worker output is empty after applying the requested boundaries.' };
  }

  return {
    payload: {
      status: 'surfaced',
      sessionId,
      output,
      outputLength: output.length,
      sourceOutputLength: sourceOutput.length,
      selectionApplied: selection.result.selectionApplied,
      usedFullOutput: selection.result.usedFullOutput,
      guidance: SURFACED_SUB_AGENT_OUTPUT_GUIDANCE,
      ...(truncated ? { truncated: true } : {}),
      ...(startMarker ? { startMarker } : {}),
      ...(endMarker ? { endMarker } : {}),
      ...(selection.result.selectionFallbackReason
        ? { selectionFallbackReason: selection.result.selectionFallbackReason }
        : {}),
    },
  };
}

export function parseSurfacedSubAgentOutputResult(
  result?: string,
): SurfacedSubAgentOutputPayload | undefined {
  if (!result) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(result);
    if (
      parsed?.status !== 'surfaced' ||
      typeof parsed?.sessionId !== 'string' ||
      typeof parsed?.output !== 'string' ||
      parsed.output.trim().length === 0
    ) {
      return undefined;
    }

    return parsed as SurfacedSubAgentOutputPayload;
  } catch {
    return undefined;
  }
}

export function buildSurfacedSubAgentOutputToolResultSummary(
  payload: SurfacedSubAgentOutputPayload,
): string {
  const subject = payload.usedFullOutput ? 'Full worker output' : 'A bounded worker output slice';
  const notes: string[] = [];

  if (payload.selectionFallbackReason) {
    notes.push(`fallback used: ${payload.selectionFallbackReason}`);
  }

  if (payload.truncated) {
    notes.push('truncated before delivery');
  }

  return `${subject} from ${payload.sessionId} was surfaced to the user in the assistant response.${notes.length ? ` ${notes.join('; ')}.` : ''}`;
}