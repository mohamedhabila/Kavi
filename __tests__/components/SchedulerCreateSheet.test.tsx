import { act, fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SchedulerCreateSheet } from '../../src/components/scheduler/SchedulerCreateSheet';
import {
  GRAPHEME_CLUSTER_FIXTURES,
  buildBoundaryStraddlingText,
  endsOnGraphemeBoundary,
  expectGraphemeSafe,
} from '../helpers/graphemeTestFixtures';

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#000',
      surface: '#111',
      surfaceAlt: '#222',
      header: '#111',
      border: '#333',
      subtleBorder: '#444',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      placeholder: '#555',
      primary: '#0f0',
      onPrimary: '#fff',
      primarySoft: '#030',
      danger: '#f00',
      dangerSoft: '#300',
      success: '#0f0',
      warning: '#ff0',
      warningBackground: '#332800',
      info: '#0af',
      overlay: 'rgba(0,0,0,0.5)',
      inputBackground: '#222',
      inputBorder: '#444',
    },
  }),
  AppPalette: {},
}));

const SCHEDULER_FORM_ERROR_MAX_CHARS = 300;

async function fillRequiredFields(getByTestId: ReturnType<typeof render>['getByTestId']) {
  fireEvent.changeText(getByTestId('scheduler-name-input'), 'Nightly digest');
  fireEvent.changeText(getByTestId('scheduler-prompt-input'), 'Summarize the inbox');
}

describe('SchedulerCreateSheet — create-failure message grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the ${SCHEDULER_FORM_ERROR_MAX_CHARS}-char form error budget`, async () => {
      const longMessage = buildBoundaryStraddlingText(SCHEDULER_FORM_ERROR_MAX_CHARS, cluster, 40);
      const onCreate = jest.fn().mockRejectedValue(new Error(longMessage));

      const { getByTestId, UNSAFE_getAllByType } = render(
        <SchedulerCreateSheet
          isPermissionWorking={false}
          onClose={jest.fn()}
          onCreate={onCreate}
          onPermissionAction={jest.fn()}
          permissionState={{ status: 'granted', canRequest: false }}
          visible
        />,
      );

      await fillRequiredFields(getByTestId);

      await act(async () => {
        fireEvent.press(getByTestId('scheduler-create-submit'));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(onCreate).toHaveBeenCalled();

      const renderedTexts = UNSAFE_getAllByType(Text)
        .map((element) => element.props.children)
        .filter((children): children is string => typeof children === 'string');
      const truncatedMessage = renderedTexts.find((text) => text.startsWith('a'));

      expect(truncatedMessage).toBeTruthy();
      expect(truncatedMessage!.length).toBeLessThan(longMessage.length);
      expectGraphemeSafe(truncatedMessage!);
      expect(
        endsOnGraphemeBoundary(longMessage, truncatedMessage!.slice(0, -'…'.length)),
      ).toBe(true);
    });
  }
});
