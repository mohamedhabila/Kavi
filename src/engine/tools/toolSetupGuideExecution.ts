import { resolveSetupGuide } from '../../services/setup/setupGuides';
import { SETUP_TOPICS, type SetupTopic } from '../../services/setup/setupGuideTypes';
import { completedToolOutcome, failedToolOutcome } from '../../types/toolRuntimeOutcome';

export async function executeSetupGuide(args: unknown) {
  const record = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
  const topic = record.topic;
  if (!SETUP_TOPICS.includes(topic as SetupTopic)) {
    return failedToolOutcome(
      JSON.stringify({
        status: 'invalid_arguments',
        error: `topic must be one of ${SETUP_TOPICS.join(', ')}.`,
      }),
      'invalid_arguments',
    );
  }
  const option =
    typeof record.option === 'string' && record.option.trim() ? record.option.trim() : undefined;
  const resolved = await resolveSetupGuide(topic as SetupTopic, option);
  return completedToolOutcome(
    JSON.stringify({
      status: resolved.state.unavailable
        ? 'not_possible_on_this_phone'
        : resolved.state.configured === true
          ? 'already_set_up'
          : 'setup_needed',
      topic,
      ...(option ? { option } : {}),
      state: resolved.state,
      guide: resolved.guide,
      ...(resolved.registry ? { registry: resolved.registry } : {}),
    }),
  );
}
