import { registerRootComponent } from 'expo';
import App from './App';
import { registerAndroidDurableCandidateHeadlessTask } from './src/services/executionJournal/androidDurableCandidateHeadlessTask';
import { registerAndroidDurableRecoveryHeadlessTask } from './src/services/executionJournal/androidRecoveryHeadlessTask';
import { registerAndroidLongHorizonKeepAliveTask } from './src/services/androidLongHorizonExecution';

registerAndroidDurableRecoveryHeadlessTask();
registerAndroidDurableCandidateHeadlessTask();
registerAndroidLongHorizonKeepAliveTask();
registerRootComponent(App);
