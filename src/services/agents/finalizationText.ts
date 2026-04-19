export const FINALIZATION_OUTPUT_TRUNCATION = 8_000;
export const FINALIZATION_RESULT_PREVIEW_CHARS = 320;
const FINALIZATION_STRUCTURED_TEXT_CHARS = 160;

export function normalizeFinalizationOutputText(
  value: string | undefined,
  maxLength?: number,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return undefined;
  }

  if (typeof maxLength === 'number' && normalized.length > maxLength) {
    return normalized.slice(0, maxLength).trimEnd();
  }

  return normalized;
}

export function truncateFinalizationText(
  value: string | undefined,
  maxLength: number,
): string | undefined {
  const normalized = normalizeFinalizationOutputText(value);
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

export function normalizeFinalizationPreviewText(
  value: string | undefined,
  maxLength = FINALIZATION_RESULT_PREVIEW_CHARS,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

export function summarizeFinalizationScalarValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return normalizeFinalizationPreviewText(value, 120);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return undefined;
}

function summarizeFinalizationCount(
  value: unknown,
  singular: string,
  plural = `${singular}s`,
): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  const normalized = Math.floor(value);
  return `${normalized} ${normalized === 1 ? singular : plural}`;
}

function summarizeFinalizationStructuredText(value: unknown, label?: string): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = normalizeFinalizationOutputText(value);
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= FINALIZATION_STRUCTURED_TEXT_CHARS) {
    const preview = normalizeFinalizationPreviewText(
      normalized,
      FINALIZATION_STRUCTURED_TEXT_CHARS,
    );
    return label ? `${label}: ${preview}` : preview;
  }

  return label ? `${label} (${normalized.length} chars)` : `${normalized.length} chars`;
}

function summarizeStructuredFinalizationToolResult(
  parsed: Record<string, unknown>,
): string | undefined {
  const segments: string[] = [];
  const status = summarizeFinalizationScalarValue(parsed.status);
  const normalizedStatus = typeof status === 'string' ? status.toLowerCase() : undefined;

  const recorded = summarizeFinalizationCount(
    parsed.recorded,
    'evidence entry',
    'evidence entries',
  );
  if (recorded) {
    segments.push(`${recorded} recorded`);
  }

  const returnedEntries = summarizeFinalizationCount(
    parsed.returnedEntries,
    'evidence entry',
    'evidence entries',
  );
  if (returnedEntries) {
    segments.push(`${returnedEntries} returned`);
  }

  const totalEntries = summarizeFinalizationCount(
    parsed.totalEntries,
    'evidence entry',
    'evidence entries',
  );
  if (totalEntries && !recorded && !returnedEntries) {
    segments.push(`${totalEntries} total`);
  }

  const sessionCount =
    typeof parsed.sessionCount === 'number' && Number.isFinite(parsed.sessionCount)
      ? Math.max(0, Math.floor(parsed.sessionCount))
      : undefined;
  const completedCount =
    typeof parsed.completedCount === 'number' && Number.isFinite(parsed.completedCount)
      ? Math.max(0, Math.floor(parsed.completedCount))
      : undefined;
  const pendingCount =
    typeof parsed.pendingCount === 'number' && Number.isFinite(parsed.pendingCount)
      ? Math.max(0, Math.floor(parsed.pendingCount))
      : undefined;
  if (sessionCount != null) {
    if (completedCount != null) {
      segments.push(`${completedCount}/${sessionCount} sessions completed`);
    } else {
      const sessionLabel = summarizeFinalizationCount(sessionCount, 'session');
      if (sessionLabel) {
        segments.push(sessionLabel);
      }
    }

    if ((pendingCount ?? 0) > 0) {
      segments.push(`${pendingCount} still running`);
    }
  }

  const artifactCount = summarizeFinalizationCount(parsed.artifactCount, 'artifact');
  if (artifactCount) {
    segments.push(artifactCount);
  }

  const activity = summarizeFinalizationStructuredText(parsed.currentActivity, 'activity');
  if (activity) {
    segments.push(activity);
  }

  const preview = summarizeFinalizationStructuredText(
    parsed.outputPreview ??
      parsed.outputExcerpt ??
      parsed.contentExcerpt ??
      parsed.lastToolResultPreview,
    'preview',
  );
  if (preview) {
    segments.push(preview);
  }

  const rawOutput =
    typeof parsed.output === 'string'
      ? parsed.output
      : typeof parsed.content === 'string'
        ? parsed.content
        : undefined;
  const rawOutputChars =
    typeof parsed.outputChars === 'number' &&
    Number.isFinite(parsed.outputChars) &&
    parsed.outputChars > 0
      ? Math.floor(parsed.outputChars)
      : normalizeFinalizationOutputText(rawOutput)?.length;
  const hasOutput = parsed.hasOutput === true || typeof rawOutput === 'string';
  if (hasOutput) {
    if (parsed.outputTruncated === true) {
      segments.push(
        rawOutputChars != null
          ? `output captured (${rawOutputChars} chars; preview only)`
          : 'output captured (preview only)',
      );
    } else if (preview && rawOutputChars != null) {
      segments.push(`output captured (${rawOutputChars} chars)`);
    } else if (!preview) {
      const outputSummary = summarizeFinalizationStructuredText(rawOutput);
      if (outputSummary) {
        if (
          segments.length === 0 &&
          (!status || normalizedStatus === 'ok' || normalizedStatus === 'completed')
        ) {
          return outputSummary;
        }
        segments.push(`output: ${outputSummary}`);
      } else {
        segments.push('output captured');
      }
    }
  }

  if (segments.length === 0) {
    if (status) {
      return status;
    }
    return 'Structured result captured.';
  }

  if (status && normalizedStatus && normalizedStatus !== 'ok' && normalizedStatus !== 'completed') {
    segments.unshift(status);
  }

  return segments.join('; ');
}

export function summarizeFinalizationToolResultPreview(result?: string): string | undefined {
  if (!result) {
    return undefined;
  }

  const normalizedRaw = normalizeFinalizationPreviewText(result, FINALIZATION_RESULT_PREVIEW_CHARS);
  if (!normalizedRaw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return normalizedRaw;
    }

    const candidateKeys = ['summary', 'message', 'detail', 'error', 'currentActivity'];

    for (const key of candidateKeys) {
      const summary = summarizeFinalizationScalarValue(parsed[key]);
      if (summary) {
        return normalizeFinalizationPreviewText(summary, FINALIZATION_RESULT_PREVIEW_CHARS);
      }
    }

    return normalizeFinalizationPreviewText(
      summarizeStructuredFinalizationToolResult(parsed),
      FINALIZATION_RESULT_PREVIEW_CHARS,
    );
  } catch {
    return normalizedRaw;
  }

  return normalizedRaw;
}
