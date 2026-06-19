import React from 'react';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';
import type { getAllCommands } from '../../services/commands/builtins';
import type { ChatInputStyles } from './ChatInput.styles';

type ChatCommand = ReturnType<typeof getAllCommands>[number];
type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

type ChatInputCommandSuggestionsProps = {
  disabled: boolean;
  onSelect: (commandName: string) => void;
  styles: ChatInputStyles;
  suggestions: ChatCommand[];
  t: TranslationFn;
};

export const ChatInputCommandSuggestions = React.memo(function ChatInputCommandSuggestions(
  props: ChatInputCommandSuggestionsProps,
) {
  if (props.suggestions.length === 0) {
    return null;
  }

  return (
    <View style={props.styles.suggestionsContainer} testID="chat-command-suggestions">
      <FlatList
        data={props.suggestions}
        contentContainerStyle={props.styles.suggestionsListContent}
        initialNumToRender={4}
        keyExtractor={(item) => item.name}
        keyboardShouldPersistTaps="always"
        maxToRenderPerBatch={4}
        renderItem={({ item, index }) => {
          const isSelected = index === 0;

          return (
            <TouchableOpacity
              style={[
                props.styles.suggestionItem,
                isSelected ? props.styles.suggestionItemSelected : null,
              ]}
              onPress={() => props.onSelect(item.name)}
              disabled={props.disabled}
              accessibilityRole="button"
              accessibilityLabel={props.t('chat.commandSuggestion', { name: item.name })}
              accessibilityState={{ disabled: props.disabled, selected: isSelected }}
              testID={`chat-command-suggestion-${item.name.slice(1)}`}
            >
              <Text
                style={[
                  props.styles.suggestionName,
                  isSelected ? props.styles.suggestionNameSelected : null,
                ]}
              >
                {item.name}
              </Text>
              <Text style={props.styles.suggestionDesc} numberOfLines={2}>
                {item.description}
              </Text>
            </TouchableOpacity>
          );
        }}
        scrollEnabled={props.suggestions.length > 4}
        style={props.styles.suggestionsList}
        testID="chat-command-suggestions-list"
        windowSize={3}
      />
    </View>
  );
});
