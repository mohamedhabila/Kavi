import type { Skill, SkillToolDefinition } from '../skills/types';
import type { ToolDefinition } from '../../types/tool';
import { createCommunicationSkill } from './communication/skill';
import { createFinanceSkill } from './finance/skill';
import { createGitHubSkill } from './github/skill';
import { createKnowledgeSkill } from './knowledge/skill';
import { createMediaSkill } from './media/skill';
import { createProductivitySkill } from './productivity/skill';
import { createWeatherSkill } from './weather/skill';

const CODE_OWNED_SERVICE_SKILL_IDS = new Set([
  'communication',
  'finance',
  'github',
  'knowledge',
  'media',
  'productivity',
  'weather',
]);
const issuedCodeOwnedSkills = new WeakSet<Skill>();

function defaultEffectFreeContract(skillId: string): NonNullable<ToolDefinition['contract']> {
  const readOnly = ['finance', 'knowledge', 'weather'].includes(skillId);
  return {
    category: skillId,
    capabilities: [readOnly ? 'read' : 'compute'],
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: readOnly ? ['inspect_resource', 'verify_evidence'] : ['verify_evidence'],
  };
}

function normalizeTool(skillId: string, tool: SkillToolDefinition): SkillToolDefinition {
  return {
    ...tool,
    contract: tool.contract ?? defaultEffectFreeContract(skillId),
  };
}

function createRawSkills(): Skill[] {
  return [
    createWeatherSkill(),
    createGitHubSkill(),
    createFinanceSkill(),
    createProductivitySkill(),
    createCommunicationSkill(),
    createMediaSkill(),
    createKnowledgeSkill(),
  ];
}

export function isCodeOwnedServiceSkillId(skillId: string): boolean {
  return CODE_OWNED_SERVICE_SKILL_IDS.has(skillId);
}

export function createCodeOwnedServiceSkills(): Skill[] {
  return createRawSkills().map((skill) => {
    const normalized = Object.freeze({
      ...skill,
      tools: Object.freeze(skill.tools.map((tool) => Object.freeze(normalizeTool(skill.id, tool)))),
    }) as Skill;
    issuedCodeOwnedSkills.add(normalized);
    return normalized;
  });
}

export function isIssuedCodeOwnedServiceSkill(skill: Skill): boolean {
  return issuedCodeOwnedSkills.has(skill) && Object.isFrozen(skill) && Object.isFrozen(skill.tools);
}

export function createCodeOwnedServiceToolDefinitions(): ToolDefinition[] {
  return createCodeOwnedServiceSkills().flatMap((skill) =>
    skill.tools.map((tool) => ({
      name: `skill__${skill.id}__${tool.name}`,
      description: `[${skill.name}] ${tool.description}`,
      input_schema: tool.input_schema,
      strict: tool.strict,
      contract: tool.contract,
    })),
  );
}

export const CODE_OWNED_EFFECT_FREE_SERVICE_TOOL_NAMES = Object.freeze(
  createCodeOwnedServiceToolDefinitions()
    .filter(
      (tool) => tool.contract?.sideEffects?.length === 1 && tool.contract.sideEffects[0] === 'none',
    )
    .map((tool) => tool.name),
);
