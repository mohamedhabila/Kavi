// Must be the very first import: installs the Intl.PluralRules/Intl.Locale
// polyfills Hermes is missing before anything else in the app (including
// i18n itself) can call into Intl. See src/i18n/intlPolyfills.ts.
import './src/i18n/intlPolyfills';
import { registerRootComponent } from 'expo';
import App from './App';
import { registerAndroidDurableCandidateHeadlessTask } from './src/services/executionJournal/androidDurableCandidateHeadlessTask';
import { registerAndroidDurableRecoveryHeadlessTask } from './src/services/executionJournal/androidRecoveryHeadlessTask';
import { registerAndroidLongHorizonKeepAliveTask } from './src/services/androidLongHorizonExecution';

registerAndroidDurableRecoveryHeadlessTask();
registerAndroidDurableCandidateHeadlessTask();
registerAndroidLongHorizonKeepAliveTask();
registerRootComponent(App);
