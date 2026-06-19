export type NormalizedMessage<TContent = unknown> = {
  role: string;
  content: TContent;
};

export type NormalizedHistory<TContent = unknown> = Array<NormalizedMessage<TContent>>;

export function pushNormalizedHistoryMessage<TMessage extends NormalizedMessage>(
  history: TMessage[],
  message: TMessage,
  options: {
    isEmptyContent: (content: TMessage['content']) => boolean;
    mergeContent: (
      existing: TMessage['content'],
      incoming: TMessage['content'],
      role: string,
    ) => TMessage['content'];
  },
): void {
  if (options.isEmptyContent(message.content)) {
    return;
  }

  const lastMessage = history[history.length - 1];
  if (lastMessage?.role === message.role) {
    lastMessage.content = options.mergeContent(lastMessage.content, message.content, message.role);
    return;
  }

  history.push(message);
}

export function filterNonEmptyHistory<TMessage extends NormalizedMessage>(
  history: TMessage[],
  isEmptyContent: (content: TMessage['content']) => boolean,
): TMessage[] {
  return history.filter((message) => !isEmptyContent(message.content));
}
