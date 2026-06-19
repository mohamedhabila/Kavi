import { registerSkill } from '../skills/manager';
import { createCommunicationSkill } from './communication/skill';
import { createFinanceSkill } from './finance/skill';
import { createGitHubSkill } from './github/skill';
import { createKnowledgeSkill } from './knowledge/skill';
import { createMediaSkill } from './media/skill';
import { createProductivitySkill } from './productivity/skill';
import { createWeatherSkill } from './weather/skill';

export function registerBuiltInServiceSkills(): void {
  registerSkill(createWeatherSkill());
  registerSkill(createGitHubSkill());
  registerSkill(createFinanceSkill());
  registerSkill(createProductivitySkill());
  registerSkill(createCommunicationSkill());
  registerSkill(createMediaSkill());
  registerSkill(createKnowledgeSkill());
}
