import { isLongTermMemoryEnabled } from '../../../src/services/memory/policy';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

describe('memory policy', () => {
  afterEach(() => {
    useSettingsStore.setState({ disableLongTermMemory: false });
  });

  it('is on unless the user turned long-term memory off', () => {
    useSettingsStore.setState({ disableLongTermMemory: false });
    expect(isLongTermMemoryEnabled()).toBe(true);

    useSettingsStore.setState({ disableLongTermMemory: true });
    expect(isLongTermMemoryEnabled()).toBe(false);
  });
});
