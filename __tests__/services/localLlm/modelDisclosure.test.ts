import { buildLocalModelDisclosureSentence } from '../../../src/services/localLlm/modelDisclosure';
import { i18n } from '../../../src/i18n/manager';

const t = (key: string, params?: Record<string, string | number>) => i18n.t(key, params);

describe('buildLocalModelDisclosureSentence', () => {
  it('mentions the model cannot use tools or see images when neither is supported', () => {
    const sentence = buildLocalModelDisclosureSentence(
      {
        sizeBytes: 1_597_931_520,
        minDeviceMemoryGb: 6,
        supportsTools: false,
        supportsVision: false,
      },
      t,
    );

    expect(sentence).toContain(t('onboarding.localModelDisclosure.offline'));
    expect(sentence).toContain(t('onboarding.localModelDisclosure.capabilitiesNeither'));
    expect(sentence).toContain(t('onboarding.localModelDisclosure.simplerAnswers'));
  });

  it('mentions both tools and vision support when the tier supports both', () => {
    const sentence = buildLocalModelDisclosureSentence(
      {
        sizeBytes: 2_588_147_712,
        minDeviceMemoryGb: 8,
        supportsTools: true,
        supportsVision: true,
      },
      t,
    );

    expect(sentence).toContain(t('onboarding.localModelDisclosure.capabilitiesBoth'));
  });

  it('mentions tools-only support when vision is unavailable', () => {
    const sentence = buildLocalModelDisclosureSentence(
      { sizeBytes: 1, minDeviceMemoryGb: 4, supportsTools: true, supportsVision: false },
      t,
    );

    expect(sentence).toContain(t('onboarding.localModelDisclosure.capabilitiesToolsOnly'));
  });

  it('mentions vision-only support when tools are unavailable', () => {
    const sentence = buildLocalModelDisclosureSentence(
      { sizeBytes: 1, minDeviceMemoryGb: 4, supportsTools: false, supportsVision: true },
      t,
    );

    expect(sentence).toContain(t('onboarding.localModelDisclosure.capabilitiesVisionOnly'));
  });

  it('includes a size and memory sentence built from the structured fields, not the name', () => {
    const sentence = buildLocalModelDisclosureSentence(
      {
        sizeBytes: 1_000_000_000,
        sizeLabel: '1 GB',
        minDeviceMemoryGb: 6,
        supportsTools: false,
        supportsVision: false,
      },
      t,
    );

    expect(sentence).toContain(
      t('onboarding.localModelDisclosure.sizeAndMemory', { size: '1 GB', memory: 6 }),
    );
  });

  it('omits the memory sentence when minDeviceMemoryGb is not provided', () => {
    const sentence = buildLocalModelDisclosureSentence(
      { sizeBytes: 1_000_000_000, supportsTools: false, supportsVision: false },
      t,
    );

    expect(sentence).not.toContain('sizeAndMemory');
    expect(sentence).toContain(t('onboarding.localModelDisclosure.offline'));
  });
});
