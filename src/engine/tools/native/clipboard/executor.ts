import * as Clipboard from 'expo-clipboard';

export async function executeClipboardRead(): Promise<string> {
  const text = await Clipboard.getStringAsync();
  return JSON.stringify({
    status: 'read',
    text,
    empty: text.length === 0,
  });
}

export async function executeClipboardWrite(args: { text: string }): Promise<string> {
  await Clipboard.setStringAsync(args.text);
  return JSON.stringify({
    status: 'written',
    characterCount: args.text.length,
  });
}
