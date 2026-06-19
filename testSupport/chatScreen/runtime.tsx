import './themeMocks';
import './componentMocks';
import './storeMocks';
import './serviceMocks';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import { FlatList } from 'react-native';
import { ChatInput } from '../../src/components/chat/ChatInput';
import { ChatScreen } from '../../src/screens/ChatScreen';

const memoizedChatInputType = (ChatInput as any).type || ChatInput;

export { act, fireEvent, FlatList, render, waitFor, ChatScreen, memoizedChatInputType };
