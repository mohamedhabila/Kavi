import {
  getExecutionLaneToolCapability,
  isExecutionDefaultBlockedToolName,
  isExecutionAdvancingToolName,
} from '../../src/utils/executionLanePolicy';

describe('executionLanePolicy', () => {
  it('treats side-effecting coordination tools as execution-advancing mutations', () => {
    expect(getExecutionLaneToolCapability('sessions_spawn')).toBe('mutation');
    expect(isExecutionAdvancingToolName('sessions_spawn')).toBe(true);
  });

  it('keeps passive session inspection tools out of the execution-advancing lane', () => {
    expect(getExecutionLaneToolCapability('sessions_status')).toBe('meta');
    expect(isExecutionAdvancingToolName('sessions_status')).toBe(false);
    expect(getExecutionLaneToolCapability('sessions_yield')).toBe('meta');
    expect(isExecutionAdvancingToolName('sessions_yield')).toBe(false);
  });

  it('keeps async wait tools execution-advancing for active workflow monitoring', () => {
    expect(getExecutionLaneToolCapability('sessions_wait')).toBe('monitoring');
    expect(isExecutionAdvancingToolName('sessions_wait')).toBe(true);
  });

  it('treats computation as execution-advancing while keeping it explicit-only by default', () => {
    expect(getExecutionLaneToolCapability('python')).toBe('computation');
    expect(isExecutionAdvancingToolName('python')).toBe(true);
    expect(isExecutionDefaultBlockedToolName('python')).toBe(true);
  });
});
