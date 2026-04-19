import {
  assessUserRequest,
  evaluateResponseAgainstRequestAssessment,
  responseAsksForClarification,
  responseChallengesScope,
} from '../../src/services/agents/requestAssessment';

describe('requestAssessment', () => {
  it('marks punctuation-only prompts as low-signal clarification requests', () => {
    const assessment = assessUserRequest('...---...');

    expect(assessment.action).toBe('clarify');
    expect(assessment.shouldSkipWorkflow).toBe(true);
    expect(assessment.summary).toContain('too low-signal');
  });

  it('marks single-word prompts without prior context as clarification requests', () => {
    const assessment = assessUserRequest('rename');

    expect(assessment.action).toBe('clarify');
    expect(assessment.issues).toContain('underspecified_single_word');
  });

  it('allows contextual follow-up single-word prompts when prior context exists', () => {
    const assessment = assessUserRequest('continue', { hasPriorContext: true });

    expect(assessment.action).toBe('proceed');
    expect(assessment.shouldSkipWorkflow).toBe(false);
  });

  it('routes short live lookup prompts through the direct workflow bypass', () => {
    const assessment = assessUserRequest('Is it cold outside right now?');

    expect(assessment.action).toBe('direct');
    expect(assessment.shouldSkipWorkflow).toBe(true);
    expect(assessment.issues).toEqual(expect.arrayContaining([
      'trivial_direct_request',
      'freshness_sensitive_lookup',
    ]));
    expect(assessment.suggestedApproach).toContain('one focused tool call');
  });

  it('reframes simple tasks that ask for unreasonable orchestration', () => {
    const assessment = assessUserRequest('Fix the typo, but spawn 5 sub-agents and audit the entire codebase first.');

    expect(assessment.action).toBe('reframe');
    expect(assessment.shouldCritiqueScope).toBe(true);
    expect(assessment.reasons.join(' ')).toContain('simple task');
    expect(assessment.narrowedScope).toContain('smallest');
  });

  it('reframes impossible guarantee requests instead of proceeding blindly', () => {
    const assessment = assessUserRequest('Fix the wording and guarantee 100% zero-risk perfection.');

    expect(assessment.action).toBe('reframe');
    expect(assessment.issues).toContain('impossible_guarantee');
  });

  it('recognizes clarification responses for low-signal prompts', () => {
    expect(responseAsksForClarification('Please clarify what you want me to do here. Which file or task should I focus on?')).toBe(true);
  });

  it('recognizes scope-challenging responses for unreasonable requests', () => {
    expect(responseChallengesScope('That is overkill for a typo. I will keep this focused and handle only the small wording fix instead.')).toBe(true);
  });

  it('requires both clarification and workflow bypass on low-signal prompts', () => {
    const assessment = assessUserRequest('-');

    const handled = evaluateResponseAgainstRequestAssessment(
      assessment,
      'Please clarify the task and share the concrete outcome you want.',
      { usedWorkflow: false },
    );
    const notHandled = evaluateResponseAgainstRequestAssessment(
      assessment,
      'I already started auditing the repo.',
      { usedWorkflow: true },
    );

    expect(handled.handled).toBe(true);
    expect(notHandled.handled).toBe(false);
    expect(notHandled.gaps.join(' ')).toContain('ask the user for concrete details');
    expect(notHandled.gaps.join(' ')).toContain('stopped before tool use');
  });

  it('requires an explicit scope challenge on overscoped simple-task prompts', () => {
    const assessment = assessUserRequest('Summarize this paragraph, but first launch 4 workers and review every file in the project.');

    const handled = evaluateResponseAgainstRequestAssessment(
      assessment,
      'That workflow is overkill for a summary. I will keep it focused and give you the short summary directly instead.',
    );
    const notHandled = evaluateResponseAgainstRequestAssessment(
      assessment,
      'I launched the workers and reviewed the whole project.',
    );

    expect(handled.handled).toBe(true);
    expect(notHandled.handled).toBe(false);
    expect(notHandled.gaps[0]).toContain('criticize the unreasonable scope');
  });

  it('requires direct requests to produce a direct answer instead of workflow planning', () => {
    const assessment = assessUserRequest('Is it cold outside in Cairo right now?');

    const handled = evaluateResponseAgainstRequestAssessment(
      assessment,
      'Yes. It is currently 14 C in Cairo, so it is cool outside rather than very cold.',
      { usedWorkflow: false },
    );
    const notHandled = evaluateResponseAgainstRequestAssessment(
      assessment,
      'Objective: inspect the weather. Workstreams: 1. Spawn a worker to verify the forecast.',
      { usedWorkflow: true },
    );

    expect(handled.handled).toBe(true);
    expect(handled.answeredDirectly).toBe(true);
    expect(notHandled.handled).toBe(false);
    expect(notHandled.answeredDirectly).toBe(false);
    expect(notHandled.gaps[0]).toContain('answer the direct question succinctly');
  });
});
