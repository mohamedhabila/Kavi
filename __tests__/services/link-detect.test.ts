// ---------------------------------------------------------------------------
// Tests — Link Understanding: URL Detection
// ---------------------------------------------------------------------------

import { extractLinksFromMessage, DEFAULT_MAX_LINKS } from '../../src/services/links/detect';

// Mock the SSRF module to control URL validation
jest.mock('../../src/services/security/ssrf', () => ({
  isAllowedUrl: (url: string) => {
    // Block localhost/private IPs
    if (url.includes('localhost') || url.includes('127.0.0.1') || url.includes('10.0.0.')) {
      return false;
    }
    return true;
  },
}));

describe('extractLinksFromMessage', () => {
  describe('bare URLs', () => {
    it('extracts a single bare URL', () => {
      const result = extractLinksFromMessage('Check out https://example.com/page');
      expect(result).toHaveLength(1);
      expect(result[0].url).toBe('https://example.com/page');
      expect(result[0].source).toBe('bare');
    });

    it('extracts multiple bare URLs', () => {
      const result = extractLinksFromMessage(
        'Visit https://example.com and https://other.com/path',
      );
      expect(result).toHaveLength(2);
      expect(result[0].url).toBe('https://example.com');
      expect(result[1].url).toBe('https://other.com/path');
    });

    it('extracts http URLs', () => {
      const result = extractLinksFromMessage('See http://example.com');
      expect(result).toHaveLength(1);
      expect(result[0].url).toBe('http://example.com');
    });
  });

  describe('markdown links', () => {
    it('extracts markdown-style links', () => {
      const result = extractLinksFromMessage('Read [this article](https://example.com/article)');
      expect(result).toHaveLength(1);
      expect(result[0].url).toBe('https://example.com/article');
      expect(result[0].source).toBe('markdown');
    });

    it('does not double-extract markdown link URLs', () => {
      const result = extractLinksFromMessage('See [link](https://example.com) for details');
      expect(result).toHaveLength(1);
    });
  });

  describe('SSRF protection', () => {
    it('filters out localhost URLs', () => {
      const result = extractLinksFromMessage('Check http://localhost:3000/api');
      expect(result).toHaveLength(0);
    });

    it('filters out private IP URLs', () => {
      const result = extractLinksFromMessage('See http://127.0.0.1:8080');
      expect(result).toHaveLength(0);
    });

    it('filters out 10.x URLs', () => {
      const result = extractLinksFromMessage('Internal: http://10.0.0.1/admin');
      expect(result).toHaveLength(0);
    });
  });

  describe('deduplication', () => {
    it('deduplicates identical URLs', () => {
      const result = extractLinksFromMessage('https://example.com and again https://example.com');
      expect(result).toHaveLength(1);
    });

    it('deduplicates markdown and bare of same URL', () => {
      const result = extractLinksFromMessage('[link](https://example.com) and https://example.com');
      expect(result).toHaveLength(1);
    });
  });

  describe('maxLinks', () => {
    it('defaults to DEFAULT_MAX_LINKS', () => {
      expect(DEFAULT_MAX_LINKS).toBe(3);
    });

    it('respects maxLinks option', () => {
      const result = extractLinksFromMessage(
        'https://a.com https://b.com https://c.com https://d.com',
        { maxLinks: 2 },
      );
      expect(result).toHaveLength(2);
    });

    it('returns fewer when fewer links exist', () => {
      const result = extractLinksFromMessage('Only https://example.com', {
        maxLinks: 5,
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('URL cleaning', () => {
    it('strips trailing punctuation from URLs', () => {
      const result = extractLinksFromMessage('Visit https://example.com/page.');
      expect(result[0].url).toBe('https://example.com/page');
    });

    it('strips trailing comma', () => {
      const result = extractLinksFromMessage('See https://example.com, for details');
      expect(result[0].url).toBe('https://example.com');
    });

    it('strips trailing parenthesis', () => {
      const result = extractLinksFromMessage('(https://example.com/path)');
      expect(result[0].url).toBe('https://example.com/path');
    });
  });

  describe('edge cases', () => {
    it('returns empty array for text with no URLs', () => {
      const result = extractLinksFromMessage('No links here at all');
      expect(result).toHaveLength(0);
    });

    it('returns empty array for empty string', () => {
      const result = extractLinksFromMessage('');
      expect(result).toHaveLength(0);
    });

    it('handles mixed markdown and bare URLs', () => {
      const result = extractLinksFromMessage(
        'See [docs](https://docs.example.com) and also https://api.example.com/v2',
      );
      expect(result).toHaveLength(2);
      expect(result[0].source).toBe('markdown');
      expect(result[1].source).toBe('bare');
    });
  });
});
