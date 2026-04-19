import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { PersonaSelector } from '../../src/components/chat/PersonaSelector';

const mockPersonaStoreState = {
  customPersonas: [],
  overrides: {},
};

const mockAvailablePersonas = [
  {
    id: 'default',
    name: 'Assistant',
    description: 'General-purpose helpful AI assistant',
    systemPrompt: 'default prompt',
  },
  {
    id: 'coder',
    name: 'Coder',
    description: 'Programming and software development expert',
    systemPrompt: 'coder prompt',
  },
];

jest.mock('../../src/services/agents/store', () => ({
  usePersonaConfigStore: (selector: (state: any) => any) => selector(mockPersonaStoreState),
}));

jest.mock('../../src/services/agents/registry', () => ({
  getAvailablePersonasForConfig: () => mockAvailablePersonas,
  getAvailablePersonas: () => mockAvailablePersonas,
}));

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      surfaceAlt: '#F5F7FA',
      textSecondary: '#64748B',
      overlay: 'rgba(15, 23, 42, 0.5)',
      surface: '#FFFFFF',
      text: '#0F172A',
      primarySoft: '#E2E8F0',
      primary: '#2563EB',
    },
  }),
  AppPalette: {},
}));

jest.mock('../../src/i18n', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (key === 'persona.title') return 'Select persona';
      if (key === 'persona.selectorLabel') return `Persona: ${params?.name || ''}`.trim();
      if (key === 'persona.selectPersona') return `Select persona ${params?.name || ''}`.trim();
      if (key === 'persona.closeSelector') return 'Close persona selector';
      if (key === 'common.close') return 'Close';
      return key;
    },
  }),
}));

describe('PersonaSelector', () => {
  it('renders the current persona and allows switching personas', () => {
    const onSelect = jest.fn();
    const { getByLabelText, getByText } = render(
      <PersonaSelector selectedPersonaId="default" onSelect={onSelect} />,
    );

    fireEvent.press(getByLabelText('Persona: Assistant'));

    expect(getByText('Select persona')).toBeTruthy();

    fireEvent.press(getByLabelText('Select persona Coder'));

    expect(onSelect).toHaveBeenCalledWith('coder');
  });
});
