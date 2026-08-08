import { TOOL_DEFINITIONS } from '../../../src/engine/tools/definitions';

// Traced on-device. The description told the supervisor to "usually omit" the tools
// field, and the default surface carries no code-execution tool and no tool_catalog for
// a worker. A worker asked to run a Monte Carlo simulation could therefore neither run
// python nor discover it, reported a "tool surface issue" it had no way to diagnose, and
// the run wrote invented figures into the deliverable instead. Granting python explicitly
// works: a delegated run with tools:["python"] executed it.
describe('sessions_spawn does not steer a worker into a surface that cannot do the job', () => {
  const description =
    TOOL_DEFINITIONS.find((tool) => tool?.name === 'sessions_spawn')?.description ?? '';

  it('is registered with a description', () => {
    expect(description.length).toBeGreaterThan(0);
  });

  it('no longer presents omitting tools as the norm', () => {
    expect(description).not.toContain('usually omit it');
  });

  it('says a granted allowlist comes with no discovery', () => {
    expect(description).toContain('no discovery');
    expect(description).toContain('name every tool its task requires');
  });

  it('warns that the default surface cannot execute code', () => {
    expect(description).toMatch(/no python or javascript/i);
  });
});
