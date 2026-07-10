const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const DEFAULT_LOCK_STALE_MS = 120_000;
const LOCK_POLL_MS = 25;

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

function isStaleLock(lockPath, staleMs, nowMs) {
  try {
    return nowMs - fs.statSync(lockPath).mtimeMs >= staleMs;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function acquireFileLockSync(lockPath, options = {}) {
  const resolvedPath = path.resolve(lockPath);
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const staleMs = options.staleMs ?? DEFAULT_LOCK_STALE_MS;
  const startedAt = Date.now();
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  while (true) {
    try {
      const descriptor = fs.openSync(resolvedPath, 'wx', 0o600);
      fs.writeFileSync(
        descriptor,
        JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }),
        'utf8',
      );
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        fs.rmSync(resolvedPath, { force: true });
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
      const now = Date.now();
      if (isStaleLock(resolvedPath, staleMs, now)) {
        fs.rmSync(resolvedPath, { force: true });
        continue;
      }
      if (now - startedAt >= timeoutMs) {
        throw new Error(`Timed out acquiring evaluation artifact lock: ${resolvedPath}`);
      }
      sleepSync(Math.min(LOCK_POLL_MS, Math.max(1, timeoutMs - (now - startedAt))));
    }
  }
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
  const prefixes = [`.${baseName}.staging-`, `.${baseName}.backup-`, `.${baseName}.tmp-`];
  for (const entry of fs.readdirSync(parentDir)) {
    if (prefixes.some((prefix) => entry.startsWith(prefix))) {
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
