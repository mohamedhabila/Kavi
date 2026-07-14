export interface ExactUserProposalSource {
  id: string;
  text: string;
}

export function currentUserSourceFromConsolidatorPrompt(prompt: string): ExactUserProposalSource {
  const match = prompt.match(/<message id="([^"]+)" role="user">\n([\s\S]*?)\n<\/message>/u);
  if (!match) throw new Error('current user source missing from prompt');
  return { id: match[1]!, text: match[2]! };
}

export function semanticFactProposalJson(
  source: ExactUserProposalSource,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    subject_ref: { kind: 'self' },
    predicate: 'remembered_value',
    value: source.text,
    scope: 'conversation',
    importance: 0.7,
    confidence: 0.9,
    source_message_id: source.id,
    operation: 'record',
    assertion_class: 'current_direct',
    evidence_quote: source.text,
    sensitivity: 'normal',
    ...overrides,
  };
}
