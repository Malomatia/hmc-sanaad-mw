import { localizeArTwins } from './localize.util';

describe('localizeArTwins', () => {
  const row = {
    PHONE_TYPE: 'Home',
    PHONE_TYPE_AR: 'المنزل',
    PHONE_NUMBER: '34098571',
  };

  it('keeps the English value and drops the twin for lang=en', () => {
    expect(localizeArTwins(row, 'en')).toEqual({
      PHONE_TYPE: 'Home',
      PHONE_NUMBER: '34098571',
    });
  });

  it('substitutes the Arabic value and drops the twin for lang=ar', () => {
    expect(localizeArTwins(row, 'ar')).toEqual({
      PHONE_TYPE: 'المنزل',
      PHONE_NUMBER: '34098571',
    });
  });

  it('handles camelCase (meaningAr) and suffix (VALUEAR) spellings', () => {
    expect(
      localizeArTwins({ meaning: 'No', meaningAr: 'لا', VALUE: 'Yes', VALUEAR: 'نعم' }, 'ar'),
    ).toEqual({ meaning: 'لا', VALUE: 'نعم' });
  });

  it('falls back to the English value when the Arabic twin is empty', () => {
    expect(localizeArTwins({ meaning: 'Haj Leave', meaningAr: '' }, 'ar')).toEqual({
      meaning: 'Haj Leave',
    });
    expect(localizeArTwins({ meaning: 'Haj Leave', meaningAr: null }, 'ar')).toEqual({
      meaning: 'Haj Leave',
    });
  });

  it('URL-decodes encoded Arabic values', () => {
    expect(localizeArTwins({ meaning: 'Yes', meaning_ar: '%D9%86%D8%B9%D9%85' }, 'ar')).toEqual({
      meaning: 'نعم',
    });
  });

  it('never collapses words that merely end in ar/AR', () => {
    const value = { YEAR: '2026', calendar: 'Gregorian', star: 'x' };
    expect(localizeArTwins(value, 'ar')).toEqual(value);
  });

  it('keeps BOTH addressType and addressTypeAr for every lang (preserved twin)', () => {
    const address = { addressType: 'Primary Home Country Address', addressTypeAr: 'عنوان قطر' };
    expect(localizeArTwins(address, 'en')).toEqual(address);
    expect(localizeArTwins(address, 'ar')).toEqual(address);
    const rawRow = { ADDRESS_TYPE: 'Qatar Address', ADDRESS_TYPE_AR: 'عنوان قطر' };
    expect(localizeArTwins(rawRow, 'ar')).toEqual(rawRow);
  });

  it('leaves Ar-suffixed keys without a base twin untouched', () => {
    expect(localizeArTwins({ FULL_NAME_AR: 'الاسم' }, 'ar')).toEqual({ FULL_NAME_AR: 'الاسم' });
  });

  it('recurses through nested arrays and objects', () => {
    const payload = {
      personal: { gender: 'Male', genderAr: 'ذكر' },
      phones: [{ phoneType: 'Home', phoneTypeAr: 'المنزل' }],
    };
    expect(localizeArTwins(payload, 'ar')).toEqual({
      personal: { gender: 'ذكر' },
      phones: [{ phoneType: 'المنزل' }],
    });
  });

  it('passes primitives and class instances through untouched', () => {
    const date = new Date('2026-01-01');
    expect(localizeArTwins({ when: date }, 'ar')).toEqual({ when: date });
    expect(localizeArTwins('plain', 'ar')).toBe('plain');
    expect(localizeArTwins(null, 'ar')).toBeNull();
  });
});
