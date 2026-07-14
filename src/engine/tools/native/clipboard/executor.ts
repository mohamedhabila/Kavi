import * as Clipboard from 'expo-clipboard';
import {
  completedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../../../types/toolRuntimeOutcome';

export async function executeClipboardRead(): Promise<ToolRuntimeOutcome> {
  const text = await Clipboard.getStringAsync();
  return completedToolOutcome(
    JSON.stringify({
      status: 'read',
      text,
      empty: text.length === 0,
    }),
  );
}

export async function executeClipboardWrite(args: { text: string }): Promise<ToolRuntimeOutcome> {
  await Clipboard.setStringAsync(args.text);
  return completedToolOutcome(
    JSON.stringify({
      status: 'written',
      characterCount: args.text.length,
    }),
  );
}
