import { Platform } from 'react-native';
import type { LocalLlmPlatform } from '../../types/provider';

export function getAndroidApiLevel(): number | null {
  if (Platform.OS !== 'android') {
    return null;
  }

  const version = Platform.Version;
  if (typeof version === 'number' && Number.isFinite(version)) {
    return version;
  }

  const parsed = Number(version);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatLocalLlmPlatform(platform: LocalLlmPlatform): string {
  return platform === 'ios' ? 'iOS' : 'Android';
}
