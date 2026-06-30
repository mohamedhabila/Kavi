import { compactJsonForStorage } from '../../../src/services/memory/structuredObservationCompaction';

describe('structured observation compaction boolean fields', () => {
  it('preserves state-bearing form fields when inventory storage is compacted', () => {
    const longValue = 'long field value '.repeat(30);
    const payload = {
      url: 'https://workflow.example.test/form',
      sourceRunId: 'run-form-state',
      stateIndex: '0',
      surfaceLabels: ['Account settings form'],
      fieldLabels: [
        'Title',
        'Owner',
        'Summary',
        'Description',
        'Routing note',
        'Active',
        'Work notes',
        'Priority',
      ],
      fields: [
        { order: 0, label: 'Title', role: 'textbox', controlName: 'Title', value: longValue },
        { order: 1, label: 'Owner', role: 'searchbox', controlName: 'Owner', value: longValue },
        { order: 2, label: 'Summary', role: 'textbox', controlName: 'Summary', value: longValue },
        {
          order: 3,
          label: 'Description',
          role: 'textbox',
          controlName: 'Description',
          value: longValue,
        },
        {
          order: 4,
          label: 'Routing note',
          role: 'textbox',
          controlName: 'Routing note',
          value: longValue,
        },
        { order: 5, label: 'Active', role: 'checkbox', controlName: 'Active', checked: 'true' },
        {
          order: 6,
          label: 'Work notes',
          role: 'checkbox',
          controlName: 'Work notes',
          checked: 'false',
        },
        {
          order: 7,
          label: 'Priority',
          role: 'combobox',
          controlName: 'Priority',
          options: ['Low', 'Normal', 'High'],
        },
      ],
      controlNames: ['Save', 'Cancel', 'Post'],
      nodeCount: 120,
      controlCount: 30,
    };

    const compact = JSON.parse(compactJsonForStorage(payload, 900));
    expect(compact.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Active', role: 'checkbox', checked: 'true' }),
        expect.objectContaining({ label: 'Work notes', role: 'checkbox', checked: 'false' }),
      ]),
    );
  });
});
