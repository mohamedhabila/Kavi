import { fireEvent, render } from '@testing-library/react-native';

import { CapabilityGate, type CapabilityGateState } from '../../src/components/CapabilityGate';

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      danger: '#f00',
      dangerSoft: '#300',
      primary: '#0f0',
      primarySoft: '#030',
      success: '#0d0',
      surface: '#111',
      surfaceAlt: '#222',
      text: '#fff',
      textSecondary: '#aaa',
      warning: '#ff0',
      warningBackground: '#330',
    },
  }),
}));

describe('CapabilityGate', () => {
  it.each<CapabilityGateState>([
    'unavailable',
    'setup-needed',
    'loading',
    'ready',
    'active',
    'error',
  ])('renders the %s state with live status copy', (state) => {
    const { getByTestId, getByText } = render(
      <CapabilityGate
        description={`${state} description`}
        state={state}
        title={`${state} title`}
      />,
    );

    expect(getByTestId('capability-gate').props.accessibilityLiveRegion).toBe('polite');
    expect(getByText(`${state} title`)).toBeTruthy();
    expect(getByText(`${state} description`)).toBeTruthy();
  });

  it('provides a full-size recovery action when one is supplied', () => {
    const onAction = jest.fn();
    const { getByTestId, getByText } = render(
      <CapabilityGate
        actionLabel="Set up"
        description="Connect this capability"
        onAction={onAction}
        state="setup-needed"
        title="Setup needed"
      />,
    );

    fireEvent.press(getByText('Set up'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(getByTestId('capability-gate-action').props.style).toEqual(
      expect.objectContaining({ minHeight: 44 }),
    );
  });
});
