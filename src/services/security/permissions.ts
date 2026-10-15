// ---------------------------------------------------------------------------
// Kavi — Tool Permissions (allow/deny per-tool control)
// ---------------------------------------------------------------------------

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { startOverFromOtherVersion } from '../../store/persistedStoreVersion';

export interface ToolPermission {
  toolName: string;
  allowed: boolean;
  requireConfirmation: boolean;
}

interface ToolPermissionsState {
  permissions: ToolPermission[];
  setPermission: (toolName: string, allowed: boolean, requireConfirmation?: boolean) => void;
  removePermission: (toolName: string) => void;
  isAllowed: (toolName: string) => boolean;
  requiresConfirmation: (toolName: string) => boolean;
  getAllowed: () => Set<string>;
  reset: () => void;
}

// Tools that always require confirmation for safety
const ALWAYS_CONFIRM = new Set<string>([
  'write_file',
  'file_edit',
  'calendar_list',
  'calendar_events',
  'calendar_create_event',
  'calendar_update_event',
  'email_compose',
  'sms_compose',
  'sms_send',
  'chat_compose',
  'phone_call',
  'maps_open',
  'contacts_pick',
  'contacts_manage_access',
  'contacts_form',
  'contacts_share',
  'contacts_search',
  'contacts_get',
  'location_current',
  'clipboard_read',
  'clipboard_write',
  'share_text',
  'share_file',
  'open_url',
  'notification_send',
  'notifications_read',
  'notifications_reply',
  'photos_pick',
  'camera_clip',
  'screen_record',
  'cron',
  'ssh_fs',
]);

export const useToolPermissionsStore = create<ToolPermissionsState>()(
  persist(
    (set, get) => ({
      permissions: [],

      setPermission: (toolName, allowed, requireConfirmation) =>
        set((state) => {
          const existing = state.permissions.findIndex((p) => p.toolName === toolName);
          const perm: ToolPermission = {
            toolName,
            allowed,
            requireConfirmation: requireConfirmation ?? ALWAYS_CONFIRM.has(toolName),
          };
          if (existing >= 0) {
            const updated = [...state.permissions];
            updated[existing] = perm;
            return { permissions: updated };
          }
          return { permissions: [...state.permissions, perm] };
        }),

      removePermission: (toolName) =>
        set((state) => ({
          permissions: state.permissions.filter((p) => p.toolName !== toolName),
        })),

      isAllowed: (toolName) => {
        const perm = get().permissions.find((p) => p.toolName === toolName);
        return perm ? perm.allowed : true; // Default: allowed
      },

      requiresConfirmation: (toolName) => {
        const perm = get().permissions.find((p) => p.toolName === toolName);
        if (perm) return perm.requireConfirmation;
        return ALWAYS_CONFIRM.has(toolName);
      },

      getAllowed: () => {
        const allowed = new Set(
          get()
            .permissions.filter((p) => p.allowed)
            .map((p) => p.toolName),
        );
        return allowed;
      },

      reset: () => set({ permissions: [] }),
    }),
    {
      name: 'kavi-tool-permissions',
      storage: createJSONStorage(() => AsyncStorage),
      migrate: startOverFromOtherVersion,
    },
  ),
);
