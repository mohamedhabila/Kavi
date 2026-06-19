export interface IntegrationScenarioFixture {
  name: string;
  prompt: string;
  expectedToolNames: string[];
}

export const integrationScenarioFixtures: IntegrationScenarioFixture[] = [];
