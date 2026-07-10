const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const properLockfile = require('proper-lockfile');
const { Worker } = require('worker_threads');

const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const DEFAULT_LOCK_STALE_MS = 10_000;
const LOCK_POLL_MS = 25;
const HEARTBEAT_READY_TIMEOUT_MS = 5_000;
const HEARTBEAT_STOP_TIMEOUT_MS = 5_000;
const HEARTBEAT_READY_INDEX = 0;
const HEARTBEAT_STOP_INDEX = 1;
const HEARTBEAT_STOPPED_INDEX = 2;
const HEARTBEAT_ERROR_INDEX = 3;

function sleepSync(durationMs) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, durationMs);
}

function uniqueManagedPath(parentDir, baseName, kind) {
  return path.join(
    parentDir,
    `.${baseName}.${kind}-${process.pid}-${crypto.randomBytes(8).toString('hex')}`,
  );
}

function atomicWriteFileSync(filePath, content, encoding = 'utf8') {
  const resolvedPath = path.resolve(filePath);
  const parentDir = path.dirname(resolvedPath);
  fs.mkdirSync(parentDir, { recursive: true });
  const tempPath = uniqueManagedPath(parentDir, path.basename(resolvedPath), 'tmp');
  let fileDescriptor;
  try {
    fileDescriptor = fs.openSync(tempPath, 'wx', 0o600);
    fs.writeFileSync(fileDescriptor, content, { encoding });
    fs.fsyncSync(fileDescriptor);
    fs.closeSync(fileDescriptor);
    fileDescriptor = undefined;
    fs.renameSync(tempPath, resolvedPath);
  } finally {
    if (fileDescriptor !== undefined) {
      fs.closeSync(fileDescriptor);
    }
    fs.rmSync(tempPath, { force: true });
  }
}

function startLockHeartbeat(lockDirectoryPath, staleMs) {
  const stateBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 4);
  const state = new Int32Array(stateBuffer);
  const worker = new Worker(path.join(__dirname, 'fileLockHeartbeat.js'), {
    workerData: {
      intervalMs: Math.max(1_000, Math.floor(staleMs / 3)),
      lockDirectoryPath,
      stateBuffer,
    },
  });
  worker.unref();
  const ready = Atomics.wait(state, HEARTBEAT_READY_INDEX, 0, HEARTBEAT_READY_TIMEOUT_MS);
  if (ready === 'timed-out' || Atomics.load(state, HEARTBEAT_READY_INDEX) !== 1) {
    void worker.terminate();
    throw new Error(`Timed out starting evaluation artifact lock heartbeat: ${lockDirectoryPath}`);
  }

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    Atomics.store(state, HEARTBEAT_STOP_INDEX, 1);
    Atomics.notify(state, HEARTBEAT_STOP_INDEX);
    const stopResult = Atomics.wait(state, HEARTBEAT_STOPPED_INDEX, 0, HEARTBEAT_STOP_TIMEOUT_MS);
    void worker.terminate();
    if (
      stopResult === 'timed-out' ||
      Atomics.load(state, HEARTBEAT_STOPPED_INDEX) !== 1 ||
      Atomics.load(state, HEARTBEAT_ERROR_INDEX) !== 0
    ) {
      throw new Error(`Evaluation artifact lock heartbeat failed: ${lockDirectoryPath}`);
    }
  };
}

function acquireFileLockSync(lockPath, options = {}) {
  const resolvedPath = path.resolve(lockPath);
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const staleMs = Math.max(5_000, options.staleMs ?? DEFAULT_LOCK_STALE_MS);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const startedAt = Date.now();
  let releaseLock;
  while (!releaseLock) {
    try {
      releaseLock = properLockfile.lockSync(resolvedPath, {
        realpath: false,
        stale: staleMs,
        update: Math.max(1_000, Math.floor(staleMs / 2)),
      });
    } catch (error) {
      if (error?.code !== 'ELOCKED') {
        throw error;
      }
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= timeoutMs) {
        throw new Error(`Timed out acquiring evaluation artifact lock: ${resolvedPath}`);
      }
      sleepSync(Math.min(LOCK_POLL_MS, timeoutMs - elapsedMs));
    }
  }
  let stopHeartbeat;
  try {
    stopHeartbeat = startLockHeartbeat(`${resolvedPath}.lock`, staleMs);
  } catch (error) {
    releaseLock();
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    let heartbeatError;
    try {
      stopHeartbeat();
    } catch (error) {
      heartbeatError = error;
    }
    releaseLock();
    if (heartbeatError) {
      throw heartbeatError;
    }
  };
}

function withFileLockSync(lockPath, callback, options) {
  const release = acquireFileLockSync(lockPath, options);
  try {
    return callback();
  } finally {
    release();
  }
}

function replaceDirectoryFromStagingSync(stagingDir, targetDir) {
  const resolvedStagingDir = path.resolve(stagingDir);
  const resolvedTargetDir = path.resolve(targetDir);
  const parentDir = path.dirname(resolvedTargetDir);
  if (path.dirname(resolvedStagingDir) !== parentDir) {
    throw new Error('Evaluation artifact staging and target directories must share a parent.');
  }
  if (!fs.statSync(resolvedStagingDir).isDirectory()) {
    throw new Error(`Evaluation artifact staging path is not a directory: ${resolvedStagingDir}`);
  }

  const backupDir = uniqueManagedPath(parentDir, path.basename(resolvedTargetDir), 'backup');
  const targetExists = fs.existsSync(resolvedTargetDir);
  if (targetExists) {
    fs.renameSync(resolvedTargetDir, backupDir);
  }
  try {
    fs.renameSync(resolvedStagingDir, resolvedTargetDir);
  } catch (error) {
    if (targetExists && fs.existsSync(backupDir) && !fs.existsSync(resolvedTargetDir)) {
      fs.renameSync(backupDir, resolvedTargetDir);
    }
    throw error;
  }
  fs.rmSync(backupDir, { recursive: true, force: true });
}

function removeManagedTransactionResidueSync(parentDir, baseName) {
  if (!fs.existsSync(parentDir)) return;
  const targetDir = path.join(parentDir, baseName);
  const backupPrefix = `.${baseName}.backup-`;
  const entries = fs.readdirSync(parentDir);
  const backups = entries
    .filter((entry) => entry.startsWith(backupPrefix))
    .map((entry) => ({ entry, mtimeMs: fs.statSync(path.join(parentDir, entry)).mtimeMs }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  if (!fs.existsSync(targetDir) && backups.length > 0) {
    fs.renameSync(path.join(parentDir, backups[0].entry), targetDir);
  }
  const removablePrefixes = [`.${baseName}.staging-`, `.${baseName}.backup-`, `.${baseName}.tmp-`];
  for (const entry of fs.readdirSync(parentDir)) {
    if (removablePrefixes.some((prefix) => entry.startsWith(prefix))) {
      fs.rmSync(path.join(parentDir, entry), { recursive: true, force: true });
    }
  }
}

module.exports = {
  DEFAULT_LOCK_STALE_MS,
  DEFAULT_LOCK_TIMEOUT_MS,
  acquireFileLockSync,
  atomicWriteFileSync,
  removeManagedTransactionResidueSync,
  replaceDirectoryFromStagingSync,
  uniqueManagedPath,
  withFileLockSync,
};
