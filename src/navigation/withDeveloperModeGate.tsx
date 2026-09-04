// ---------------------------------------------------------------------------
// Kavi — Developer Mode navigator gate
// ---------------------------------------------------------------------------
// Wraps a developer-only screen so it stays registered in the navigator (a
// deep link or stale notification still resolves) but renders a short
// "turn on developer mode" state instead of its real content whenever
// Developer Mode is off. The gated screens are unreachable from the normal
// UI (More, Settings) while off — this wrapper is what makes direct
// navigation to them safe regardless.
//
// Kept in its own module (rather than inline in AppNavigator.tsx) so it can
// be unit tested without pulling in the full screen dependency graph that
// AppNavigator.tsx imports.

import React from 'react';
import { DeveloperModeLockedState } from '../screens/components/DeveloperModeLockedState';
import { useSettingsStore } from '../store/useSettingsStore';

export function withDeveloperModeGate(
  Component: React.ComponentType,
  titleKey: string,
  testID: string,
): React.FC {
  const Gated: React.FC = () => {
    const developerModeEnabled = useSettingsStore((s) => s.developerModeEnabled);
    return developerModeEnabled ? (
      <Component />
    ) : (
      <DeveloperModeLockedState testID={testID} titleKey={titleKey} />
    );
  };
  Gated.displayName = `DeveloperModeGated(${Component.displayName || Component.name || 'Screen'})`;
  return Gated;
}
