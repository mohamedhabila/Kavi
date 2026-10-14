import { emitSchedulerEvent } from '../events/bus';
import { isSchedulerHostActive } from './headlessHost';

export async function emitActiveSchedulerEvent(
  ...args: Parameters<typeof emitSchedulerEvent>
): Promise<void> {
  if (!isSchedulerHostActive()) return;
  await emitSchedulerEvent(...args);
}
