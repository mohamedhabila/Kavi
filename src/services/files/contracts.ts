export interface FileEntry {
  name: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt?: string;
}

export interface FileReadResult {
  path: string;
  content: string;
  size: number;
}

export interface FileWriteResult {
  path: string;
  size: number;
}

export interface DirectoryListResult<TEntry extends FileEntry = FileEntry> {
  path: string;
  entries: TEntry[];
}

export interface UriFileReadResult extends FileReadResult {
  uri: string;
}

export interface UriFileWriteResult extends FileWriteResult {
  uri: string;
}

export interface ImportedAttachmentResult<TAttachment> {
  attachment: TAttachment;
  imported: boolean;
}
