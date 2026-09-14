import * as oracledb from 'oracledb';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { OracleContractCatalog } from '@core/database/oracle-contracts';
import { LettersOracleRepository } from './letters.oracle.repository';

/**
 * XXHMC_SND_HR_EMPLYMNT_LTR_PR, declaration supplied by the client on
 * 2026-09-14: 28 IN (p_country and the ten file/BLOB pairs DEFAULT NULL) and
 * 3 OUT. There is NO p_language — the legacy request template listed one.
 */
describe('LettersOracleRepository — confirmed HR_EMPLYMNT_LTR_PR contract', () => {
  const fields = {
    p_letter_language: 'English',
    p_letter_name: 'Bank letter with details with effective date',
    p_no_of_copies: '1',
    p_mobile_number: '55000000',
    p_letter_delivery_loc: 'Test location',
    p_purpose_comments: 'test',
  };

  function make() {
    const call = jest.fn().mockResolvedValue({ p_success_flag: 'S', p_error_msg: null, p_error_msg_ar: null });
    const repo = new LettersOracleRepository(
      { call } as unknown as OracleService,
      new OracleSchemaService(new OracleContractCatalog()),
    );
    return { repo, call };
  }

  it.each(['en', 'ar'] as const)('binds the exact 28 IN + 3 OUT parameters for lang=%s', async (lang) => {
    const { repo, call } = make();
    const result = await repo.submit({
      username: 'test.User',
      lang,
      fields: {
        ...fields,
        p_user_name: 'OTHER_USER',
        p_language: 'OTHER_LANGUAGE',
        p_file_name1: 'id.pdf',
        p_attachment1: Buffer.from('proof').toString('base64'),
      },
    });

    const [sql, binds] = call.mock.calls[0];
    const expected = [
      'p_user_name', 'p_letter_language', 'p_letter_name', 'p_country', 'p_no_of_copies',
      'p_mobile_number', 'p_letter_delivery_loc', 'p_purpose_comments',
      ...Array.from({ length: 10 }, (_, i) => [`p_file_name${i + 1}`, `p_attachment${i + 1}`]).flat(),
      'p_success_flag', 'p_error_msg', 'p_error_msg_ar',
    ];
    expect(sql).toContain('BEGIN XXHMC_SND_HR_EMPLYMNT_LTR_PR(');
    expect(Object.keys(binds).sort()).toEqual([...expected].sort());
    for (const name of expected) expect(sql).toContain(`${name} => :${name}`);
    expect(sql).not.toContain('p_language');
    expect(binds).toMatchObject({ ...fields, p_user_name: 'TEST.USER', p_country: null });
    expect(binds.p_attachment1).toEqual({ type: oracledb.DB_TYPE_BLOB, val: Buffer.from('proof') });
    for (let i = 2; i <= 10; i++) {
      expect(binds[`p_file_name${i}`]).toBeNull();
      expect(binds[`p_attachment${i}`]).toEqual({ type: oracledb.DB_TYPE_BLOB, val: null });
    }
    for (const name of ['p_success_flag', 'p_error_msg', 'p_error_msg_ar']) {
      expect(binds[name]).toMatchObject({ dir: oracledb.BIND_OUT, type: oracledb.STRING });
    }
    expect(result).toMatchObject({ status: 'success', successflag: 'S' });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('passes p_country through for the passage letter', async () => {
    const { repo, call } = make();
    await repo.submit({ username: 'TESTUSER', lang: 'en', fields: { ...fields, p_country: 'Saudi Arabia' } });
    expect(call.mock.calls[0][1].p_country).toBe('Saudi Arabia');
  });

  it('preserves a business rejection and propagates execution errors without retrying', async () => {
    const { repo, call } = make();
    call.mockResolvedValueOnce({ p_success_flag: 'N', p_error_msg: 'Validate Please enter the Country' });
    const rejected = await repo.submit({ username: 'TESTUSER', lang: 'en', fields });
    expect(rejected).toMatchObject({ status: 'error', successflag: 'N', errormessage: 'Validate Please enter the Country' });

    const error = new Error('Oracle execution failed');
    call.mockRejectedValueOnce(error);
    await expect(repo.submit({ username: 'TESTUSER', lang: 'en', fields })).rejects.toBe(error);
    expect(call).toHaveBeenCalledTimes(2);
  });
});
