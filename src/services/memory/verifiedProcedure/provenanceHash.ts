import { sha256HexUtf8 } from '../../../utils/sha256';

export type VerifiedProcedureProvenanceHashDomain =
  | 'memory-conversation'
  | 'memory-source-message'
  | 'memory-source-run'
  | 'memory-source-task'
  | 'memory-source-turn'
  | 'source-thread'
  | 'source-run';

/** Exact durable source identities shared with normal turn-memory ingestion. */
export type VerifiedProcedureMemoryLineage = Readonly<{
  sourceMessageId: string;
  sourceRunId: string | null;
  sourceTurnId: string;
  taskId: string | null;
}>;

/** Content-free persisted form of one exact turn-memory source lineage. */
export type VerifiedProcedureMemoryLineageHashes = Readonly<{
  sourceMessageIdHash: string;
  sourceRunIdHash: string | null;
  sourceTurnIdHash: string;
  taskIdHash: string | null;
}>;

export function verifiedProcedureProvenanceHashInput(
  domain: VerifiedProcedureProvenanceHashDomain,
  value: string,
): string {
  return `kavi.verified-procedure.${domain}.v1\u0000${value}`;
}

export function hashVerifiedProcedureProvenanceSync(
  domain: VerifiedProcedureProvenanceHashDomain,
  value: string,
): string {
  return sha256HexUtf8(verifiedProcedureProvenanceHashInput(domain, value));
}
