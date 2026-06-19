import {
  executeSshDeletePath,
  executeSshExec,
  executeSshListDirectory,
  executeSshMakeDirectory,
  executeSshReadFile,
  executeSshRenamePath,
  executeSshWriteFile,
  installBuiltinExecutorWrapperReset,
  mockAsyncStorageSetItem,
  mockEnhancedExec,
} from '../helpers/builtinExecutorWrappersHarness';

describe('builtin-executor wrapper coverage', () => {
  installBuiltinExecutorWrapperReset();

  it('uses enhanced SSH execution when background mode or custom timeout is requested', async () => {
    await expect(executeSshExec({ command: 'tail -f logs', background: true })).resolves.toBe(
      JSON.stringify({ kind: 'enhanced', status: 'ok' }),
    );
    expect(mockEnhancedExec).toHaveBeenCalledWith(
      'tail -f logs',
      expect.objectContaining({ background: true }),
    );
  });

  it('runs SSH wrappers and normalizes exec, file, and directory payloads', async () => {
    const exec = JSON.parse(await executeSshExec({ command: 'pwd', cwd: '/srv/app' }));
    await Promise.resolve();
    await Promise.resolve();

    const list = JSON.parse(await executeSshListDirectory({ path: '/srv/app' }));
    const read = JSON.parse(await executeSshReadFile({ path: '/srv/app/README.md' }));
    const write = JSON.parse(
      await executeSshWriteFile({ path: '/srv/app/file.txt', content: 'hello' }),
    );
    const rename = JSON.parse(
      await executeSshRenamePath({ oldPath: '/srv/app/file.txt', newPath: '/srv/app/file-2.txt' }),
    );
    const remove = JSON.parse(
      await executeSshDeletePath({ path: '/srv/app/file-2.txt', recursive: true }),
    );
    const mkdir = JSON.parse(await executeSshMakeDirectory({ path: '/srv/app/new-dir' }));

    expect(exec).toEqual(
      expect.objectContaining({
        kind: 'exec',
        command: 'pwd',
        cwd: '/srv/app',
        output: 'command output',
      }),
    );
    expect(list).toEqual(expect.objectContaining({ kind: 'list', path: '/srv/app' }));
    expect(read).toEqual(
      expect.objectContaining({ kind: 'read', path: '/srv/app/README.md', content: 'file text' }),
    );
    expect(write).toEqual(
      expect.objectContaining({
        kind: 'mutation',
        action: 'written',
        path: '/srv/app/file.txt',
        size: 5,
      }),
    );
    expect(rename).toEqual(
      expect.objectContaining({
        kind: 'mutation',
        action: 'renamed',
        oldPath: '/srv/app/file.txt',
        newPath: '/srv/app/file-2.txt',
      }),
    );
    expect(remove).toEqual(
      expect.objectContaining({ kind: 'mutation', action: 'deleted', path: '/srv/app/file-2.txt' }),
    );
    expect(mkdir).toEqual(
      expect.objectContaining({ kind: 'mutation', action: 'created', path: '/srv/app/new-dir' }),
    );
    expect(mockAsyncStorageSetItem).toHaveBeenCalledWith(
      'kavi-ssh-cwd',
      JSON.stringify({ 'ssh-target': '/srv/app' }),
    );
  });
});
