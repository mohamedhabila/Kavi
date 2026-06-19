export const CONTACT_CHANNEL_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'Label such as mobile, work, or home' },
    value: { type: 'string', description: 'Channel value' },
  },
  required: ['value'],
};

export const CONTACT_MUTATION_PROPERTIES = {
  firstName: { type: 'string', description: 'Contact first name' },
  middleName: { type: 'string', description: 'Contact middle name' },
  lastName: { type: 'string', description: 'Contact last name' },
  company: { type: 'string', description: 'Company or organization name' },
  jobTitle: { type: 'string', description: 'Job title' },
  note: { type: 'string', description: 'Optional note' },
  emails: {
    type: 'array',
    description: 'Optional email addresses to prefill',
    items: CONTACT_CHANNEL_SCHEMA,
  },
  phoneNumbers: {
    type: 'array',
    description: 'Optional phone numbers to prefill',
    items: CONTACT_CHANNEL_SCHEMA,
  },
};
