import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ArtifactCard } from '../../src/components/artifacts/ArtifactCard';
import type { Attachment } from '../../src/types/attachment';
import { formatDocumentSizeLimitMB } from '../../src/services/llm/catalog/documentCapabilities';
import { i18n } from '../../src/i18n/manager';
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
      warning: '#f59e0b',
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

describe('ArtifactCard — document-input refusal notice', () => {
  beforeEach(async () => {
    await i18n.setLocale('en');
  });

  it('renders no notice when the attachment carries no refusal reason', () => {
    const { queryByTestId } = render(
      <ArtifactCard artifact={makeArtifact()} isUser={false} width={240} />,
    );

    expect(queryByTestId('artifact-document-refusal-artifact-1')).toBeNull();
  });

  it('explains that the current model cannot read documents, without naming any provider in code', () => {
    const { getByTestId, getByText } = render(
      <ArtifactCard
        artifact={makeArtifact({ documentInputRefusalReason: 'unsupported_provider' })}
        isUser={false}
        width={240}
      />,
    );

    expect(getByTestId('artifact-document-refusal-artifact-1')).toBeTruthy();
    expect(getByText(i18n.t('artifactCard.documentUnsupportedNotice'))).toBeTruthy();
  });

  it('includes the formatted byte ceiling for an oversized PDF', () => {
    const maxBytes = 32 * 1024 * 1024;
    const { getByTestId, getByText } = render(
      <ArtifactCard
        artifact={makeArtifact({
          size: 40 * 1024 * 1024,
          documentInputRefusalReason: 'exceeds_size_limit',
          documentInputRefusalMaxBytes: maxBytes,
        })}
        isUser={false}
        width={240}
      />,
    );

    expect(getByTestId('artifact-document-refusal-artifact-1')).toBeTruthy();
    expect(
      getByText(
        i18n.t('artifactCard.documentExceedsSizeLimitNotice', {
          limit: formatDocumentSizeLimitMB(maxBytes),
        }),
      ),
    ).toBeTruthy();
  });

  it('renders no notice for a malformed exceeds_size_limit record missing its byte ceiling', () => {
    const { queryByTestId } = render(
      <ArtifactCard
        artifact={makeArtifact({ documentInputRefusalReason: 'exceeds_size_limit' })}
        isUser={false}
        width={240}
      />,
    );

    expect(queryByTestId('artifact-document-refusal-artifact-1')).toBeNull();
  });

  it('marks the notice as a polite live region for screen readers', () => {
    const { getByTestId } = render(
      <ArtifactCard
        artifact={makeArtifact({ documentInputRefusalReason: 'unsupported_provider' })}
        isUser={false}
        width={240}
      />,
    );

    const notice = getByTestId('artifact-document-refusal-artifact-1');
    expect(notice.props.accessibilityLiveRegion).toBe('polite');
  });
});
