import { registerRootComponent } from 'expo';
import App from './App';
import { registerAndroidDurableRecoveryHeadlessTask } from './src/services/executionJournal/androidRecoveryHeadlessTask';

registerAndroidDurableRecoveryHeadlessTask();
registerRootComponent(App);
