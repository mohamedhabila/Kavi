import {
  encodeMemoryFactContributionPayload,
  type MemoryFactContributionPayloadV1,
} from './factContributionCodec';
import {
  loadFactContributionReplay,
  type MemoryFactContributionReplay,
  type MemoryFactContributionWriteContext,
} from './factContributionStore';

function payloadsMatch(
  left: MemoryFactContributionPayloadV1,
  right: MemoryFactContributionPayloadV1,
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

/** Verify an exact producer replay before any aggregate fact materialization occurs. */
export function loadVerifiedFactContributionReplay(input: {
  context: MemoryFactContributionWriteContext;
  payload: MemoryFactContributionPayloadV1;
}): MemoryFactContributionReplay | null {
  const replay = loadFactContributionReplay(input.context);
  if (replay && !payloadsMatch(replay.payload, input.payload)) {
    throw new Error('memory_fact_contribution_replay_mismatch');
  }
  return replay;
}
