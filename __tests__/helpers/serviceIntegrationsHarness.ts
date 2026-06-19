jest.mock('../../src/services/storage/SecureStorage', () => ({
  getSecure: jest.fn(),
}));

jest.mock('../../src/services/skills/manager', () => ({
  registerSkill: jest.fn(),
}));

export const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

import { getSecure } from '../../src/services/storage/SecureStorage';
import { registerSkill } from '../../src/services/skills/manager';
import { createFinanceSkill } from '../../src/services/integrations/finance/skill';
import { createGitHubSkill } from '../../src/services/integrations/github/skill';
import { createKnowledgeSkill } from '../../src/services/integrations/knowledge/skill';
import { registerBuiltInServiceSkills } from '../../src/services/integrations/registry';
import { createWeatherSkill } from '../../src/services/integrations/weather/skill';

const { File, Directory, Paths, __resetStore } = require('expo-file-system');

export const mockGetSecure = getSecure as jest.Mock;

export function installServiceIntegrationsReset(): void {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    __resetStore();
  });
}

export {
  createFinanceSkill,
  createGitHubSkill,
  createKnowledgeSkill,
  createWeatherSkill,
  Directory,
  File,
  Paths,
  registerBuiltInServiceSkills,
  registerSkill,
};
