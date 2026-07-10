import type { E2EScenarioTraceSummary } from '../../src/acceptance/e2eAgent/e2eTraceSummary';
import type { E2ERedactedHash } from '../../src/acceptance/e2eAgent/e2eTraceRedaction';
import type { E2ERedactedUsageTrace } from '../../src/acceptance/e2eAgent/e2eTraceUsage';

export const SHA256_PATTERN: RegExp;

export function hashPrivateString(value: unknown): E2ERedactedHash;

export function projectPublicRedactedTrace(value: unknown): E2EScenarioTraceSummary | null;

export function projectPublicUsageTrace(value: unknown): E2ERedactedUsageTrace | null;

export function safePublicToolName(value: unknown): string | undefined;
