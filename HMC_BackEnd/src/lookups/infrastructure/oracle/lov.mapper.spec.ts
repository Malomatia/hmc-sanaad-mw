import { localizeArTwins } from '@shared/utils/localize.util';
import { LovMapper } from './lov.mapper';

/**
 * The LOV endpoints returned the code as the label ({"code":"AD","meaning":"AD"},
 * {"code":"315540","meaning":"315540"}) because the mapper only probed
 * meaning-style column names and then fell back to the first non-null column.
 * These cases pin the column vocabularies the Sanaad mapping documents.
 */
describe('LovMapper', () => {
  const map = (row: Record<string, unknown>) => LovMapper.toItem(row, 'en');

  it('reads COUNTRY_LOV labels from VALUE, not from CODE', () => {
    expect(map({ CODE: 'AD', VALUE: 'Andorra' })).toMatchObject({
      code: 'AD',
      meaning: 'Andorra',
    });
  });

  it('reads value-set LOVs from FLEX_VALUE_MEANING and keys them by FLEX_VALUE', () => {
    expect(
      map({
        FLEX_VALUE_ID: '315540',
        FLEX_VALUE: 'Elementary',
        FLEX_VALUE_MEANING: 'Elementary',
      }),
    ).toMatchObject({ code: 'Elementary', meaning: 'Elementary' });
  });

  it('exposes the DEP_LOOKUP_LOV grouping type so the mixed rows can be told apart', () => {
    expect(map({ CODE: '01', DATA: 'Spouse', DATATYPE: 'CONTACT' })).toMatchObject({
      code: '01',
      meaning: 'Spouse',
      type: 'CONTACT',
    });
  });

  it.each([
    ['D_DATA_AR', 'الموظف'],
    ['d_data_ar', encodeURIComponent('الموظف')],
    ['D_Data_Ar', 'الموظف'],
  ])('reads dependent Arabic labels from %s without changing submit values', (column, label) => {
    const source = Object.freeze({
      D_DATA_TYPE: 'SPONSORSHIP',
      [column]: label,
      D_DATA: 'Employee',
    });
    const item = map(source);
    expect(item.meaningAr).toBe('الموظف');
    expect(localizeArTwins(item, 'ar')).toEqual({
      code: 'Employee', meaning: 'الموظف', used_value: 'Employee', type: 'SPONSORSHIP',
    });
    expect(localizeArTwins(item, 'en')).toEqual({
      code: 'Employee', meaning: 'Employee', used_value: 'Employee', type: 'SPONSORSHIP',
    });
    expect(item.meaning).toBe('Employee');
    expect(source[column]).toBe(label);
  });

  it.each([null, undefined, ''])('falls back to English for an empty D_DATA_AR=%s', (label) => {
    const item = map({ D_DATA: 'Employee', D_DATA_AR: label, D_DATA_TYPE: 'SPONSORSHIP' });
    expect(localizeArTwins(item, 'ar')).toEqual({
      code: 'Employee', meaning: 'Employee', used_value: 'Employee', type: 'SPONSORSHIP',
    });
  });

  it('keeps a dependent contact lookup code distinct from its localized label', () => {
    const item = map({ CODE: 'C', D_DATA: 'Child', D_DATA_AR: 'طفل', D_DATA_TYPE: 'CONTACT' });
    expect(localizeArTwins(item, 'ar')).toEqual({
      code: 'C', meaning: 'طفل', used_value: 'Child', type: 'CONTACT',
    });
  });

  it.each([
    ['FLEX_VALUE', 'FLEX_VALUE_AR', 'Active', 'نشط'],
    ['MARITAL_STATUS', 'MARITAL_STATUS_AR', 'Married', 'متزوج'],
    ['marital_status', 'Marital_Status_Ar', 'Single', 'أعزب'],
    ['TYPE_OF_PHONE', 'TYPE_OF_PHONE_AR', 'Mobile', 'جوال'],
    ['ACCRUAL_PLAN_NAME', 'ACCRUAL_PLAN_NAME_AR', 'Annual Leave', 'إجازة سنوية'],
    ['LEAVE_REASON', 'LEAVE_REASON_AR', 'Birth of child', 'ولادة طفل'],
    ['ANUAL_TKT_DEFAULT', 'ANUAL_TKT_DEFAULT_AR', 'Yes', 'نعم'],
    ['COUNTRY', 'COUNTRY_AR', 'Qatar', 'قطر'],
    ['DELIVERY_LOCATION', 'DELIVERY_LOCATION_AR', 'Office', 'المكتب'],
    ['REASON', 'REASON_AR', 'Annual renewal', 'تجديد سنوي'],
    ['D_DATA', 'D_DATA_AR', 'Child', 'طفل'],
    ['PLACE', 'PLACE_AR', 'Doha', 'الدوحة'],
    ['CUSTOM_LABEL', 'CUSTOM_LABEL_AR', 'Other', 'أخرى'],
  ])('derives the Arabic twin of %s without changing submit values', (field, arField, en, ar) => {
    const source = Object.freeze({ [arField]: encodeURIComponent(ar), [field]: en });
    const item = map(source);
    expect(item.meaningAr).toBe(ar);
    expect(localizeArTwins(item, 'ar')).toEqual({ code: en, meaning: ar, used_value: en });
    expect(localizeArTwins(item, 'en')).toEqual({ code: en, meaning: en, used_value: en });
    expect(item.meaning).toBe(en);
    expect(source[arField]).toBe(encodeURIComponent(ar));
  });

  it('prefers the selected label twin to an unrelated recognized Arabic field', () => {
    const item = map({
      MARITAL_STATUS: 'Married',
      MARITAL_STATUS_AR: 'متزوج',
      D_DATA_AR: 'قيمة أخرى',
    });
    expect(localizeArTwins(item, 'ar')).toEqual({
      code: 'Married', meaning: 'متزوج', used_value: 'Married',
    });
  });

  it.each(['FLEX_VALUE', 'MARITAL_STATUS'])('keeps English when %s_AR is empty', (field) => {
    for (const label of [null, undefined, '']) {
      const item = map({ [field]: 'English label', [`${field}_AR`]: label });
      expect(localizeArTwins(item, 'ar')).toEqual({
        code: 'English label', meaning: 'English label', used_value: 'English label',
      });
    }
  });

  it('does not use the Arabic code as the label when a separate meaning exists', () => {
    const item = map({
      FLEX_VALUE: 'A',
      FLEX_VALUE_AR: 'رمز',
      FLEX_VALUE_MEANING: 'Active',
      FLEX_VALUE_MEANING_AR: 'نشط',
    });
    expect(localizeArTwins(item, 'ar')).toEqual({ code: 'A', meaning: 'نشط', used_value: 'Active' });
  });

  it('decodes the URL-encoded Arabic label', () => {
    expect(map({ CODE: 'QA', VALUE: 'Qatar', VALUEAR: '%D9%82%D8%B7%D8%B1' }).meaningAr).toBe(
      'قطر',
    );
  });

  it('never labels a row with its surrogate id or the username scope', () => {
    expect(map({ ESTABLISHMENT_ID: '2', NAME: 'A J John Memorial High School', USERNAME: 'V-X' })).toMatchObject(
      { code: '2', meaning: 'A J John Memorial High School' },
    );
  });

  it('falls back to the only descriptive column of a single-column LOV', () => {
    expect(map({ ACADEMIC_YEAR: '2025-2026' })).toMatchObject({
      code: '2025-2026',
      meaning: '2025-2026',
    });
  });

  it('labels ABSENCE_REASON_V rows with the LEAVE_REASON, never the LEAVE_TYPE', () => {
    expect(
      map({
        LEAVE_TYPE: 'Compassionate Leave',
        LEAVE_REASON: 'Death of 2nd Degree Relative',
        LEAVE_TYPE_AR: '%D8%A5%D8%AC%D8%A7%D8%B2%D8%A9',
        LEAVE_REASON_AR: '%D8%A7%D9%84%D8%AF%D8%B1%D8%AC%D8%A9%20%D8%A7%D9%84%D8%AB%D8%A7%D9%86%D9%8A%D8%A9',
      }),
    ).toMatchObject({
      code: 'Death of 2nd Degree Relative',
      meaning: 'Death of 2nd Degree Relative',
      meaningAr: 'الدرجة الثانية',
      used_value: 'Death of 2nd Degree Relative',
    });
  });

  describe('school-fees academic-year rows', () => {
    it('maps the Oracle column spellings without depending on column order', () => {
      expect(
        LovMapper.toAcademicYearItem({
          ACD_STARD_DT: '01-SEP-2025',
          ACD_END_DT: '30-JUN-2026',
          ACAD_YEAR: '2025-2026',
          INTERNAL_COLUMN: 'not exposed',
        }),
      ).toEqual({
        code: '2025-2026',
        meaning: '2025-2026',
        used_value: '2025-2026',
        ACCAD_YEAR: '2025-2026',
        ACD_START_DT: '01-SEP-2025',
        ACD_END_DT: '30-JUN-2026',
      });
    });

    it('formats Oracle DATE values and resolves column names case-insensitively', () => {
      expect(
        LovMapper.toAcademicYearItem({
          acad_year: '2026-2027',
          acd_stard_dt: new Date(2026, 8, 1),
          Acd_End_Dt: new Date(2027, 5, 30),
        }),
      ).toMatchObject({
        ACCAD_YEAR: '2026-2027',
        ACD_START_DT: '01-SEP-2026',
        ACD_END_DT: '30-JUN-2027',
      });
    });

    it('also accepts the corrected year/start column spellings', () => {
      expect(
        LovMapper.toAcademicYearItem({
          ACCAD_YEAR: '2025-2026',
          ACD_START_DT: '01-SEP-2025',
          ACD_END_DT: '30-JUN-2026',
        }),
      ).toMatchObject({
        ACCAD_YEAR: '2025-2026',
        ACD_START_DT: '01-SEP-2025',
        ACD_END_DT: '30-JUN-2026',
      });
    });

    it('keeps null dates present without inventing dates from the year label', () => {
      expect(
        LovMapper.toAcademicYearItem({
          ACAD_YEAR: '2025-2026',
          ACD_STARD_DT: null,
          ACD_END_DT: null,
        }),
      ).toMatchObject({
        ACCAD_YEAR: '2025-2026',
        ACD_START_DT: null,
        ACD_END_DT: null,
      });
    });
  });

  it('always carries the English label in used_value', () => {
    expect(map({ CODE: 'QA', VALUE: 'Qatar', VALUEAR: '%D9%82%D8%B7%D8%B1' })).toMatchObject({
      meaning: 'Qatar',
      used_value: 'Qatar',
    });
  });
});
