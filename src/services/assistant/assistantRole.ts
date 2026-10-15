// ---------------------------------------------------------------------------
// Kavi — Phone Assistant Role
// ---------------------------------------------------------------------------
// On Android, Kavi can be the phone's default digital assistant: a long press on home or
// power, or a headset's voice button, opens Kavi straight into voice. Apps cannot request
// the role, so the person picks Kavi in the system's assistant settings.

import { NativeModules, Platform } from 'react-native';

export type AssistantRoleState = 'held' | 'not_held' | 'unavailable';

type AssistantNativeModule = {
  getAssistantRoleState(): Promise<AssistantRoleState>;
  openAssistantSettings(): Promise<boolean>;
};

function assistantNativeModule(): AssistantNativeModule | undefined {
  if (Platform.OS !== 'android') return undefined;
  return NativeModules.KaviAssistant as AssistantNativeModule | undefined;
}

/** Whether Kavi is the phone's assistant, or 'unavailable' where there is no such role. */
export async function getAssistantRoleState(): Promise<AssistantRoleState> {
  const nativeModule = assistantNativeModule();
  if (!nativeModule) return 'unavailable';
  return nativeModule.getAssistantRoleState();
}

/** Opens the system's assistant settings; false when this device has none to open. */
export async function openAssistantSettings(): Promise<boolean> {
  const nativeModule = assistantNativeModule();
  if (!nativeModule) return false;
  return nativeModule.openAssistantSettings();
}
