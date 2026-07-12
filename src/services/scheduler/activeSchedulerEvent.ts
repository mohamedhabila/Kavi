import { AppState } from 'react-native';
import { emitSchedulerEvent } from '../events/bus';

export async function emitActiveSchedulerEvent(
  ...args: Parameters<typeof emitSchedulerEvent>
): Promise<void> {
  if (AppState.currentState !== 'active') return;
  await emitSchedulerEvent(...args);
}
