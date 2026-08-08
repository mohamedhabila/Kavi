import {
  groupAssistantToolCalls,
  readFetchCallUrl,
  readUrlHost,
  summarizeFetchBatch,
} from '../../src/components/chat/fetchBatchGrouping';
import type { ToolCall } from '../../src/types/message';

// Traced on-device: a twelve-source research request filled the transcript with near
// identical "Fetching a page" rows, several of them dead URLs, and the one thing a reader
// wants — which pages, and how far along — was the one thing not shown.

const call = (
  id: string,
  name: string,
  args: string,
  status: ToolCall['status'] = 'completed',
): ToolCall => ({ id, name, arguments: args, status });

const fetchCall = (id: string, url: string, status: ToolCall['status'] = 'completed') =>
  call(id, 'web_fetch', JSON.stringify({ urls: [url] }), status);

describe('consecutive page fetches collapse into one item', () => {
  it('groups a run of fetches', () => {
    const groups = groupAssistantToolCalls([
      fetchCall('1', 'https://www.iea.org/reports/lithium'),
      fetchCall('2', 'https://en.wikipedia.org/wiki/Lithium'),
      fetchCall('3', 'https://www.usgs.gov/lithium'),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.kind).toBe('fetch_batch');
  });

  it('never swallows the work that followed the batch', () => {
    const groups = groupAssistantToolCalls([
      fetchCall('1', 'https://a.example/x'),
      fetchCall('2', 'https://b.example/y'),
      call('3', 'write_file', '{}'),
      fetchCall('4', 'https://c.example/z'),
      fetchCall('5', 'https://d.example/w'),
    ]);

    expect(groups.map((g) => g.kind)).toEqual(['fetch_batch', 'single', 'fetch_batch']);
  });

  it('leaves a lone fetch as an ordinary row', () => {
    const groups = groupAssistantToolCalls([fetchCall('1', 'https://a.example/x')]);

    expect(groups).toEqual([{ kind: 'single', toolCall: expect.objectContaining({ id: '1' }) }]);
  });

  it('handles no tool calls', () => {
    expect(groupAssistantToolCalls(undefined)).toEqual([]);
    expect(groupAssistantToolCalls([])).toEqual([]);
  });
});

describe('what the collapsed row shows', () => {
  it('reads the host for a compact label', () => {
    expect(readUrlHost('https://www.iea.org/reports/x?a=1')).toBe('iea.org');
    expect(readUrlHost('http://EN.Wikipedia.org/wiki/Y')).toBe('en.wikipedia.org');
    expect(readUrlHost('not a url')).toBeUndefined();
    expect(readUrlHost(undefined)).toBeUndefined();
  });

  it('reads the url from either argument shape', () => {
    expect(readFetchCallUrl(fetchCall('1', 'https://a.example/x'))).toBe('https://a.example/x');
    expect(
      readFetchCallUrl(call('2', 'web_fetch', JSON.stringify({ url: 'https://b.example/y' }))),
    ).toBe('https://b.example/y');
  });

  it('survives arguments that are not valid json', () => {
    expect(readFetchCallUrl(call('3', 'web_fetch', '{oops'))).toBeUndefined();
  });

  it('reports progress while the batch is still running', () => {
    const groups = groupAssistantToolCalls([
      fetchCall('1', 'https://a.example/x', 'completed'),
      fetchCall('2', 'https://b.example/y', 'running'),
      fetchCall('3', 'https://c.example/z', 'failed'),
    ]);
    const batch = groups[0]!;
    if (batch.kind !== 'fetch_batch') throw new Error('expected a batch');

    expect(summarizeFetchBatch(batch.targets)).toEqual({
      total: 3,
      settled: 2,
      failed: 1,
      active: true,
    });
  });

  it('reports a finished batch as inactive', () => {
    const groups = groupAssistantToolCalls([
      fetchCall('1', 'https://a.example/x'),
      fetchCall('2', 'https://b.example/y'),
    ]);
    const batch = groups[0]!;
    if (batch.kind !== 'fetch_batch') throw new Error('expected a batch');

    expect(summarizeFetchBatch(batch.targets).active).toBe(false);
  });
});
