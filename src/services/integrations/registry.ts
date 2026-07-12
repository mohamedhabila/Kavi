import { registerCodeOwnedSkill } from '../skills/manager';
import { createCodeOwnedServiceSkills } from './codeOwnedServiceTools';

export function registerBuiltInServiceSkills(): void {
  for (const skill of createCodeOwnedServiceSkills()) {
    registerCodeOwnedSkill(skill);
  }
}
