// ---------------------------------------------------------------------------
// Kavi — Reading a setup guide's vendor pages at the moment it is asked for
// ---------------------------------------------------------------------------
// The guide's facts are the vendors' own pages as they are now, read through web_fetch
// (SSRF-checked, extracted to markdown, Firecrawl when the person has a key). Pages are read
// in parallel and the whole read is bounded, so a slow vendor never holds the turn: a page
// that is not read in time is reported as not read, and the guide still answers. Re-asking
// for the same guide (after "I've done it") is answered from web_fetch's own cache.

import { executeWebFetch } from '../../engine/tools/web-fetch';
import type { SetupPage } from './setupGuideTypes';

export const SETUP_RESEARCH_TIMEOUT_MS = 12_000;
const DEFAULT_PAGE_CHARS = 5_000;
export const MAX_SETUP_PAGES = 4;

export type SetupPageRead = Readonly<{
  url: string;
  about: string;
  title?: string;
  excerpt: string;
  /** The page goes on past the excerpt (web_fetch can read on from nextOffset). */
  truncated: boolean;
  charCount?: number;
  nextOffset?: number;
}>;

export type SetupResearch = Readonly<{
  fetchedAt: string;
  pages: ReadonlyArray<SetupPageRead>;
  failed: ReadonlyArray<Readonly<{ url: string; about: string; error: string }>>;
}>;

type FetchEntry = Record<string, unknown>;

function entryOf(content: string): FetchEntry | undefined {
  try {
    const parsed = JSON.parse(content) as { fetches?: unknown };
    const entry = Array.isArray(parsed.fetches) ? parsed.fetches[0] : undefined;
    return entry && typeof entry === 'object' ? (entry as FetchEntry) : undefined;
  } catch {
    return undefined;
  }
}

async function readPage(
  page: SetupPage,
  signal: AbortSignal,
): Promise<{ read: SetupPageRead } | { error: string }> {
  try {
    const outcome = await executeWebFetch(
      { urls: [page.url], maxChars: page.maxChars ?? DEFAULT_PAGE_CHARS },
      signal,
    );
    // A failed outcome still carries the entry and its error.
    const entry = entryOf(outcome.content);
    if (!entry) return { error: 'web_fetch returned no page.' };
    if (typeof entry.error === 'string') {
      return { error: signal.aborted ? 'The page did not load in time.' : entry.error };
    }
    const excerpt = typeof entry.content === 'string' ? entry.content.trim() : '';
    if (!excerpt) return { error: 'The page had no readable text.' };
    return {
      read: {
        url: typeof entry.url === 'string' ? entry.url : page.url,
        about: page.about,
        ...(typeof entry.title === 'string' && entry.title ? { title: entry.title } : {}),
        excerpt,
        truncated: entry.truncated === true,
        ...(typeof entry.charCount === 'number' ? { charCount: entry.charCount } : {}),
        ...(typeof entry.nextOffset === 'number' ? { nextOffset: entry.nextOffset } : {}),
      },
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Reads up to four of a guide's pages, in parallel, within twelve seconds. */
export async function readSetupPages(
  pages: ReadonlyArray<SetupPage>,
  now: () => Date = () => new Date(),
): Promise<SetupResearch> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SETUP_RESEARCH_TIMEOUT_MS);
  try {
    const wanted = pages.slice(0, MAX_SETUP_PAGES);
    // The race keeps the bound even if a fetch were to ignore the abort.
    const timedOut = new Promise<{ error: string }>((resolve) =>
      controller.signal.addEventListener('abort', () =>
        resolve({ error: 'The page did not load in time.' }),
      ),
    );
    const results = await Promise.all(
      wanted.map((page) => Promise.race([readPage(page, controller.signal), timedOut])),
    );
    const read: SetupPageRead[] = [];
    const failed: Array<{ url: string; about: string; error: string }> = [];
    results.forEach((result, index) => {
      const page = wanted[index]!;
      if ('read' in result) read.push(result.read);
      else failed.push({ url: page.url, about: page.about, error: result.error });
    });
    return { fetchedAt: now().toISOString(), pages: read, failed };
  } finally {
    clearTimeout(timer);
  }
}
