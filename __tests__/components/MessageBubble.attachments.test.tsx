import { render, fireEvent } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { Clipboard, MessageBubble, installMessageBubbleTestHarness, makeMessage } from '../helpers/messageBubbleHarness';

describe('MessageBubble attachments', () => {
  installMessageBubbleTestHarness();

  it('should hide duplicate plain transcript text when a user voice note attachment carries the same transcript', () => {
    const msg = makeMessage({
      role: 'user',
      content: 'Ship the mobile hotfix tonight',
      attachments: [
        {
          id: 'voice-1',
          type: 'audio',
          uri: 'file:///voice-note.m4a',
          name: 'voice-note.m4a',
          mimeType: 'audio/mp4',
          size: 4096,
          durationMs: 4200,
          transcript: 'Ship the mobile hotfix tonight',
          waveformLevels: [0.22, 0.48, 0.36],
        },
      ],
    });

    const { getAllByText, getByTestId } = render(<MessageBubble message={msg} />);

    expect(getByTestId('audio-attachment-card-voice-1')).toBeTruthy();
    expect(getAllByText('Ship the mobile hotfix tonight')).toHaveLength(1);
  });

  it('should hide internal media context from user messages with image attachments', () => {
    const onEdit = jest.fn();
    const msg = makeMessage({
      role: 'user',
      content:
        'What is in this image?\n\n<media_context>\n[Image Attachment #1]\nDescription:\nA long hidden description.\n</media_context>',
      attachments: [
        {
          id: 'user-image-1',
          type: 'image',
          uri: 'file:///mock/documents/workspace/conv-1/user-image-1.png',
          name: 'user-image-1.png',
          mimeType: 'image/png',
          size: 2048,
        },
      ],
    });

    const { getByText, queryByText, getByTestId } = render(
      <MessageBubble message={msg} onEdit={onEdit} />,
    );
    const attachmentStyle = StyleSheet.flatten(getByTestId('message-attachments').props.style);
    const expectedWidth = Math.max(160, Math.floor(Dimensions.get('window').width * 0.88) - 24);

    expect(getByText('What is in this image?')).toBeTruthy();
    expect(getByTestId('message-attachments')).toBeTruthy();
    expect(attachmentStyle.width).toBe(expectedWidth);
    expect(attachmentStyle.overflow).toBe('hidden');
    expect(queryByText(/A long hidden description\./)).toBeNull();

    fireEvent.press(getByTestId('icon-Copy').parent || getByTestId('icon-Copy'));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('What is in this image?');

    fireEvent.press(getByTestId('icon-Edit2').parent || getByTestId('icon-Edit2'));
    expect(onEdit).toHaveBeenCalledWith('msg1', 'What is in this image?');
  });

  it('should render assistant image attachments inline and open workspace-backed generated files', () => {
    const onViewFile = jest.fn();
    const onShareWorkspaceFile = jest.fn();
    const msg = makeMessage({
      role: 'assistant',
      content: 'Here is the generated image.',
      attachments: [
        {
          id: 'generated-image-tool-1',
          type: 'image',
          uri: 'file:///mock/documents/workspace/conv-1/generated-image-tool-1.png',
          name: 'generated-image-tool-1.png',
          mimeType: 'image/png',
          size: 4096,
          workspacePath: 'generated-image-tool-1.png',
        },
      ],
    });
    const { getByTestId, UNSAFE_getByType } = render(
      <MessageBubble
        message={msg}
        onViewFile={onViewFile}
        onShareWorkspaceFile={onShareWorkspaceFile}
      />,
    );
    const { Image } = require('react-native');
    const attachmentStyle = StyleSheet.flatten(getByTestId('message-attachments').props.style);
    const expectedWidth = Math.max(160, Math.floor(Dimensions.get('window').width * 0.96) - 24);

    expect(getByTestId('message-attachments')).toBeTruthy();
    expect(attachmentStyle.width).toBe(expectedWidth);
    expect(attachmentStyle.overflow).toBe('hidden');
    expect(getByTestId('message-attachment-generated-image-tool-1')).toBeTruthy();
    expect(getByTestId('message-attachment-generated-image-tool-1')).toBeTruthy();
    expect(UNSAFE_getByType(Image)).toBeTruthy();

    fireEvent.press(getByTestId('message-attachment-generated-image-tool-1'));
    expect(getByTestId('message-attachment-preview-modal')).toBeTruthy();
    expect(getByTestId('message-attachment-preview-image')).toBeTruthy();

    fireEvent.press(getByTestId('message-attachment-open-file-generated-image-tool-1'));
    expect(onViewFile).toHaveBeenCalledWith('generated-image-tool-1.png');

    fireEvent.press(getByTestId('message-attachment-share-file-generated-image-tool-1'));
    expect(onShareWorkspaceFile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'generated-image-tool-1',
        workspacePath: 'generated-image-tool-1.png',
      }),
    );
  });

  it('should render attachment-only assistant response segments', () => {
    const msg = makeMessage({ role: 'assistant', content: '' });

    const { getByTestId } = render(
      <MessageBubble
        message={msg}
        responseSegments={[
          {
            id: 'segment-image-only',
            messageId: 'assistant-image-only',
            content: '',
            timestamp: Date.now(),
            attachments: [
              {
                id: 'generated-image-tool-2',
                type: 'image',
                uri: 'file:///mock/documents/workspace/conv-1/generated-image-tool-2.png',
                name: 'generated-image-tool-2.png',
                mimeType: 'image/png',
                size: 2048,
                workspacePath: 'generated-image-tool-2.png',
              },
            ],
          },
        ]}
      />,
    );

    expect(getByTestId('message-attachments')).toBeTruthy();
    expect(getByTestId('message-attachment-generated-image-tool-2')).toBeTruthy();
  });

  it('should render worker attachments alongside the sub-agent activity card', () => {
    const onViewFile = jest.fn();
    const msg = makeMessage({
      role: 'assistant',
      content: 'Lifecycle text hidden by the card.',
      attachments: [
        {
          id: 'generated-image-worker-1',
          type: 'image',
          uri: 'file:///mock/documents/workspace/conv-1/generated-worker.png',
          name: 'generated-worker.png',
          mimeType: 'image/png',
          size: 2048,
          workspacePath: 'generated-worker.png',
        },
      ],
      subAgentEvent: {
        type: 'sub-agent',
        event: 'completed',
        snapshot: {
          sessionId: 'sub-worker-1',
          parentConversationId: 'conv-1',
          depth: 1,
          startedAt: Date.now() - 8_000,
          updatedAt: Date.now(),
          status: 'completed',
          sandboxPolicy: 'safe-only',
          output: 'Generated a worker image.',
        },
      },
    });

    const { getByTestId } = render(<MessageBubble message={msg} onViewFile={onViewFile} />);

    expect(getByTestId('sub-agent-card-depth-1')).toBeTruthy();
    expect(getByTestId('message-attachments')).toBeTruthy();
    fireEvent.press(getByTestId('message-attachment-open-file-generated-image-worker-1'));
    expect(onViewFile).toHaveBeenCalledWith('generated-worker.png');
  });
});
