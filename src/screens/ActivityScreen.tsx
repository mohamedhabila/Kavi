import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { AlarmClock, ListChecks, ShieldCheck } from 'lucide-react-native';
import {
  NavigationHubScreen,
  type NavigationHubSection,
} from '../components/navigation/NavigationHubScreen';
import { useTranslation } from '../i18n/useTranslation';
import { useApprovalStore } from '../services/remote/approvalStore';
import { useSchedulerStore } from '../services/scheduler/store';

export const ActivityScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const pendingApprovalCount = useApprovalStore(
    (state) =>
      Object.values(state.requests).filter((request) => request.status === 'pending').length,
  );
  const enabledAutomationCount = useSchedulerStore(
    (state) => state.jobs.filter((job) => job.enabled).length,
  );

  const sections: NavigationHubSection[] = [
    {
      id: 'attention',
      title: t('navigationHub.needsAttention'),
      items: [
        {
          id: 'pending-decisions',
          title: t('nav.pendingDecisions'),
          icon: ShieldCheck,
          badge: pendingApprovalCount > 0 ? String(pendingApprovalCount) : undefined,
          onPress: () => navigation.navigate('ApprovalHistory'),
        },
      ],
    },
    {
      id: 'organized',
      title: t('navigationHub.stayOrganized'),
      items: [
        {
          id: 'reminders-automations',
          title: t('nav.remindersAutomations'),
          icon: AlarmClock,
          badge: enabledAutomationCount > 0 ? String(enabledAutomationCount) : undefined,
          onPress: () => navigation.navigate('Scheduler'),
        },
        {
          id: 'work-activity',
          title: t('nav.workActivity'),
          icon: ListChecks,
          onPress: () => navigation.navigate('AgentRoster', { initialTab: 'queue' }),
        },
      ],
    },
  ];

  return (
    <NavigationHubScreen
      intro={t('navigationHub.activityIntro')}
      sections={sections}
      testID="activity-hub"
      title={t('nav.activity')}
    />
  );
};
