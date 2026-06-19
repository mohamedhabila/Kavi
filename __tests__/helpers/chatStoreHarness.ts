// ---------------------------------------------------------------------------
// Tests — Chat Store
// ---------------------------------------------------------------------------

import { useChatStore } from '../../src/store/useChatStore';

// Reset store between tests
beforeEach(() => {
  useChatStore.setState({
    conversations: [],
    activeConversationId: null,
    isLoading: false,
  });
});

export { useChatStore };
