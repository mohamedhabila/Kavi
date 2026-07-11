import type { CronJob } from '../cron/types';

export function shouldDeliverScheduledJobNotification(job: CronJob): boolean {
  const mode = job.delivery?.mode || 'both';
  return mode === 'notification' || mode === 'both';
}

export function summarizeScheduledJobNotification(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return 'Task completed.';
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}

export function extractScheduledJobMessageEffect(
  result?: string,
): 'confetti' | 'balloons' | 'spotlight' | undefined {
  if (!result) return undefined;
  try {
    const parsed = JSON.parse(result);
    if (
      parsed?.effectId === 'confetti' ||
      parsed?.effectId === 'balloons' ||
      parsed?.effectId === 'spotlight'
    ) {
      return parsed.effectId;
    }
  } catch {
    // Malformed tool results do not carry a message effect.
  }
  return undefined;
}
