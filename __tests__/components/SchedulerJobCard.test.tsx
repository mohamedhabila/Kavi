import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SchedulerJobCard } from '../../src/components/scheduler/SchedulerJobCard';
import { claimedSchedulerJob } from '../helpers/schedulerClaimedJobFixture';
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

const SCHEDULER_JOB_DETAIL_MAX_CHARS = 240;

describe('SchedulerJobCard — notification detail grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the ${SCHEDULER_JOB_DETAIL_MAX_CHARS}-char detail budget`, () => {
      const longError = buildBoundaryStraddlingText(SCHEDULER_JOB_DETAIL_MAX_CHARS, cluster, 40);
      const job = { ...claimedSchedulerJob('Nightly digest', 'Summarize inbox'), lastWakeError: longError };

      const { getByTestId, UNSAFE_getAllByType } = render(
        <SchedulerJobCard
          isSelected={false}
          job={job}
          onDelete={jest.fn()}
          onRun={jest.fn()}
          onToggle={jest.fn()}
          traces={[]}
        />,
      );

      expect(getByTestId(`scheduler-notification-issue-${job.id}`)).toBeTruthy();

      const renderedTexts = UNSAFE_getAllByType(Text)
        .map((element) => element.props.children)
        .filter((children): children is string => typeof children === 'string');
      const truncatedDetail = renderedTexts.find((text) => text.startsWith('a'));

      expect(truncatedDetail).toBeTruthy();
      expect(truncatedDetail!.length).toBeLessThan(longError.length);
      expectGraphemeSafe(truncatedDetail!);
      expect(
        endsOnGraphemeBoundary(longError, truncatedDetail!.slice(0, -'…'.length)),
      ).toBe(true);
    });
  }
});
