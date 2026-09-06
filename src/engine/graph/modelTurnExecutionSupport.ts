import { estimateAllToolTokens } from '../tools/toolManagerTokenBudget';
import {
  estimateMessageTokens,
  estimateTokens,
  getObservedTokenCalibrationFactor,
  recordObservedTokenRatio,
} from '../../services/context/tokenCounter';
import type { TokenUsage, UsagePromptCacheTelemetry, UsageTokenBuckets } from '../../types/usage';
import type { ToolDefinition } from '../../types/tool';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ModelTurnTokenCalibration');

/**
 * Guard + record one (pre-flight estimate, provider-reported actual) observation for the
 * per-provider-family online calibration EMA in `tokenCounter.ts`. Called at most once per
 * completed model request, only when the usage backing it was actually reported by the
 * provider (never for the synthesized fallback usage `flush()` builds when a request never
 * reports usage at all).
 *
 * Guards, in order:
 *  - `family` unresolved: no calibration bucket to fold this observation into.
 *  - `estimatedTokens` missing/non-positive: nothing was predicted pre-flight for this request,
 *    so the ratio would be undefined.
 *  - `actualTokens` non-positive: `mergeSnapshot`'s `Math.max(..., usage.inputTokens ?? 0)`
 *    already collapses "the provider didn't report an input token count" to 0, so 0 is treated
 *    as "no count" rather than a genuine zero-token prompt.
 *  - `requestHasImageAttachment`: this request embedded image content. The chars-per-token
 *    estimator only prices the text/JSON scaffold it was given, never image bytes, so an image
 *    request's ratio would blame the text estimator for billing it never tried to predict.
 *    Detected structurally from the request's own `Message.attachments`, not from provider
 *    usage: `StreamUsage` (`services/llm/support/contracts.ts`) intentionally narrows away
 *    `NormalizedUsage.tokenDetails` (see `normalizeStreamUsage` in
 *    `services/llm/core/streaming/metadataBuilder.ts`) before a streamed usage event ever
 *    reaches this tracker, so `tokenDetails.inputImageTokens` isn't available here to check.
 *
 * Cache accounting is deliberately NOT a separate guard. Every streaming provider adapter
 * routes its raw usage payload through `normalizeUsage`
 * (`services/usage/usageNormalization.ts`) before it reaches this tracker, and that function
 * already folds Anthropic-style cache read/write tokens (reported outside `input_tokens`) back
 * into `inputTokens`, while leaving providers whose `prompt_tokens` / `promptTokenCount` is
 * already cache-inclusive untouched (see `hasAnthropicStyleCacheAccounting` there). So
 * `actualTokens` is already a consistent whole-prompt figure by the time it reaches here,
 * cached or not, and needs no extra handling.
 *
 * `appliedFactor` is the calibration factor that was actually in effect when
 * `estimatedTokens` was computed pre-flight (captured via
 * `getObservedTokenCalibrationFactor` in `modelTurnExecutionAttempt.ts`, immediately before
 * `prepareAgentTurnRequestBudget` runs) — required so `recordObservedTokenRatio` can recover
 * the uncalibrated base estimate instead of comparing `actualTokens` against the
 * already-margined, already-calibrated `estimatedTokens` directly. See that function's doc
 * comment in `tokenCounter.ts` for why that distinction is load-bearing.
 */
function recordModelTurnTokenCalibration(observation: {
  family: string | undefined;
  estimatedTokens: number | undefined;
  actualTokens: number;
  appliedFactor: number | undefined;
  requestHasImageAttachment: boolean;
}): void {
  if (!observation.family) return;
  if (
    !Number.isFinite(observation.estimatedTokens) ||
    (observation.estimatedTokens as number) <= 0
  ) {
    return;
  }
  if (!Number.isFinite(observation.actualTokens) || observation.actualTokens <= 0) return;
  if (!Number.isFinite(observation.appliedFactor) || (observation.appliedFactor as number) <= 0) {
    return;
  }
  if (observation.requestHasImageAttachment) return;

  recordObservedTokenRatio(
    observation.family,
    observation.estimatedTokens as number,
    observation.actualTokens,
    observation.appliedFactor as number,
  );
  logger.debug('Recorded token calibration observation', {
    family: observation.family,
    estimatedTokens: observation.estimatedTokens,
    actualTokens: observation.actualTokens,
    appliedFactor: observation.appliedFactor,
    factor: getObservedTokenCalibrationFactor(observation.family),
  });
}

/**
 * Calibration inputs threaded from `modelTurnExecutionAttempt.ts`, through the streaming and
 * send-message request functions, into `createModelTurnUsageTracker`. See
 * `recordModelTurnTokenCalibration`'s doc comment above for what each field guards; omitting
 * `calibrationFamily` skips calibration recording entirely for that request.
 */
interface ModelTurnCalibrationInputs {
  calibrationFamily?: string;
  preflightEstimatedInputTokens?: number;
  /**
   * The calibration factor read via `getObservedTokenCalibrationFactor(calibrationFamily)` at
   * the exact moment `preflightEstimatedInputTokens` was computed. Required for
   * `recordObservedTokenRatio` to recover its uncalibrated base estimate; omitting it (or the
   * request otherwise failing calibration's other guards) skips recording for this request.
   */
  appliedCalibrationFactor?: number;
  requestHasImageAttachment?: boolean;
}

/** Narrows a superset params object down to just the calibration passthrough fields. */
export function pickCalibrationInputs(
  params: ModelTurnCalibrationInputs,
): ModelTurnCalibrationInputs {
  return {
    calibrationFamily: params.calibrationFamily,
    preflightEstimatedInputTokens: params.preflightEstimatedInputTokens,
    appliedCalibrationFactor: params.appliedCalibrationFactor,
    requestHasImageAttachment: params.requestHasImageAttachment,
  };
}

export function createModelTurnUsageTracker(
  params: {
    getContentSnapshot: () => { fullContent: string; reasoning: string };
    reportUsage: (usage: TokenUsage) => void;
    requestModel: string;
    usageTelemetry?: {
      tokenBuckets?: UsageTokenBuckets;
      promptCache?: UsagePromptCacheTelemetry;
    };
  } & ModelTurnCalibrationInputs,
) {
  let latestUsage: TokenUsage | null = null;
  let usageReported = false;
  let usageWasReportedByProvider = false;

  return {
    reset() {
      latestUsage = null;
      usageReported = false;
      usageWasReportedByProvider = false;
    },
    mergeSnapshot(usage: Partial<TokenUsage>) {
      usageWasReportedByProvider = true;
      const inputTokens = Math.max(latestUsage?.inputTokens ?? 0, usage.inputTokens ?? 0);
      const outputTokens = Math.max(latestUsage?.outputTokens ?? 0, usage.outputTokens ?? 0);
      const cacheReadTokens = Math.max(
        latestUsage?.cacheReadTokens ?? 0,
        usage.cacheReadTokens ?? 0,
      );
      const cacheWriteTokens = Math.max(
        latestUsage?.cacheWriteTokens ?? 0,
        usage.cacheWriteTokens ?? 0,
      );
      const totalTokens = Math.max(
        latestUsage?.totalTokens ?? 0,
        usage.totalTokens ?? 0,
        inputTokens + outputTokens,
      );

      latestUsage = {
        model: usage.model || latestUsage?.model || params.requestModel,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens,
        ...((usage.tokenDetails ?? latestUsage?.tokenDetails)
          ? { tokenDetails: usage.tokenDetails ?? latestUsage?.tokenDetails }
          : {}),
      };
    },
    flush(options: {
      allowFallback: boolean;
      budgetTools: ReadonlyArray<ToolDefinition>;
      requestMessages: Array<{ role: string; content: any }>;
    }) {
      if (usageReported) {
        return;
      }

      const hasRealProviderUsage = usageWasReportedByProvider && latestUsage !== null;

      if (!latestUsage && options.allowFallback) {
        const snapshot = params.getContentSnapshot();
        latestUsage = {
          model: params.requestModel,
          inputTokens:
            estimateMessageTokens(
              options.requestMessages.map((message) => ({
                role: message.role,
                content:
                  typeof message.content === 'string'
                    ? message.content
                    : JSON.stringify(message.content),
              })),
              params.calibrationFamily,
            ) + estimateAllToolTokens([...options.budgetTools], { family: params.calibrationFamily }),
          outputTokens:
            estimateTokens(snapshot.fullContent, params.calibrationFamily) +
            estimateTokens(snapshot.reasoning, params.calibrationFamily),
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0,
        };
        latestUsage.totalTokens = latestUsage.inputTokens + latestUsage.outputTokens;
      }

      if (!latestUsage) {
        return;
      }

      // Only a genuinely provider-reported usage is trustworthy ground truth; the fallback
      // above is itself built from this module's own estimator, so folding it back in would
      // just tautologically confirm whatever factor is already in effect.
      if (hasRealProviderUsage) {
        recordModelTurnTokenCalibration({
          family: params.calibrationFamily,
          estimatedTokens: params.preflightEstimatedInputTokens,
          actualTokens: latestUsage.inputTokens,
          appliedFactor: params.appliedCalibrationFactor,
          requestHasImageAttachment: params.requestHasImageAttachment === true,
        });
      }

      usageReported = true;
      params.reportUsage({
        ...latestUsage,
        ...(params.usageTelemetry?.tokenBuckets
          ? { tokenBuckets: params.usageTelemetry.tokenBuckets }
          : {}),
        ...(params.usageTelemetry?.promptCache
          ? { promptCache: params.usageTelemetry.promptCache }
          : {}),
      });
    },
  };
}
