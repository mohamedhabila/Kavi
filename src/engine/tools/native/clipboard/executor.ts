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
  let verified = false;
  try {
    verified = (await Clipboard.getStringAsync()) === args.text;
  } catch {
    // The write may have applied even when platform readback is unavailable.
  }
  return completedToolOutcome(
    JSON.stringify({
      status: verified ? 'written_verified' : 'written_unverified',
      characterCount: args.text.length,
      verified,
    }),
  );
}
