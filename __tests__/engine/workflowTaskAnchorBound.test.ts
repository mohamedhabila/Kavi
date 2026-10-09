import { estimateTokens } from '../../src/services/context/tokenCounter';
import {
  createWorkflowTaskAnchor,
  renderWorkflowTaskAnchorPromptSection,
} from '../../src/engine/graph/workflowTaskAnchor';
import { truncateSystemPromptPreservingSection } from '../../src/services/context/systemPromptTruncation';
import { MAX_SYSTEM_PROMPT_TOKENS } from '../../src/services/context/budgetManager';

function anchorJson(section: string): Record<string, unknown> {
  const start = section.indexOf('{');
  const end = section.lastIndexOf('}');
  return JSON.parse(section.slice(start, end + 1));
}

describe('workflow task anchor prompt bound', () => {
  it('renders a short request verbatim', () => {
    const anchor = createWorkflowTaskAnchor({
      id: 'u1',
      role: 'user',
      content: 'Write the release notes and send them to the team.',
      attachments: [],
    });

    const rendered = anchorJson(renderWorkflowTaskAnchorPromptSection(anchor));

    expect(rendered.content).toBe('Write the release notes and send them to the team.');
    expect(rendered).not.toHaveProperty('contentTruncated');
  });

  it('keeps the opening and closing of a long paste and fits the protected budget', () => {
    // Regression: a 36K-character first message became an untruncatable protected
    // section, failed the system-prompt budget, and failed the run and its recovery.
    const opening = 'Here is durable background for our ongoing thread.';
    const closing = 'Now summarise the three decisions above in one list.';
    const content = `${opening}\n${'Background detail sentence. '.repeat(1_400)}\n${closing}`;
    const anchor = createWorkflowTaskAnchor({ id: 'u2', role: 'user', content, attachments: [] });

    const section = renderWorkflowTaskAnchorPromptSection(anchor);
    const rendered = anchorJson(section);

    expect(content.length).toBeGreaterThan(36_000);
    expect(rendered.contentTruncated).toBe(true);
    expect(String(rendered.content).startsWith(opening)).toBe(true);
    expect(String(rendered.content).endsWith(closing)).toBe(true);
    expect(estimateTokens(section)).toBeLessThan(4_000);
    expect(() =>
      truncateSystemPromptPreservingSection(
        `Base instructions.\n\n${section}`,
        MAX_SYSTEM_PROMPT_TOKENS,
        section,
      ),
    ).not.toThrow();
  });

  it('bounds a long request in a dense script without splitting characters', () => {
    const content = '会議の議事録をまとめてください。'.repeat(1_500);
    const anchor = createWorkflowTaskAnchor({ id: 'u3', role: 'user', content, attachments: [] });

    const rendered = anchorJson(renderWorkflowTaskAnchorPromptSection(anchor));

    expect(rendered.contentTruncated).toBe(true);
    expect(estimateTokens(String(rendered.content))).toBeLessThanOrEqual(3_100);
    expect(String(rendered.content)).not.toMatch(/�/);
  });
});
