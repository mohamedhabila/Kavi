// ---------------------------------------------------------------------------
// Tests — AttachmentPreview Component
// ---------------------------------------------------------------------------

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { AttachmentPreview } from '../../src/components/chat/AttachmentPreview';
import { Attachment } from '../../src/types';

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      textSecondary: '#aaa',
      onPrimary: '#fff',
      danger: '#f00',
      surfaceAlt: '#222',
    },
  }),
  AppPalette: {},
}));

const makeImageAttachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: 'att1',
  type: 'image',
  uri: 'file://photo.jpg',
  name: 'photo.jpg',
  mimeType: 'image/jpeg',
  size: 1000,
  ...overrides,
});

const makeFileAttachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: 'att2',
  type: 'file',
  uri: 'file://doc.pdf',
  name: 'doc.pdf',
  mimeType: 'application/pdf',
  size: 5000,
  ...overrides,
});

const makeAudioAttachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: 'att3',
  type: 'audio',
  uri: 'file://voice-note.m4a',
  name: 'voice-note.m4a',
  mimeType: 'audio/mp4',
  size: 3200,
  durationMs: 6800,
  transcript: 'Ship the release notes update',
  ...overrides,
});

describe('AttachmentPreview', () => {
  it('should render image attachments with Image component', () => {
    const { UNSAFE_getByType } = render(
      <AttachmentPreview attachments={[makeImageAttachment()]} onRemove={jest.fn()} />,
    );
    const { Image } = require('react-native');
    expect(UNSAFE_getByType(Image)).toBeTruthy();
  });

  it('should render file attachments with name', () => {
    const { getByText } = render(
      <AttachmentPreview attachments={[makeFileAttachment()]} onRemove={jest.fn()} />,
    );
    expect(getByText('doc.pdf')).toBeTruthy();
  });

  it('should call onRemove when remove button is pressed', () => {
    const onRemove = jest.fn();
    const { getByTestId } = render(
      <AttachmentPreview attachments={[makeImageAttachment()]} onRemove={onRemove} />,
    );
    const removeIcon = getByTestId('icon-X');
    fireEvent.press(removeIcon.parent || removeIcon);
    expect(onRemove).toHaveBeenCalledWith('att1');
  });

  it('should render multiple attachments', () => {
    const { getByText, UNSAFE_getByType } = render(
      <AttachmentPreview
        attachments={[makeImageAttachment(), makeFileAttachment()]}
        onRemove={jest.fn()}
      />,
    );
    const { Image } = require('react-native');
    expect(UNSAFE_getByType(Image)).toBeTruthy();
    expect(getByText('doc.pdf')).toBeTruthy();
  });

  it('should show file icon for file attachments', () => {
    const { getByTestId } = render(
      <AttachmentPreview attachments={[makeFileAttachment()]} onRemove={jest.fn()} />,
    );
    expect(getByTestId('icon-FileText')).toBeTruthy();
  });

  it('should render audio attachments as voice notes', () => {
    const { getByText, getByTestId } = render(
      <AttachmentPreview attachments={[makeAudioAttachment()]} onRemove={jest.fn()} />,
    );

    expect(getByTestId('icon-Mic')).toBeTruthy();
    expect(getByText('voice-note.m4a')).toBeTruthy();
    expect(getByText('7s')).toBeTruthy();
  });
});
