import { buildLoopDetectedUserMessage } from '../../src/engine/graph/loopTerminalMessage';
import { createGoal } from '../../src/engine/goals/types';

describe('buildLoopDetectedUserMessage', () => {
  it('explains the stop without internal vocabulary when no goals are open', () => {
    const message = buildLoopDetectedUserMessage([]);

    expect(message).toContain('repeating the same step without making progress');
    expect(message).toContain('Tell me how you would like to proceed');
    expect(message).not.toContain('Still unfinished');
  });

  it('names the blocking goals that were left unfinished', () => {
    const message = buildLoopDetectedUserMessage([
      createGoal({
        id: 'g1',
        title: 'Research Saturn moons',
        status: 'active',
        completionPolicy: 'blocking',
      }),
      createGoal({
        id: 'g2',
        title: 'Write the summary',
        status: 'blocked',
        completionPolicy: 'blocking',
      }),
    ]);

    expect(message).toContain('Still unfinished: Research Saturn moons; Write the summary.');
  });

  it('omits goals that are already resolved or not blocking', () => {
    const message = buildLoopDetectedUserMessage([
      createGoal({
        id: 'g1',
        title: 'Finished work',
        status: 'completed',
        completionPolicy: 'blocking',
      }),
      createGoal({
        id: 'g2',
        title: 'Background chore',
        status: 'active',
        completionPolicy: 'persistent',
      }),
    ]);

    expect(message).not.toContain('Still unfinished');
    expect(message).not.toContain('Finished work');
    expect(message).not.toContain('Background chore');
  });

  it('falls back to the plain message when every open goal has a blank title', () => {
    const message = buildLoopDetectedUserMessage([
      createGoal({ id: 'g1', title: '   ', status: 'active', completionPolicy: 'blocking' }),
    ]);

    expect(message).not.toContain('Still unfinished');
    expect(message).toContain('Tell me how you would like to proceed');
  });
});
