const fs = require('fs');
const { workerData } = require('worker_threads');

const READY_INDEX = 0;
const STOP_INDEX = 1;
const STOPPED_INDEX = 2;
const ERROR_INDEX = 3;

const state = new Int32Array(workerData.stateBuffer);

try {
  Atomics.store(state, READY_INDEX, 1);
  Atomics.notify(state, READY_INDEX);
  while (Atomics.load(state, STOP_INDEX) === 0) {
    Atomics.wait(state, STOP_INDEX, 0, workerData.intervalMs);
    if (Atomics.load(state, STOP_INDEX) !== 0) {
      break;
    }
    const now = new Date();
    fs.utimesSync(workerData.lockDirectoryPath, now, now);
  }
} catch {
  Atomics.store(state, ERROR_INDEX, 1);
} finally {
  Atomics.store(state, STOPPED_INDEX, 1);
  Atomics.notify(state, STOPPED_INDEX);
}
