import type { Skill } from '../../skills/types';

export function createCommunicationSkill(): Skill {
  return {
    id: 'communication',
    name: 'Communication',
    description: 'Communication helpers.',
    version: '2.0.0',
    tools: [],
  };
}
