import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ArtifactCard } from '../../src/components/artifacts/ArtifactCard';
import type { Attachment } from '../../src/types/attachment';
import {
  GRAPHEME_CLUSTER_FIXTURES,
  buildBoundaryStraddlingText,
  endsOnGraphemeBoundary,
  expectGraphemeSafe,
} from '../helpers/graphemeTestFixtures';

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      subtleBorder: '#333',
      codeBackground: '#111',
      surfaceAlt: '#222',
      text: '#fff',
      textSecondary: '#aaa',
      primary: '#0f0',
      onPrimary: '#fff',
      border: '#444',
    },
  }),
  AppPalette: {},
}));

const ARTIFACT_NAME_MAX_CHARS = 160;

const makeArtifact = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: 'artifact-1',
  type: 'file',
  uri: 'file:///report.pdf',
  name: 'report.pdf',
  mimeType: 'application/pdf',
  size: 4096,
  ...overrides,
});

describe('ArtifactCard — name grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the ${ARTIFACT_NAME_MAX_CHARS}-char name budget`, () => {
      const longName = buildBoundaryStraddlingText(ARTIFACT_NAME_MAX_CHARS, cluster, 40);
      const { UNSAFE_getAllByType } = render(
        <ArtifactCard artifact={makeArtifact({ name: longName })} isUser={false} width={240} />,
      );

      const renderedTexts = UNSAFE_getAllByType(Text)
        .map((element) => element.props.children)
        .filter((children): children is string => typeof children === 'string');
      const truncatedName = renderedTexts.find((text) => text.startsWith('a'));

      expect(truncatedName).toBeTruthy();
      expect(truncatedName!.length).toBeLessThan(longName.length);
      expectGraphemeSafe(truncatedName!);
      expect(endsOnGraphemeBoundary(longName, truncatedName!)).toBe(true);
    });
  }

  it('keeps a short name unchanged', () => {
    const { getByText } = render(
      <ArtifactCard artifact={makeArtifact({ name: 'notes.txt' })} isUser={false} width={240} />,
    );

    expect(getByText('notes.txt')).toBeTruthy();
  });
});
