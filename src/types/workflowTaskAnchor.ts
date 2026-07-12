import type { Attachment } from './attachment';

export type WorkflowTaskAttachmentIdentity = Readonly<
  Pick<Attachment, 'id' | 'type' | 'name' | 'mimeType' | 'size'> & {
    workspacePath?: string;
  }
>;

export type WorkflowTaskAnchor = Readonly<{
  sourceMessageId: string;
  content: string;
  attachments: ReadonlyArray<WorkflowTaskAttachmentIdentity>;
}>;
