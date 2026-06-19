import * as Clipboard from 'expo-clipboard';

export async function executeClipboardRead(): Promise<string> {
  const text = await Clipboard.getStringAsync();
  return text || '(clipboard is empty)';
}

export async function executeClipboardWrite(args: { text: string }): Promise<string> {
  await Clipboard.setStringAsync(args.text);
  return `Copied ${args.text.length} characters to clipboard`;
}
