import { File } from 'expo-file-system';
import { sha256HexUtf8Async } from '../utils/sha256Async';

const STORAGE_FORMAT = 'kavi.persisted-file-generation';
const STORAGE_FORMAT_VERSION = 2;

export type PersistedGenerationSlot = 'primary' | 'backup' | 'temp';

export interface PersistedGenerationFileUris {
  primary: string;
  backup: string;
  temp: string;
}

export type PersistedFileGeneration =
  | { generation: number; kind: 'value'; payload: string }
  | { generation: number; kind: 'tombstone' };

export type PersistedGenerationMutationBoundary =
  | 'temp_write'
  | 'current_to_backup_move'
  | 'temp_to_primary_move'
  | 'tombstone_backup_delete';

export interface PersistedGenerationBoundaryEvent {
  boundary: PersistedGenerationMutationBoundary;
  phase: 'before' | 'after';
}

interface StoredGeneration {
  generation: number;
  kind: 'value' | 'tombstone';
  payload: string | null;
  checksum: string;
  serialized: string;
  slot: PersistedGenerationSlot;
}

interface GenerationEnvelope {
  format: typeof STORAGE_FORMAT;
  version: typeof STORAGE_FORMAT_VERSION;
  generation: number;
  kind: 'value' | 'tombstone';
  checksum: string;
  payload: string | null;
}

type BoundaryHook = (event: PersistedGenerationBoundaryEvent) => void;

let boundaryHook: BoundaryHook | null = null;
const generationOperations = new Map<string, Promise<void>>();

function assertGenerationFileUris(files: PersistedGenerationFileUris): void {
  const uris = [files.primary, files.backup, files.temp];
  if (uris.some((uri) => typeof uri !== 'string' || !uri) || new Set(uris).size !== uris.length) {
    throw new Error('persist_generation_invalid_file_set');
  }
}

async function serializeGenerationOperation<T>(
  files: PersistedGenerationFileUris,
  operation: () => Promise<T>,
): Promise<T> {
  assertGenerationFileUris(files);
  const key = files.primary;
  const predecessor = generationOperations.get(key) ?? Promise.resolve();
  const running = predecessor.catch(() => undefined).then(operation);
  const settled = running.then(
    () => undefined,
    () => undefined,
  );
  generationOperations.set(key, settled);
  try {
    return await running;
  } finally {
    if (generationOperations.get(key) === settled) {
      generationOperations.delete(key);
    }
  }
}

function fileForSlot(files: PersistedGenerationFileUris, slot: PersistedGenerationSlot): File {
  return new File(files[slot]);
}

async function readFileText(file: File, slot: PersistedGenerationSlot): Promise<string | null> {
  if (!file.exists) {
    return null;
  }
  try {
    return await file.text();
  } catch {
    throw new Error(`persist_generation_read_failed:${slot}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidJson(value: string): boolean {
  if (!value) {
    return false;
  }
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

async function generationChecksum(
  generation: number,
  kind: GenerationEnvelope['kind'],
  payload: string | null,
): Promise<string> {
  return sha256HexUtf8Async(`${generation}\u0000${kind}\u0000${payload ?? ''}`);
}

async function buildStoredGeneration(
  generation: number,
  kind: GenerationEnvelope['kind'],
  payload: string | null,
  slot: PersistedGenerationSlot,
): Promise<StoredGeneration> {
  if (
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    (kind === 'value' ? typeof payload !== 'string' || !isValidJson(payload) : payload !== null)
  ) {
    throw new Error('persist_generation_invalid_payload');
  }
  const checksum = await generationChecksum(generation, kind, payload);
  const envelope: GenerationEnvelope = {
    format: STORAGE_FORMAT,
    version: STORAGE_FORMAT_VERSION,
    generation,
    kind,
    checksum,
    payload,
  };
  return { ...envelope, serialized: JSON.stringify(envelope), slot };
}

async function parseStoredGeneration(
  serialized: string | null,
  slot: PersistedGenerationSlot,
): Promise<StoredGeneration | null> {
  if (!serialized) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }

  const keys = Object.keys(parsed).sort();
  if (
    keys.length !== 6 ||
    keys[0] !== 'checksum' ||
    keys[1] !== 'format' ||
    keys[2] !== 'generation' ||
    keys[3] !== 'kind' ||
    keys[4] !== 'payload' ||
    keys[5] !== 'version' ||
    parsed.format !== STORAGE_FORMAT ||
    parsed.version !== STORAGE_FORMAT_VERSION ||
    !Number.isSafeInteger(parsed.generation) ||
    (parsed.generation as number) < 1 ||
    (parsed.kind !== 'value' && parsed.kind !== 'tombstone') ||
    typeof parsed.checksum !== 'string' ||
    !/^[a-f0-9]{64}$/.test(parsed.checksum) ||
    (parsed.kind === 'value'
      ? typeof parsed.payload !== 'string' || !isValidJson(parsed.payload)
      : parsed.payload !== null)
  ) {
    return null;
  }

  const generation = parsed.generation as number;
  const kind = parsed.kind as GenerationEnvelope['kind'];
  const payload = parsed.payload as string | null;
  const checksum = await generationChecksum(generation, kind, payload);
  if (checksum !== parsed.checksum) {
    return null;
  }
  return { generation, kind, checksum, payload, serialized, slot };
}

async function inspectGenerations(files: PersistedGenerationFileUris): Promise<StoredGeneration[]> {
  const slots: PersistedGenerationSlot[] = ['primary', 'backup', 'temp'];
  const inspected = await Promise.all(
    slots.map(async (slot) => {
      const file = fileForSlot(files, slot);
      if (!file.exists) {
        return { exists: false, generation: null };
      }
      return {
        exists: true,
        generation: await parseStoredGeneration(await readFileText(file, slot), slot),
      };
    }),
  );
  const valid = inspected
    .map((entry) => entry.generation)
    .filter((value): value is StoredGeneration => value !== null);
  if (valid.length === 0 && inspected.some((entry) => entry.exists)) {
    throw new Error('persist_generation_no_valid_state');
  }
  return valid;
}

function orderedDistinctGenerations(generations: StoredGeneration[]): StoredGeneration[] {
  const byGeneration = new Map<number, StoredGeneration>();
  for (const candidate of generations) {
    const existing = byGeneration.get(candidate.generation);
    if (
      existing &&
      (existing.kind !== candidate.kind ||
        existing.payload !== candidate.payload ||
        existing.checksum !== candidate.checksum)
    ) {
      throw new Error('persist_generation_collision');
    }
    if (!existing || candidate.slot === 'primary') {
      byGeneration.set(candidate.generation, candidate);
    }
  }
  return Array.from(byGeneration.values()).sort(
    (left, right) => right.generation - left.generation,
  );
}

function deleteStrict(file: File): void {
  if (file.exists) {
    file.delete();
  }
}

function runBoundary(boundary: PersistedGenerationMutationBoundary, mutation: () => void): void {
  boundaryHook?.({ boundary, phase: 'before' });
  mutation();
  boundaryHook?.({ boundary, phase: 'after' });
}

function toPublicGeneration(generation: StoredGeneration): PersistedFileGeneration {
  return generation.kind === 'value'
    ? { generation: generation.generation, kind: 'value', payload: generation.payload as string }
    : { generation: generation.generation, kind: 'tombstone' };
}

async function writeValidatedTemp(
  files: PersistedGenerationFileUris,
  generation: StoredGeneration,
): Promise<void> {
  runBoundary('temp_write', () => fileForSlot(files, 'temp').write(generation.serialized));
  if ((await readFileText(fileForSlot(files, 'temp'), 'temp')) !== generation.serialized) {
    throw new Error('persist_generation_temp_validation_failed');
  }
}

async function promoteTempToPrimary(files: PersistedGenerationFileUris): Promise<void> {
  runBoundary('temp_to_primary_move', () =>
    fileForSlot(files, 'temp').move(fileForSlot(files, 'primary')),
  );
}

async function recoverCanonicalGeneration(
  files: PersistedGenerationFileUris,
  generations: StoredGeneration[],
): Promise<StoredGeneration | null> {
  const ordered = orderedDistinctGenerations(generations);
  const newest = ordered[0];
  if (!newest) {
    return null;
  }

  const primary = generations.find(
    (candidate) =>
      candidate.slot === 'primary' &&
      candidate.generation === newest.generation &&
      candidate.checksum === newest.checksum,
  );
  if (primary) {
    deleteStrict(fileForSlot(files, 'temp'));
    if (primary.kind === 'tombstone') {
      runBoundary('tombstone_backup_delete', () => deleteStrict(fileForSlot(files, 'backup')));
    }
    return { ...primary, slot: 'primary' };
  }

  const prior = ordered.find((candidate) => candidate.generation < newest.generation);
  const currentPrimary = generations.find((candidate) => candidate.slot === 'primary');
  if (newest.slot !== 'temp') {
    await writeValidatedTemp(files, newest);
  }

  if (
    prior &&
    currentPrimary?.generation === prior.generation &&
    currentPrimary.checksum === prior.checksum
  ) {
    deleteStrict(fileForSlot(files, 'backup'));
    runBoundary('current_to_backup_move', () =>
      fileForSlot(files, 'primary').move(fileForSlot(files, 'backup')),
    );
  } else {
    deleteStrict(fileForSlot(files, 'primary'));
  }

  await promoteTempToPrimary(files);
  if ((await readFileText(fileForSlot(files, 'primary'), 'primary')) !== newest.serialized) {
    throw new Error('persist_generation_recovery_validation_failed');
  }
  if (newest.kind === 'tombstone') {
    runBoundary('tombstone_backup_delete', () => deleteStrict(fileForSlot(files, 'backup')));
  }
  return { ...newest, slot: 'primary' };
}

/**
 * Reads all explicit generations and selects by the persisted monotonic
 * generation number. Slot names and modification times never decide recency.
 * A newest tombstone is authoritative deletion state. Existing unreadable or
 * wholly invalid state throws instead of being treated as an empty database.
 */
export async function readLatestPersistedGeneration(
  files: PersistedGenerationFileUris,
): Promise<PersistedFileGeneration | null> {
  return serializeGenerationOperation(files, async () => {
    const inspected = await inspectGenerations(files);
    const newest = orderedDistinctGenerations(inspected)[0];
    if (!newest) {
      return null;
    }

    try {
      const recovered = await recoverCanonicalGeneration(files, inspected);
      return recovered ? toPublicGeneration(recovered) : null;
    } catch {
      // Canonical placement is repair work, not a condition for reading. Re-read
      // after a failed native operation and return only the highest surviving,
      // independently validated generation. Equal-generation collisions still
      // throw from orderedDistinctGenerations and therefore fail closed.
      const surviving = orderedDistinctGenerations(await inspectGenerations(files))[0];
      return surviving ? toPublicGeneration(surviving) : null;
    }
  });
}

/**
 * Commits a complete, checksummed temp generation, moves the current primary
 * to backup regardless of payload size, then promotes temp to primary.
 *
 * Supported invariant: before and after each Expo FileSystem operation, at
 * least one fully validated generation remains, and a successful replacement
 * retains the immediately prior generation. Expo does not document File.move
 * as an atomic rename (Android versions below API 26 implement copy/delete),
 * so this primitive intentionally makes no power-loss guarantee *inside* a
 * native move. Recovery validates every surviving generation and fails closed.
 */
export async function commitPersistedGeneration(
  files: PersistedGenerationFileUris,
  payload: string,
): Promise<PersistedFileGeneration> {
  return serializeGenerationOperation(files, async () => {
    const current = await recoverCanonicalGeneration(files, await inspectGenerations(files));
    if (current?.kind === 'value' && current.payload === payload) {
      return { generation: current.generation, kind: 'value', payload };
    }

    const nextGeneration = (current?.generation ?? 0) + 1;
    if (!Number.isSafeInteger(nextGeneration)) {
      throw new Error('persist_generation_exhausted');
    }
    const next = await buildStoredGeneration(nextGeneration, 'value', payload, 'temp');
    await writeValidatedTemp(files, next);

    deleteStrict(fileForSlot(files, 'backup'));
    const primary = fileForSlot(files, 'primary');
    if (primary.exists) {
      if (current) {
        runBoundary('current_to_backup_move', () =>
          fileForSlot(files, 'primary').move(fileForSlot(files, 'backup')),
        );
      } else {
        deleteStrict(primary);
      }
    }

    await promoteTempToPrimary(files);
    if ((await readFileText(fileForSlot(files, 'primary'), 'primary')) !== next.serialized) {
      throw new Error('persist_generation_commit_validation_failed');
    }
    return { generation: next.generation, kind: 'value', payload };
  });
}

/**
 * Persists deletion as a newer checksummed generation before attempting to
 * erase older payload bytes. Cleanup failure cannot make an older value win.
 */
export async function commitPersistedTombstone(
  files: PersistedGenerationFileUris,
): Promise<PersistedFileGeneration> {
  return serializeGenerationOperation(files, async () => {
    const current = await recoverCanonicalGeneration(files, await inspectGenerations(files));
    if (current?.kind === 'tombstone') {
      return { generation: current.generation, kind: 'tombstone' };
    }

    const nextGeneration = (current?.generation ?? 0) + 1;
    if (!Number.isSafeInteger(nextGeneration)) {
      throw new Error('persist_generation_exhausted');
    }
    const tombstone = await buildStoredGeneration(nextGeneration, 'tombstone', null, 'temp');
    await writeValidatedTemp(files, tombstone);

    deleteStrict(fileForSlot(files, 'backup'));
    const primary = fileForSlot(files, 'primary');
    if (primary.exists) {
      if (current) {
        runBoundary('current_to_backup_move', () =>
          fileForSlot(files, 'primary').move(fileForSlot(files, 'backup')),
        );
      } else {
        deleteStrict(primary);
      }
    }
    await promoteTempToPrimary(files);
    if ((await readFileText(fileForSlot(files, 'primary'), 'primary')) !== tombstone.serialized) {
      throw new Error('persist_generation_commit_validation_failed');
    }

    runBoundary('tombstone_backup_delete', () => deleteStrict(fileForSlot(files, 'backup')));
    return { generation: tombstone.generation, kind: 'tombstone' };
  });
}

/** Visible for deterministic operation-boundary failure tests only. */
export function _setPersistedGenerationBoundaryHookForTests(hook: BoundaryHook | null): void {
  boundaryHook = hook;
}
