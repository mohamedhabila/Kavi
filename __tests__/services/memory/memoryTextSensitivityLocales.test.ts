import {
  classifyMemoryFactSensitivity,
  classifyMemoryTextSensitivity,
} from '../../../src/services/memory/memorySensitivityPolicy';

const LOCALE_FIXTURES = [
  {
    locale: 'en',
    credential: 'My password is winter-sunrise-2026.',
    sensitive: 'My medical history was reviewed.',
    contact: 'My phone number changed.',
    financial: 'My bank account changed.',
    age: 'I am 42 years old.',
    fields: ['password', 'diagnosis', 'age'],
  },
  {
    locale: 'ar',
    credential: 'كلمة المرور الخاصة بي هي شروق-الشتاء-٢٠٢٦.',
    sensitive: 'تمت مراجعة التاريخ الطبي.',
    contact: 'تم تحديث رقم الهاتف.',
    financial: 'تم تحديث الحساب المصرفي.',
    age: 'عمري ٤٢ سنة.',
    fields: ['كلمة المرور', 'تشخيص', 'العمر'],
  },
  {
    locale: 'de',
    credential: 'Mein Passwort ist winter-sonnenaufgang-2026.',
    sensitive: 'Meine Krankengeschichte wurde besprochen.',
    contact: 'Meine Telefonnummer wurde geändert.',
    financial: 'Mein Bankkonto wurde geändert.',
    age: 'Ich bin 42 Jahre alt.',
    fields: ['passwort', 'diagnose', 'alter'],
  },
  {
    locale: 'es',
    credential: 'Mi contraseña es invierno-amanecer-2026.',
    sensitive: 'Se revisó mi historial médico.',
    contact: 'Cambió mi número de teléfono.',
    financial: 'Cambió mi cuenta bancaria.',
    age: 'Tengo 42 años.',
    fields: ['contraseña', 'diagnóstico', 'edad'],
  },
  {
    locale: 'fr',
    credential: 'Mon mot de passe est hiver-soleil-2026.',
    sensitive: 'Mes antécédents médicaux ont été examinés.',
    contact: 'Mon numéro de téléphone a changé.',
    financial: 'Mon compte bancaire a changé.',
    age: "J'ai 42 ans.",
    fields: ['mot de passe', 'diagnostic', 'âge'],
  },
  {
    locale: 'ja',
    credential: '私のパスワードは冬の日の出2026です。',
    sensitive: '医療履歴を確認しました。',
    contact: '携帯電話番号を変更しました。',
    financial: '銀行口座を変更しました。',
    age: '私は42歳です。',
    fields: ['パスワード', '診断', '年齢'],
  },
  {
    locale: 'pt-BR',
    credential: 'Minha senha é inverno-nascer-do-sol-2026.',
    sensitive: 'Meu histórico médico foi revisado.',
    contact: 'Meu número de telefone mudou.',
    financial: 'Minha conta bancária mudou.',
    age: 'Tenho 42 anos.',
    fields: ['senha', 'diagnóstico', 'idade'],
  },
  {
    locale: 'zh-CN',
    credential: '我的密码是冬日晨光2026。',
    sensitive: '已经查看了我的医疗记录。',
    contact: '我的电话号码变更了。',
    financial: '我的银行账户变更了。',
    age: '我今年42岁。',
    fields: ['密码', '诊断', '年龄'],
  },
  {
    locale: 'zh-TW',
    credential: '我的密碼是冬日晨光2026。',
    sensitive: '已經查看了我的醫療紀錄。',
    contact: '我的電話號碼變更了。',
    financial: '我的銀行帳戶變更了。',
    age: '我今年42歲。',
    fields: ['密碼', '診斷', '年齡'],
  },
] as const;

describe.each(LOCALE_FIXTURES)('$locale sensitivity semantics', (fixture) => {
  it('classifies disclosed credential prose as restricted', () => {
    expect(classifyMemoryTextSensitivity(fixture.credential)).toBe('restricted');
  });

  it('classifies medical prose as sensitive', () => {
    expect(classifyMemoryTextSensitivity(fixture.sensitive)).toBe('sensitive');
  });

  it('classifies contact prose as sensitive', () => {
    expect(classifyMemoryTextSensitivity(fixture.contact)).toBe('sensitive');
  });

  it('classifies financial prose as sensitive', () => {
    expect(classifyMemoryTextSensitivity(fixture.financial)).toBe('sensitive');
  });

  it('classifies natural age prose as personal', () => {
    expect(classifyMemoryTextSensitivity(fixture.age)).toBe('personal');
  });

  it('applies the same locale semantics to structured fact fields', () => {
    const [credential, sensitive, personal] = fixture.fields;
    const input = {
      subject: 'user',
      subjectType: 'self',
      objectText: 'value',
    } as const;
    expect(classifyMemoryFactSensitivity({ ...input, predicate: credential })).toBe('restricted');
    expect(classifyMemoryFactSensitivity({ ...input, predicate: sensitive })).toBe('sensitive');
    expect(classifyMemoryFactSensitivity({ ...input, predicate: personal })).toBe('personal');
  });
});

it.each([
  'The Secret Garden is on my reading list.',
  'Build the card UI component.',
  'Look up the museum address.',
  'Translate the token labels.',
  'Read the password reset documentation.',
  'I am 100% sure.',
  'I am 42 items short.',
  '秘密の花園を読みます。',
  '打开地址栏。',
])('keeps ordinary prose normal: %s', (text) => {
  expect(classifyMemoryTextSensitivity(text)).toBe('normal');
});

it('keeps ambiguous project field compounds normal while retaining exact field protection', () => {
  const project = { subject: 'museum', subjectType: 'project', objectText: 'component' } as const;
  expect(classifyMemoryFactSensitivity({ ...project, predicate: 'card_ui' })).toBe('normal');
  expect(classifyMemoryFactSensitivity({ ...project, predicate: 'museum_address' })).toBe('normal');
  expect(classifyMemoryFactSensitivity({ ...project, predicate: 'card' })).toBe('sensitive');
});

it.each([
  'salary_benchmark',
  'passport_authentication',
  'password_reset_documentation',
  'city_museum',
])('does not classify a field merely because it contains a sensitive token: %s', (predicate) => {
  expect(
    classifyMemoryFactSensitivity({
      subject: 'user',
      subjectType: 'self',
      predicate,
      objectText: 'enabled',
    }),
  ).toBe('normal');
});

it.each([
  ['preferred_pronouns', 'personal'],
  ['auth_refresh_token', 'restricted'],
  ['user_passport_number', 'sensitive'],
  ['用户护照号码', 'sensitive'],
] as const)('classifies exact or token-suffix structured fields: %s', (predicate, expected) => {
  expect(
    classifyMemoryFactSensitivity({
      subject: 'user',
      subjectType: 'self',
      predicate,
      objectText: 'value',
    }),
  ).toBe(expected);
});

it('keeps an ordinary project name out of semantic prose classification', () => {
  expect(
    classifyMemoryFactSensitivity({
      subject: 'Medicine Project',
      subjectType: 'project',
      predicate: 'status',
      objectText: 'ready',
    }),
  ).toBe('normal');
});

it('classifies attribute values as prose while retaining exact sensitive labels', () => {
  const fact = {
    subject: 'project',
    subjectType: 'project',
    predicate: 'status',
    objectText: 'ready',
  } as const;
  expect(
    classifyMemoryFactSensitivity({
      ...fact,
      attributes: { note: 'Read the password reset documentation.' },
    }),
  ).toBe('normal');
  expect(
    classifyMemoryFactSensitivity({
      ...fact,
      attributes: { label: 'API key' },
    }),
  ).toBe('restricted');
});

it('normalizes self identity before applying personal field semantics', () => {
  expect(
    classifyMemoryFactSensitivity({
      subject: 'USER',
      subjectType: 'SELF',
      predicate: 'preferred_pronouns',
      objectText: 'they/them',
    }),
  ).toBe('personal');
});
