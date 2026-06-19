import AsyncStorage from '@react-native-async-storage/async-storage';

const CWD_STORAGE_KEY = 'kavi-ssh-cwd';
let workingDirectoryPersistChain: Promise<void> = Promise.resolve();

function parsePersistedWorkingDirectories(raw: string | null): Record<string, string> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && entry[1].trim().length > 0,
      ),
    );
  } catch {
    return {};
  }
}

export async function persistWorkingDirectory(targetId: string, cwd: string): Promise<void> {
  const normalizedCwd = cwd.trim();
  if (!normalizedCwd) {
    return;
  }

  workingDirectoryPersistChain = workingDirectoryPersistChain
    .catch(() => undefined)
    .then(async () => {
      const data = parsePersistedWorkingDirectories(await AsyncStorage.getItem(CWD_STORAGE_KEY));
      data[targetId] = normalizedCwd;
      await AsyncStorage.setItem(CWD_STORAGE_KEY, JSON.stringify(data));
    })
    .catch((err) => {
      console.warn('persistWorkingDirectory failed:', err);
    });

  await workingDirectoryPersistChain;
}

export async function getLastWorkingDirectory(targetId: string): Promise<string | null> {
  try {
    await workingDirectoryPersistChain.catch(() => undefined);
    const data = parsePersistedWorkingDirectories(await AsyncStorage.getItem(CWD_STORAGE_KEY));
    return data[targetId] || null;
  } catch {
    return null;
  }
}
