import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { MemoryRetrievalFeedbackChoice } from '../../services/memory/retrievalOutcomeStore';
import type { AssistantBubbleStyles } from './AssistantBubble.styles';

type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

const CHOICES: ReadonlyArray<{
  outcome: MemoryRetrievalFeedbackChoice;
  translationKey: string;
}> = [
  { outcome: 'helpful', translationKey: 'chat.memoryFeedbackHelpful' },
  { outcome: 'wrong', translationKey: 'chat.memoryFeedbackWrong' },
  { outcome: 'irrelevant', translationKey: 'chat.memoryFeedbackIrrelevant' },
];

export const AssistantMemoryFeedback = React.memo(function AssistantMemoryFeedback(props: {
  eventId: string;
  messageId: string;
  onLoad?: (messageId: string, eventId: string) => Promise<MemoryRetrievalFeedbackChoice | null>;
  onSubmit: (
    messageId: string,
    eventId: string,
    outcome: MemoryRetrievalFeedbackChoice,
  ) => Promise<MemoryRetrievalFeedbackChoice>;
  styles: AssistantBubbleStyles;
  t: TranslationFn;
}) {
  const { eventId, messageId, onLoad } = props;
  const [selectedOutcome, setSelectedOutcome] = useState<MemoryRetrievalFeedbackChoice | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [submissionFailed, setSubmissionFailed] = useState(false);
  const submissionInFlight = useRef(false);
  const operationVersion = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operationVersion.current += 1;
      submissionInFlight.current = false;
    };
  }, []);

  useEffect(() => {
    const version = operationVersion.current + 1;
    operationVersion.current = version;
    let active = true;
    submissionInFlight.current = false;
    setSelectedOutcome(null);
    setSubmitting(false);
    setSubmissionFailed(false);
    if (!onLoad) {
      return () => {
        active = false;
      };
    }
    void onLoad(messageId, eventId)
      .then((outcome) => {
        if (active && mounted.current && operationVersion.current === version) {
          setSelectedOutcome(outcome);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [eventId, messageId, onLoad]);

  const submit = async (outcome: MemoryRetrievalFeedbackChoice) => {
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    const version = operationVersion.current + 1;
    operationVersion.current = version;
    setSubmitting(true);
    setSubmissionFailed(false);
    try {
      const recordedOutcome = await props.onSubmit(props.messageId, props.eventId, outcome);
      if (mounted.current && operationVersion.current === version) {
        setSelectedOutcome(recordedOutcome);
      }
    } catch {
      if (mounted.current && operationVersion.current === version) setSubmissionFailed(true);
    } finally {
      if (mounted.current && operationVersion.current === version) {
        submissionInFlight.current = false;
        setSubmitting(false);
      }
    }
  };

  return (
    <View style={props.styles.memoryFeedback} testID="assistant-memory-feedback">
      <Text style={props.styles.memoryFeedbackPrompt}>{props.t('chat.memoryFeedbackPrompt')}</Text>
      <View style={props.styles.memoryFeedbackChoices}>
        {CHOICES.map((choice) => {
          const selected = selectedOutcome === choice.outcome;
          return (
            <Pressable
              key={choice.outcome}
              accessibilityLabel={props.t(choice.translationKey)}
              accessibilityRole="button"
              accessibilityState={{ disabled: submitting, selected }}
              disabled={submitting}
              onPress={() => void submit(choice.outcome)}
              style={({ pressed }) => [
                props.styles.memoryFeedbackChoice,
                selected ? props.styles.memoryFeedbackChoiceSelected : null,
                pressed && !submitting ? props.styles.memoryFeedbackChoicePressed : null,
              ]}
              testID={`assistant-memory-feedback-${choice.outcome}`}
            >
              <Text
                style={[
                  props.styles.memoryFeedbackChoiceText,
                  selected ? props.styles.memoryFeedbackChoiceTextSelected : null,
                ]}
              >
                {props.t(choice.translationKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {submissionFailed ? (
        <Text accessibilityRole="alert" style={props.styles.memoryFeedbackError}>
          {props.t('chat.memoryFeedbackFailed')}
        </Text>
      ) : null}
    </View>
  );
});
