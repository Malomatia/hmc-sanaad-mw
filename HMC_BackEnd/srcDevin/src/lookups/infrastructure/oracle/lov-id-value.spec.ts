import { LovMapper } from './lov.mapper';

/**
 * RET_FRM_LEAV_PR runs TO_NUMBER on p_leave_details, so op 56 needs the leave's
 * ABSENCE_ATTENDANCE_ID — every text form answers ORA-01722. The op 55 LOV
 * exposed only the display string, which left the id unreachable and the
 * endpoint uncallable.
 *
 * The id is published as its own `id` field rather than by changing
 * `used_value`: clients already read `used_value` on every LOV, and moving it
 * under them to fix one endpoint would be a silent breaking change. These
 * cases pin both halves — the id is there, and nothing else moved.
 */
describe('LOV rows that carry a record id', () => {
  const RFL_ROW = {
    USER_NAME: 'AIBRAHIM39',
    LEAVE: 'Casual Leave|Leave Start Date : 19-APR-2026 and Leave End Date : 19-APR-2026',
    ABSENCE_ATTENDANCE_ID: 56949953,
  };

  it('publishes the id op 56 has to bind', () => {
    expect(LovMapper.toItem(RFL_ROW, 'en').id).toBe('56949953');
  });

  it('leaves the fields clients already read untouched', () => {
    const item = LovMapper.toItem(RFL_ROW, 'en');

    expect(item.used_value).toBe(RFL_ROW.LEAVE);
    expect(item.code).toBe(RFL_ROW.LEAVE);
    expect(item.meaning).toBe(RFL_ROW.LEAVE);
  });

  it('adds nothing to a LOV that has no record id', () => {
    const item = LovMapper.toItem({ CODE: 'M', MEANING: 'Qatar Mobile Number' }, 'en');

    expect(item).not.toHaveProperty('id');
    expect(item.used_value).toBe('Qatar Mobile Number');
    expect(item.code).toBe('M');
  });

  it('does not mistake a value-set id for a record id', () => {
    // FLEX_VALUE_ID is a documented CODE column, not a submit id
    const item = LovMapper.toItem(
      { FLEX_VALUE_ID: '315540', FLEX_VALUE_MEANING: 'Primary' },
      'en',
    );

    expect(item).not.toHaveProperty('id');
    expect(item.used_value).toBe('Primary');
  });
});

/**
 * op 17 looks a letter up by name AND language, and each letter exists in
 * exactly one of them, so a mismatched pair raises ORA-01403 (a bare 404 until
 * yesterday). LETTER_NAME_LOV holds that pairing in DESCRIPTION — which the
 * mapper dropped, leaving clients to discover the combinations by trial.
 */
describe('LOV rows whose DESCRIPTION is data, not a label', () => {
  it('publishes the language a letter must be requested in', () => {
    const english = LovMapper.toItem(
      {
        FLEX_VALUE_MEANING: 'Bank letter with details with effective date',
        DESCRIPTION: 'English',
      },
      'en',
    );
    const arabic = LovMapper.toItem(
      { FLEX_VALUE_MEANING: 'Basic Salary Certificate', DESCRIPTION: 'Arabic' },
      'en',
    );

    expect(english.description).toBe('English');
    expect(arabic.description).toBe('Arabic');
    // the label is untouched — this is additive
    expect(english.used_value).toBe('Bank letter with details with effective date');
  });

  it('omits it when DESCRIPTION is simply the label', () => {
    const item = LovMapper.toItem({ CODE: 'QA', DESCRIPTION: 'Qatar' }, 'en');

    expect(item.meaning).toBe('Qatar');
    expect(item).not.toHaveProperty('description');
  });
});
