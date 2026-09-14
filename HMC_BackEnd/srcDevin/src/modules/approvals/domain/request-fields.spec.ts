import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { buildRequestFields, fieldKey, requestTypeKeyOf } from './request-fields';

/**
 * The display contract mobile depends on: stable keys, the app's own i18n keys,
 * ISO dates, no blank rows, and a shared leave view that narrows itself down to
 * the fields of the leave at hand.
 */
describe('buildRequestFields', () => {
  const SCHOOL_FEE_ROW = {
    REQUESTOR_USER_NAME: 'AIBRAHIM39',
    ACADEMIC_YEAR: '2025-2026',
    ACADEMIC_YEAR_START_DATE: new Date('2025-09-01T00:00:00.000Z'),
    CHILD_NAME: 'Jolie Amir Sami Samir Ibrahim||Female||23-SEP-10',
    AMOUNT: '900',
    SPOUSE_WORKING: 'No',
    COMMENTS: '   ',
    RECEIPT_NUMBER: '125',
  };

  it('emits ordered fields with the app i18n keys and typed values', () => {
    const { fields } = buildRequestFields(ORACLE_OBJECTS.PNDNG_SCHOO_FEE_V, SCHOOL_FEE_ROW);

    expect(fields.map((f) => f.key)).toEqual([
      'academicyear',
      'academicyearstartdate',
      'childname',
      'amount',
      'receiptnumber',
      'spouseworking',
    ]);
    expect(fields[0]).toEqual({
      key: 'academicyear',
      labelKey: 'SAcademicYear',
      label: 'Academic Year',
      value: '2025-2026',
      type: 'text',
    });
    // dates as ISO 8601, money as a number, Yes/No as boolean-typed text
    expect(fields[1]).toMatchObject({ value: '2025-09-01T00:00:00.000Z', type: 'date' });
    expect(fields[3]).toMatchObject({ value: 900, type: 'amount' });
    expect(fields[5]).toMatchObject({ value: 'No', type: 'boolean' });
  });

  it('converts Oracle text dates to ISO and keeps identifiers as strings', () => {
    const { fields, values } = buildRequestFields(ORACLE_OBJECTS.PNDNG_SCHOO_FEE_V, {
      // both are real column types of this view: a VARCHAR2 date and a NUMBER id
      CHILD_DATE_OF_BIRTH: '23-SEP-2010',
      RP_NUMBER: 31080804107,
    });

    expect(values.childdateofbirth).toBe('2010-09-23T00:00:00.000Z');
    expect(values.rpnumber).toBe('31080804107');
    expect(fields.find((f) => f.key === 'rpnumber')!.type).toBe('text');
  });

  it('handles the other VARCHAR2 date shapes these views use', () => {
    const { values } = buildRequestFields(ORACLE_OBJECTS.PNDNG_PASS_DTL_V, {
      DATE_OF_ISSUE: '2026/01/21 00:00:00',
      DATE_OF_EXPIRY: '2036/01/21',
    });

    expect(values.dateofissue).toBe('2026-01-21T00:00:00.000Z');
    expect(values.dateofexpiry).toBe('2036-01-21T00:00:00.000Z');
  });

  it('keeps an already-ISO string typed as a date', () => {
    const { fields } = buildRequestFields(ORACLE_OBJECTS.PNDNG_QID_V, {
      'Issue Date': '2025-10-17T00:00:00.000Z',
    });

    expect(fields[0]).toMatchObject({ value: '2025-10-17T00:00:00.000Z', type: 'date' });
  });

  it('never claims type=date for a value it could not parse', () => {
    // `01/01/2026` is day-first/month-first ambiguous, so it is left as text
    // rather than silently guessed into the wrong calendar day.
    const { fields, values } = buildRequestFields(ORACLE_OBJECTS.PNDNG_UPD_PERSON_V, {
      EFFECTIVE_DATE: '01/01/2026',
      DATE_OF_BIRTH: '1984/05/15',
    });

    expect(fields.find((f) => f.key === 'effectivedate')).toMatchObject({
      value: '01/01/2026',
      type: 'text',
    });
    expect(values.dateofbirth).toBe('1984-05-15T00:00:00.000Z');
    for (const f of fields) {
      if (f.type === 'date') expect(String(f.value)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('drops empty values from fields but keeps them null in values', () => {
    const { fields, values } = buildRequestFields(ORACLE_OBJECTS.PNDNG_SCHOO_FEE_V, SCHOOL_FEE_ROW);

    expect(fields.some((f) => f.key === 'comments')).toBe(false);
    expect(values.comments).toBeNull();
    expect(values.amount).toBe(900);
  });

  it('narrows the shared leave view to the fields of that leave type', () => {
    const casual = buildRequestFields(ORACLE_OBJECTS.PNDNG_LEAVE_V, {
      LEAVE_TYPE: 'Casual Leave',
      DATE_START: new Date('2026-04-19T00:00:00.000Z'),
      DATE_END: new Date('2026-04-19T00:00:00.000Z'),
      ABSENCE_DAYS: '1',
      MARRIAGE_DATE: null,
      HC_NUMBER: null,
    });

    expect(casual.fields.map((f) => f.key)).toEqual([
      'leavetype',
      'datestart',
      'dateend',
      'absencedays',
    ]);
    expect(casual.fields[3]).toMatchObject({ value: 1, type: 'number' });
  });

  it('keeps working for a view that has no catalog entry yet', () => {
    const { fields } = buildRequestFields('XXHMC_SND_PNDNG_BANK_V', {
      ITEM_KEY: '123',
      BANK_NAME: 'QNB',
      BANK_NAME_AR: 'بنك قطر الوطني',
      EFFECTIVE_DATE: new Date('2026-01-01T00:00:00.000Z'),
    });

    // plumbing and Arabic twins skipped, type inferred from the column name
    expect(fields.map((f) => f.key)).toEqual(['bankname', 'effectivedate']);
    expect(fields[1].type).toBe('date');
    expect(fields[0].labelKey).toBe('bankname');
  });

  it('returns nothing when the request has no detail row', () => {
    expect(buildRequestFields(ORACLE_OBJECTS.PNDNG_QID_V, undefined)).toEqual({
      fields: [],
      values: {},
    });
  });

  it('normalises the QID view columns that contain spaces', () => {
    const { fields, values } = buildRequestFields(ORACLE_OBJECTS.PNDNG_QID_V, {
      'QID Number': '28481809470',
      'Job as in QID': 'Analyst',
    });

    expect(fields.map((f) => f.key)).toEqual(['qidnumber', 'jobasinqid']);
    expect(fields[0].labelKey).toBe('QatarID');
    expect(values.qidnumber).toBe('28481809470');
  });

  it('maps each catalogued view to a stable request-type key', () => {
    expect(requestTypeKeyOf(ORACLE_OBJECTS.PNDNG_SCHOO_FEE_V)).toBe('SCHOOL_FEE');
    expect(requestTypeKeyOf('XXHMC_SND_SOMETHING_ELSE_V')).toBeNull();
    expect(fieldKey('ACADEMIC_YEAR_START_DATE')).toBe('academicyearstartdate');
  });
});
