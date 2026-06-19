import type { Skill } from '../../skills/types';
import { createApiTool } from '../shared/toolFactory';

export function createKnowledgeSkill(): Skill {
  return {
    id: 'knowledge',
    name: 'Knowledge',
    description: 'Wikipedia summaries and dictionary definitions',
    version: '2.0.0',
    tools: [
      createApiTool(
        'wikipedia_summary',
        'Get a Wikipedia summary for a topic',
        {
          topic: { type: 'string', description: 'Topic to look up' },
        },
        ['topic'],
        async (args) => {
          try {
            const res = await fetch(
              `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(args.topic)}`,
              { headers: { 'User-Agent': 'KaviMobile/1.0' } },
            );
            if (!res.ok) {
              return JSON.stringify({ error: `Wikipedia: ${res.status}` });
            }
            const data = await res.json();
            return JSON.stringify({
              title: data.title,
              extract: data.extract?.slice(0, 2000),
              thumbnail: data.thumbnail?.source,
              url: data.content_urls?.desktop?.page,
            });
          } catch (error: unknown) {
            return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
          }
        },
      ),
      createApiTool(
        'define_word',
        'Get dictionary definition of a word',
        {
          word: { type: 'string', description: 'Word to define' },
        },
        ['word'],
        async (args) => {
          try {
            const res = await fetch(
              `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(args.word)}`,
            );
            if (!res.ok) {
              return JSON.stringify({ error: `Dictionary: ${res.status}` });
            }
            const data = await res.json();
            if (!Array.isArray(data) || data.length === 0) {
              return JSON.stringify({ error: 'Word not found' });
            }
            const entry = data[0];
            return JSON.stringify({
              word: entry.word,
              phonetic: entry.phonetic,
              meanings: entry.meanings?.slice(0, 3).map((meaning: any) => ({
                partOfSpeech: meaning.partOfSpeech,
                definitions: meaning.definitions?.slice(0, 2).map((definition: any) => definition.definition),
              })),
            });
          } catch (error: unknown) {
            return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
          }
        },
      ),
    ],
  };
}
