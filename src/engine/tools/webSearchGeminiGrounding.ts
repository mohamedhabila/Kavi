import { resolveGoogleGroundingRedirectUrl } from '../../services/browser/core/groundingRedirect';
import { normalizeWebSearchResults } from '../../services/browser/core/resultShape';
import {
  deriveSearchTitleFromUrl,
  normalizeSearchText,
} from '../../services/browser/core/resultText';

const MAX_GROUNDING_REDIRECT_CANDIDATES = 24;
const GROUNDING_REDIRECT_CANDIDATE_MULTIPLIER = 3;
const GROUNDING_REDIRECT_RESOLUTION_TIMEOUT_MS = 2500;

export type GeminiGroundingResult = {
  results: Array<{ title: string; url: string; description: string }>;
};

type GeminiGroundingChunk = {
  uri: string;
  title?: string;
  domain?: string;
  supportScore: number;
};

function resolveGeminiRawCandidateLimit(count: number): number {
  return Math.min(
    Math.max(count * GROUNDING_REDIRECT_CANDIDATE_MULTIPLIER, count),
    MAX_GROUNDING_REDIRECT_CANDIDATES,
  );
}

function deriveResultTitle(title: string | undefined, url: string, domain?: string): string {
  if (title) {
    return title;
  }

  if (domain) {
    return domain;
  }

  return deriveSearchTitleFromUrl(url);
}
async function resolveGroundingChunkUrl(url: string, signal?: AbortSignal): Promise<string> {
  return resolveGoogleGroundingRedirectUrl(url, signal, {
    timeoutMs: GROUNDING_REDIRECT_RESOLUTION_TIMEOUT_MS,
  });
}

function buildGroundingSupportScores(grounding: any): Map<number, number> {
  const supports = Array.isArray(grounding?.groundingSupports) ? grounding.groundingSupports : [];
  const scores = new Map<number, number>();

  for (const support of supports) {
    const indices = Array.isArray(support?.groundingChunkIndices)
      ? support.groundingChunkIndices
      : [];
    const confidenceScores = Array.isArray(support?.confidenceScores)
      ? support.confidenceScores
      : [];

    indices.forEach((rawIndex: unknown, position: number) => {
      if (typeof rawIndex !== 'number' || !Number.isInteger(rawIndex) || rawIndex < 0) {
        return;
      }

      const index = rawIndex;
      const confidence =
        typeof confidenceScores[position] === 'number' &&
        Number.isFinite(confidenceScores[position])
          ? confidenceScores[position]
          : 1;
      scores.set(index, (scores.get(index) || 0) + confidence);
    });
  }

  return scores;
}

function rankGroundingChunksBySupport(chunks: GeminiGroundingChunk[]): GeminiGroundingChunk[] {
  if (chunks.length <= 1) {
    return chunks;
  }

  return chunks
    .map((chunk, index) => ({ chunk, index }))
    .sort((left, right) => {
      if (right.chunk.supportScore !== left.chunk.supportScore) {
        return right.chunk.supportScore - left.chunk.supportScore;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.chunk);
}

function extractCandidateGroundingChunks(candidate: any): GeminiGroundingChunk[] {
  const grounding = candidate?.groundingMetadata;
  const groundingChunks = Array.isArray(grounding?.groundingChunks)
    ? grounding.groundingChunks
    : [];
  const groundingSupportScores = buildGroundingSupportScores(grounding);

  return groundingChunks
    .map((chunk: any, index: number) => {
      const uri = normalizeSearchText(chunk?.web?.uri);
      if (!uri) {
        return undefined;
      }

      return {
        uri,
        title: normalizeSearchText(chunk?.web?.title),
        domain: normalizeSearchText(chunk?.web?.domain),
        supportScore: groundingSupportScores.get(index) || 0,
      };
    })
    .filter((chunk: GeminiGroundingChunk | undefined): chunk is GeminiGroundingChunk =>
      Boolean(chunk),
    );
}

export async function extractGeminiGroundingResult(params: {
  data: any;
  count: number;
  signal?: AbortSignal;
}): Promise<GeminiGroundingResult> {
  const candidates = Array.isArray(params.data?.candidates) ? params.data.candidates : [];
  const webChunks = candidates.flatMap((candidate: any) =>
    extractCandidateGroundingChunks(candidate),
  );

  const rawCandidateLimit = resolveGeminiRawCandidateLimit(params.count);
  const candidateChunks = rankGroundingChunksBySupport(webChunks).slice(
    0,
    Math.min(webChunks.length, rawCandidateLimit),
  );
  const resolvedGroundingCandidates = await Promise.all(
    candidateChunks.map(async (chunk) => {
      const resolvedUrl = await resolveGroundingChunkUrl(chunk.uri, params.signal);
      const url = normalizeSearchText(resolvedUrl);
      return {
        title: url ? deriveResultTitle(chunk.title, url, chunk.domain) : undefined,
        url,
        description: '',
      };
    }),
  );

  const results: Array<{ title: string; url: string; description: string }> = [];
  const seenUrls = new Set<string>();
  for (const candidateResult of resolvedGroundingCandidates) {
    if (!candidateResult.url || seenUrls.has(candidateResult.url) || !candidateResult.title) {
      continue;
    }

    seenUrls.add(candidateResult.url);
    results.push({
      title: candidateResult.title,
      url: candidateResult.url,
      description: candidateResult.description,
    });
  }

  const normalized = normalizeWebSearchResults({
    results,
  });

  return {
    results: normalized.results.slice(0, params.count),
  };
}
