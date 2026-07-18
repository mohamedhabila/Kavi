import {
  buildControllerObservation,
  buildExternalControllerSystemPrompt,
  deriveExternalControllerRecoverySignal,
  MOBILEWORLD_EXTERNAL_ACTION_CONTRACT,
} from '../../benchmarks/mobileworld/bridgeProtocol';

describe('MobileWorld external controller protocol', () => {
  it('defines one strict provider-enforced action response', () => {
    expect(MOBILEWORLD_EXTERNAL_ACTION_CONTRACT).toMatchObject({
      name: 'mobileworld_external_action',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['thought', 'action'],
      },
    });
    const actionSchema = MOBILEWORLD_EXTERNAL_ACTION_CONTRACT.schema.properties.action;
    const clickSchema = actionSchema.anyOf.find(
      (variant: { properties?: { action_type?: { enum?: string[] } } }) =>
        variant.properties?.action_type?.enum?.[0] === 'click',
    );
    expect(clickSchema).toMatchObject({
      properties: { coordinate: { items: { minimum: 0, maximum: 999 } } },
    });
    expect(actionSchema.anyOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: {
            action_type: { type: 'string', enum: ['input_text'] },
            text: expect.anything(),
          },
        }),
      ]),
    );
  });

  it('carries controller outcomes as data without treating pixel changes as success', () => {
    const content = buildControllerObservation({
      attempt: 1,
      height: 200,
      instruction: 'Change the value.',
      isRepair: false,
      recentActionOutcomes: [
        {
          proposed_action: { action_type: 'click', coordinate: [500, 500] },
          parsed_controller_action: { action_type: 'click', x: 50, y: 100 },
          observation: { exact_screen_match: false, semantic_effect: 'unverified' },
        },
      ],
      stepIndex: 2,
      width: 100,
    });
    const encoded = content.match(
      /<external_controller_observation>\n(.+)\n<\/external_controller_observation>/u,
    )?.[1];

    expect(JSON.parse(encoded ?? '')).toMatchObject({
      user_objective: 'Change the value.',
      recent_action_outcomes: [
        { observation: { exact_screen_match: false, semantic_effect: 'unverified' } },
      ],
    });
    expect(buildExternalControllerSystemPrompt()).toContain(
      'A returned action is not evidence of success',
    );
    expect(buildExternalControllerSystemPrompt()).toContain(
      'Track attempted interaction strategies',
    );
  });

  it('raises a typed recovery signal for a repeated nearby action strategy', () => {
    const outcomes = [500, 530, 555].map((x) => ({
      proposed_action: { action_type: 'click', coordinate: [x, 400] },
      observation: { semantic_effect: 'unverified' },
    }));

    expect(deriveExternalControllerRecoverySignal(outcomes)).toEqual({
      status: 'recovery_required',
      reason: 'repeated_action_strategy_without_verified_semantic_effect',
      consecutive_similar_actions: 3,
    });
    expect(
      deriveExternalControllerRecoverySignal([
        ...outcomes.slice(0, 2),
        {
          proposed_action: { action_type: 'click', coordinate: [900, 900] },
          observation: { semantic_effect: 'unverified' },
        },
      ]),
    ).toBeNull();
    expect(
      deriveExternalControllerRecoverySignal([
        ...outcomes.slice(0, 2),
        {
          proposed_action: { action_type: 'click', coordinate: [555, 400] },
          observation: { semantic_effect: 'verified' },
        },
      ]),
    ).toBeNull();
    expect(
      deriveExternalControllerRecoverySignal(
        Array.from({ length: 3 }, () => ({
          proposed_action: { action_type: 'scroll', direction: 'down' },
          observation: { semantic_effect: 'unverified' },
        })),
      ),
    ).toBeNull();
  });
});
