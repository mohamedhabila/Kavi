import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { MessageAttachments } from '../../src/components/chat/MessageAttachments';
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
      overlay: 'rgba(0,0,0,0.5)',
      surface: '#111',
      border: '#333',
      subtleBorder: '#444',
      surfaceAlt: '#222',
      codeBackground: '#000',
      text: '#fff',
      textSecondary: '#aaa',
      primary: '#0f0',
      onPrimary: '#fff',
    },
  }),
  AppPalette: {},
}));

const ATTACHMENT_NAME_MAX_CHARS = 160;

const makeImageAttachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: 'image-1',
  type: 'image',
  uri: 'file:///photo.png',
  name: 'photo.png',
  mimeType: 'image/png',
  size: 2048,
  ...overrides,
});

describe('MessageAttachments — preview name grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the ${ATTACHMENT_NAME_MAX_CHARS}-char preview name budget`, () => {
      const longName = buildBoundaryStraddlingText(ATTACHMENT_NAME_MAX_CHARS, cluster, 40);
      const attachment = makeImageAttachment({ name: longName });
      const { getByTestId, UNSAFE_getAllByType } = render(
        <MessageAttachments attachments={[attachment]} />,
      );

      fireEvent.press(getByTestId(`message-attachment-${attachment.id}`));

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

  it('keeps a short preview name unchanged', () => {
    const attachment = makeImageAttachment({ name: 'sunset.png' });
    const { getByTestId, getAllByText } = render(<MessageAttachments attachments={[attachment]} />);

    fireEvent.press(getByTestId(`message-attachment-${attachment.id}`));

    expect(getAllByText('sunset.png').length).toBeGreaterThan(0);
  });
});
