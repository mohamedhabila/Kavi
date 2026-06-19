import { getSecure } from '../../storage/SecureStorage';

export async function requireSecret(secretName: string): Promise<string> {
  const value = (await getSecure(secretName))?.trim();
  if (!value) {
    throw new Error(`${secretName} not configured. Add it in Settings.`);
  }
  return value;
}
