import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import type { ToolCallDisplayStyles } from './ToolCallDisplay.styles';

interface PollOption {
  id: string;
  label: string;
  votes: number;
}

export interface ParsedPoll {
  question: string;
  options: PollOption[];
  allowMultiple?: boolean;
}

interface ToolCallPollProps {
  poll: ParsedPoll;
  styles: ToolCallDisplayStyles;
}

export function parseToolCallPoll(toolName: string, result?: string): ParsedPoll | null {
  if (toolName !== 'poll_create' || !result) {
    return null;
  }

  try {
    const parsed = JSON.parse(result);
    const poll = parsed?.poll as ParsedPoll | undefined;
    if (!poll?.question || !Array.isArray(poll.options)) {
      return null;
    }
    return poll;
  } catch {
    return null;
  }
}

export const ToolCallPoll: React.FC<ToolCallPollProps> = ({ poll, styles }) => {
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);

  const togglePollOption = (optionId: string) => {
    setSelectedOptionIds((current) => {
      if (poll.allowMultiple) {
        return current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId];
      }
      return current.includes(optionId) ? [] : [optionId];
    });
  };

  return (
    <View style={styles.pollCard}>
      <Text style={styles.pollQuestion}>{poll.question}</Text>
      {poll.options.map((option) => {
        const isSelected = selectedOptionIds.includes(option.id);
        const displayedVotes = option.votes + (isSelected ? 1 : 0);
        return (
          <TouchableOpacity
            key={option.id}
            style={[styles.pollOption, isSelected && styles.pollOptionSelected]}
            onPress={() => togglePollOption(option.id)}
            accessibilityRole="button"
            accessibilityLabel={option.label}
          >
            <Text style={styles.pollOptionLabel}>{option.label}</Text>
            <Text style={styles.pollOptionVotes}>{displayedVotes}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};
