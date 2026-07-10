import { registerRootComponent } from 'expo';
import App from './App';
import { registerAndroidDurableCandidateHeadlessTask } from './src/services/executionJournal/androidDurableCandidateHeadlessTask';
import { registerAndroidDurableRecoveryHeadlessTask } from './src/services/executionJournal/androidRecoveryHeadlessTask';

registerAndroidDurableRecoveryHeadlessTask();
registerAndroidDurableCandidateHeadlessTask();
registerRootComponent(App);
