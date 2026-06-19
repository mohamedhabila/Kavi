import React, { createContext, useContext } from 'react';

type OnboardingWizardContextValue = Record<string, any>;

const OnboardingWizardContext = createContext<OnboardingWizardContextValue | null>(null);

export function OnboardingWizardProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: OnboardingWizardContextValue;
}) {
  return (
    <OnboardingWizardContext.Provider value={value}>{children}</OnboardingWizardContext.Provider>
  );
}

export function useOnboardingWizardContext<T extends OnboardingWizardContextValue = OnboardingWizardContextValue>() {
  const value = useContext(OnboardingWizardContext);
  if (!value) {
    throw new Error('Onboarding wizard context is missing.');
  }
  return value as T;
}
