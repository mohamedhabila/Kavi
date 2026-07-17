import {
  encodeMemoryFactContributionPayload,
  type MemoryFactContributionPayloadV2,
} from './factContributionCodec';
import {
  loadFactContributionReplay,
  type MemoryFactContributionReplay,
  type MemoryFactContributionWriteContext,
} from './factContributionStore';

function payloadsMatch(
  left: MemoryFactContributionPayloadV2,
  right: MemoryFactContributionPayloadV2,
): boolean {
  const encodedLeft = encodeMemoryFactContributionPayload(left);
  const encodedRight = encodeMemoryFactContributionPayload(right);
  return (
    encodedLeft.payloadVersion === encodedRight.payloadVersion &&
    encodedLeft.payloadSha256 === encodedRight.payloadSha256 &&
    encodedLeft.payloadByteLength === encodedRight.payloadByteLength &&
    encodedLeft.payloadJson === encodedRight.payloadJson
  );
}

/** Prove that a previously committed producer event is the exact requested mutation. */
export function assertMemoryFactContributionReplayPayload(
  replay: MemoryFactContributionReplay,
  payload: MemoryFactContributionPayloadV2,
): void {
  if (!payloadsMatch(replay.payload, payload)) {
    throw new Error('memory_fact_contribution_replay_mismatch');
  }
}

/** Verify an exact producer replay before any aggregate fact materialization occurs. */
export function loadVerifiedFactContributionReplay(input: {
  context: MemoryFactContributionWriteContext;
  payload: MemoryFactContributionPayloadV2;
}): MemoryFactContributionReplay | null {
  const replay = loadFactContributionReplay(input.context);
  if (replay) assertMemoryFactContributionReplayPayload(replay, input.payload);
  return replay;
}
