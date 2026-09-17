import * as oracledb from 'oracledb';
import { ValidationPipe } from '@nestjs/common';
import { LookupsService } from '@lookups/application/lookups.service';
import { DependentService } from '@modules/dependents/application/dependents.service';
import { AddDependentRequestDto, PassportApplyRequestDto } from '@modules/dependents/interface/dto/dependents.dto';
import { UpdatePersonalRequestDto } from '@modules/profile/interface/dto/update-personal.request.dto';
import { OracleService } from './oracle.service';
import { OracleSchemaService } from './oracle-schema.service';
import { OracleContractCatalog } from './oracle-contracts';
import { AddressOracleRepository, PhoneOracleRepository } from '@modules/contact/infrastructure/oracle/contact.oracle.repository';
import { DependentOracleRepository, PassportOracleRepository } from '@modules/dependents/infrastructure/oracle/dependents.oracle.repository';
import { TicketOracleRepository } from '@modules/annual-ticket/infrastructure/oracle/annual-ticket.oracle.repository';
import { ProfileOracleRepository } from '@modules/profile/infrastructure/oracle/profile.oracle.repository';
import { ApprovalsOracleRepository } from '@modules/approvals/infrastructure/oracle/approvals.oracle.repository';
import { LeaveOracleRepository } from '@modules/leave/infrastructure/oracle/leave.oracle.repository';

/**
 * The submit adapters bound to the declarations transcribed from the client's
 * ALL_ARGUMENTS export (2026-09-14, orcale/transcription.md). Each case runs
 * against the real static catalog with a mocked Oracle driver and pins the
 * exact bind set, the native DATE/NUMBER/BLOB types and the absence of the
 * p_language the legacy request templates wrongly listed.
 */
describe('Confirmed submit contracts (2026-09-14 export)', () => {
  const OUT = ['p_success_flag', 'p_error_msg', 'p_error_msg_ar'];
  const ATTACH = Array.from({ length: 10 }, (_, i) => [`p_file_name${i + 1}`, `p_attachment${i + 1}`]).flat();
  const DATE = (iso: string) => ({ type: oracledb.DB_TYPE_DATE, val: new Date(`${iso}T00:00:00.000Z`) });

  function make() {
    const call = jest.fn().mockResolvedValue({ p_success_flag: 'S', p_error_msg: null, p_error_msg_ar: null });
    const ora = { call, query: jest.fn().mockResolvedValue([]) } as unknown as OracleService;
    const schema = new OracleSchemaService(new OracleContractCatalog());
    const issued = () => {
      const [sql, binds] = call.mock.calls[0];
      return { sql: String(sql).replace(/\s+/g, ' '), binds: binds as Record<string, any> };
    };
    return { ora, schema, call, issued };
  }

  function expectShape(sql: string, binds: Record<string, unknown>, object: string, names: string[]) {
    expect(sql).toContain(`BEGIN ${object}(`);
    expect(Object.keys(binds).sort()).toEqual([...names].sort());
    expect(sql).not.toContain('p_language');
    for (const name of OUT) expect(binds[name]).toMatchObject({ dir: oracledb.BIND_OUT });
  }

  it('DEL_PHONE_NUMBER_PR: 4 IN + 3 OUT', async () => {
    const { ora, schema, issued } = make();
    await new PhoneOracleRepository(ora, schema).delete({
      username: 'test.User', lang: 'ar', phoneId: '1', phoneType: 'Home', phoneNumber: '4444',
    });
    const { sql, binds } = issued();
    expectShape(sql, binds, 'XXHMC_SND_DEL_PHONE_NUMBER_PR', ['p_user_name', 'p_phone_id', 'p_phone_type', 'p_phone_number', ...OUT]);
    expect(binds.p_user_name).toBe('TEST.USER');
  });

  it('PHONE_PKG.ADD_OR_UPDATE_PHONE: four ETSND_VARCHAR arrays built by str_to_type', async () => {
    const { ora, schema, issued } = make();
    await new PhoneOracleRepository(ora, schema).upsert({
      username: 'TESTUSER', lang: 'en',
      phones: [{ phoneId: '1', phoneType: 'Home', phoneNumber: '4444' }, { phoneId: '2', phoneType: 'Work', phoneNumber: '5555' }],
    });
    const { sql, binds } = issued();
    expectShape(sql, binds, 'XXHMC_SND_PHONE_PKG.ADD_OR_UPDATE_PHONE', [
      'p_user_name', 'p_phone_id', 'p_object_version_number', 'p_phone_type', 'p_phone_number', ...OUT,
    ]);
    for (const p of ['p_phone_id', 'p_object_version_number', 'p_phone_type', 'p_phone_number']) {
      expect(sql).toContain(`${p} => XXHMC_SND_PHONE_PKG.str_to_type(:${p})`);
    }
    expect(binds).toMatchObject({ p_phone_id: '1,2', p_phone_type: 'Home,Work', p_phone_number: '4444,5555', p_object_version_number: '1,1' });
  });

  it('CREATE_ADDRESS_PR: DATE effective date, P_REGION1..3 spelling, no attachments', async () => {
    const { ora, schema, issued } = make();
    await new AddressOracleRepository(ora, schema).create({
      username: 'TESTUSER', lang: 'en',
      fields: { p_effective_date: '2026-09-14', p_country: 'Qatar', p_address_type: 'Primary Local Address', p_region1: 'R1' },
    });
    const { sql, binds } = issued();
    expectShape(sql, binds, 'XXHMC_SND_CREATE_ADDRESS_PR', [
      'p_user_name', 'p_effective_date', 'p_main_address', 'p_primary_flag', 'p_country', 'p_address_type',
      'p_address_line1', 'p_address_line2', 'p_address_line3', 'p_town_or_city',
      'p_region1', 'p_region2', 'p_region3', 'p_po_box', ...OUT,
    ]);
    expect(binds.p_effective_date).toEqual(DATE('2026-09-14'));
    expect(binds.p_region1).toBe('R1');
  });

  it('UPD_ADDRESS_PR: P_REGION_1..3 spelling receives the body\'s p_region1..3, NUMBER address id', async () => {
    const { ora, schema, issued } = make();
    await new AddressOracleRepository(ora, schema).update({
      username: 'TESTUSER', lang: 'en',
      fields: { p_effective_date: '20260914', p_address_id: '1720617', p_region1: 'R1', p_region_2: 'R2', p_country: 'Qatar' },
    });
    const { sql, binds } = issued();
    expectShape(sql, binds, 'XXHMC_SND_UPD_ADDRESS_PR', [
      'p_user_name', 'p_effective_date', 'p_address_id', 'p_address_line1', 'p_address_line2', 'p_address_line3',
      'p_city', 'p_region_1', 'p_region_2', 'p_region_3', 'p_po_box', 'p_address_type', 'p_country', ...OUT,
    ]);
    expect(binds).toMatchObject({ p_region_1: 'R1', p_region_2: 'R2', p_region_3: null });
    expect(binds.p_address_id).toEqual({ type: oracledb.DB_TYPE_NUMBER, val: 1720617 });
    expect(binds.p_effective_date).toEqual(DATE('2026-09-14'));
  });

  it.each([{}, { p_first_name: null }])('binds a missing/null personal first name as SQL NULL: %j', async (input) => {
    const { ora, schema, issued } = make();
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const fields = await pipe.transform({
      p_effective_date: '01-Jan-2026', p_last_name: 'Test', p_marital_status: 'Married', ...input,
    }, { type: 'body', metatype: UpdatePersonalRequestDto });
    await new ProfileOracleRepository(ora, schema).updatePersonal({
      username: 'TESTUSER', lang: 'en', fields,
    });
    expect(issued().binds.p_first_name).toBeNull();
  });

  it.each([{}, { p_gender: null }, { p_gender: 'Male' }, { p_gender: 'Female' }])(
    'ADD_DEPENDENT_PR preserves optional gender at the Oracle boundary: %j',
    async (input) => {
      const { ora, schema, issued } = make();
      const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
      const fields = await pipe.transform(
        {
          p_first_name: 'Child',
          p_last_name: 'Test',
          p_relationship: 'Child',
          p_date_of_birth: '20150101',
          ...input,
        },
        { type: 'body', metatype: AddDependentRequestDto },
      );
      const service = new DependentService(new DependentOracleRepository(ora, schema), {} as LookupsService);
      await expect(service.add(fields, { username: 'TESTUSER', roles: [] }, 'en')).resolves.toMatchObject({
        successflag: 'S',
      });
      expect(issued().binds.p_gender).toBe(fields.p_gender ?? null);
      expect(issued().binds.p_relationship).toBe('Child');
    },
  );

  it.each([{}, { p_phone_id: null }, { p_phone_id: ['324324'] }])(
    'accepts the add phone id without changing the confirmed Oracle signature: %j',
    async (input) => {
      const { ora, schema, issued } = make();
      const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
      const fields = await pipe.transform({
        p_first_name: 'Child', p_last_name: 'Test', p_relationship: 'Child', p_gender: 'Male',
        p_date_of_birth: '20150101', p_phone_type: ['Home'], p_phone_number: ['44412345'], ...input,
      }, { type: 'body', metatype: AddDependentRequestDto });
      const service = new DependentService(new DependentOracleRepository(ora, schema), {} as LookupsService);
      await expect(service.add(fields, { username: 'TESTUSER', roles: [] }, 'en')).resolves.toMatchObject({
        successflag: 'S',
      });
      const { sql, binds } = issued();
      expect(sql).not.toContain('p_phone_id');
      expect(binds).not.toHaveProperty('p_phone_id');
      expect(binds).toMatchObject({ p_phone_type: 'Home', p_phone_number: '44412345' });
      expect(Object.keys(binds)).toHaveLength(69);
    },
  );

  it('UPD_PERSONAL_INFO_PR: DATE effective date + ten BLOB slots, no p_language', async () => {
    const { ora, schema, issued } = make();
    await new ProfileOracleRepository(ora, schema).updatePersonal({
      username: 'TESTUSER', lang: 'ar',
      fields: { p_effective_date: '01-Jan-2026', p_first_name: 'A', p_last_name: 'B', p_marital_status: 'Married', p_attachment1: Buffer.from('x').toString('base64') },
    });
    const { sql, binds } = issued();
    expectShape(sql, binds, 'XXHMC_SND_UPD_PERSONAL_INFO_PR', [
      'p_user_name', 'p_effective_date', 'p_first_name', 'p_middle_name', 'p_last_name', 'p_marital_status',
      'p_name_in_arabic', 'p_title', 'p_relationship', 'p_place_of_issue', 'p_country_of_issue',
      'p_visa_type', 'p_visa_number', 'p_visa_validity', 'p_type_of_sponsership', ...ATTACH, ...OUT,
    ]);
    expect(binds.p_effective_date).toEqual(DATE('2026-01-01'));
    expect(binds.p_attachment1).toEqual({ type: oracledb.DB_TYPE_BLOB, val: Buffer.from('x') });
  });

  it.each([
    ['2026-09-16', '16-SEP-2026'],
    ['2026-09-13', '13-SEP-2026'],
    ['30-Sep-2026', '30-SEP-2026'],
    ['2026-09-30', '30-SEP-2026'],
    ['13-MAR-2026', '13-MAR-2026'],
    [' 16-sep-2026 ', '16-SEP-2026'],
    ['20260916', '16-SEP-2026'],
    ['2028-02-29', '29-FEB-2028'],
    ['2026-01-01', '01-JAN-2026'],
  ])('amend and return convert %s through bound TO_DATE expressions', async (input, expected) => {
    const { ora, schema, call } = make();
    const repo = new LeaveOracleRepository(ora, schema);
    const fields = {
      p_leave_type: 'Annual Leave',
      p_leave_to_amend: 'Annual Leave|12-SEP-2026|13-SEP-2026',
      p_new_end_date: input,
    };
    const returnFields = { p_leave_details: '56949953', p_return_date: input };
    await repo.amend({ username: 'TESTUSER', lang: 'en', fields });
    await repo.returnFromLeave({ username: 'TESTUSER', lang: 'en', fields: returnFields });
    const [amendSql, amend] = call.mock.calls[0];
    const [returnSql, ret] = call.mock.calls[1];
    expect(amendSql).toContain('XXHMC_SND_HR_LEAV_AMEND_PR(');
    expect(amendSql).toContain(
      "p_new_end_date => TO_DATE(:p_new_end_date, 'DD-MON-YYYY', 'NLS_DATE_LANGUAGE=English')",
    );
    expect(amendSql).not.toContain(expected);
    expect(Object.keys(amend)).toHaveLength(28);
    expect(amend.p_new_end_date).toBe(expected);
    expect(amend.p_leave_to_amend).toBe(fields.p_leave_to_amend);
    expect(fields.p_new_end_date).toBe(input);
    expect(returnSql).toContain('XXHMC_SND_RET_FRM_LEAV_PR(');
    expect(returnSql).toContain(
      "p_return_date => TO_DATE(:p_return_date, 'DD-MON-YYYY', 'NLS_DATE_LANGUAGE=English')",
    );
    expect(returnSql).not.toContain(expected);
    expect(Object.keys(ret)).toHaveLength(29);
    expect(ret.p_return_date).toBe(expected);
    expect(ret.p_leave_details).toBe('56949953');
    expect(returnFields.p_return_date).toBe(input);
    for (const b of [amend, ret]) expect(b).not.toHaveProperty('p_language');
  });

  it.each([null, undefined, '', ' ', 'not-a-date', "2026-09-16'); END; --"])(
    'amend and return preserve the null bind for unparseable input %s',
    async (input) => {
      const { ora, schema, call } = make();
      const repo = new LeaveOracleRepository(ora, schema);
      await repo.amend({
        username: 'TESTUSER',
        lang: 'en',
        fields: { p_leave_type: 'Annual Leave', p_leave_to_amend: 'x', p_new_end_date: input },
      });
      await repo.returnFromLeave({
        username: 'TESTUSER',
        lang: 'en',
        fields: { p_leave_details: '56949953', p_return_date: input },
      });
      for (const [index, param] of ['p_new_end_date', 'p_return_date'].entries()) {
        const [sql, binds] = call.mock.calls[index];
        expect(sql).toContain(
          `${param} => TO_DATE(:${param}, 'DD-MON-YYYY', 'NLS_DATE_LANGUAGE=English')`,
        );
        expect(binds[param]).toBeNull();
        expect(sql).not.toContain("2026-09-16'); END; --");
      }
    },
  );

  it.each([{}, { p_date_of_issue: null, p_place_of_issue: null }])(
    'PASS_DTL_PR binds omitted/null issue fields as SQL NULL: %j',
    async (input) => {
      const { ora, schema, issued } = make();
      const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
      const fields = await pipe.transform(
        {
          p_passport_number: 'A1',
          p_date_of_expiry: '20360121',
          p_type_of_passport: 'Normal',
          p_country_of_issue: 'QA',
          ...input,
        },
        { type: 'body', metatype: PassportApplyRequestDto },
      );
      await new PassportOracleRepository(ora, schema).apply({ username: 'TESTUSER', lang: 'en', fields });
      const { binds } = issued();
      expect(binds.p_date_of_issue).toEqual({ type: oracledb.DB_TYPE_DATE, val: null });
      expect(binds.p_place_of_issue).toBeNull();
      expect(binds.p_date_of_expiry).toEqual(DATE('2036-01-21'));
    },
  );

  it('PASS_DTL_PR: issue/expiry are DATE formals, no p_language', async () => {
    const { ora, schema, issued } = make();
    await new PassportOracleRepository(ora, schema).apply({
      username: 'TESTUSER', lang: 'en',
      fields: { p_passport_number: 'A1', p_date_of_issue: '20260121', p_date_of_expiry: '20360121', p_type_of_passport: 'Normal', p_place_of_issue: 'Doha', p_country_of_issue: 'QA' },
    });
    const { sql, binds } = issued();
    expectShape(sql, binds, 'XXHMC_SND_PASS_DTL_PR', [
      'p_user_name', 'p_passport_number', 'p_date_of_issue', 'p_date_of_expiry', 'p_type_of_passport',
      'p_place_of_issue', 'p_country_of_issue', ...ATTACH, ...OUT,
    ]);
    expect(binds.p_date_of_issue).toEqual(DATE('2026-01-21'));
    expect(binds.p_date_of_expiry).toEqual(DATE('2036-01-21'));
  });

  it('REMOVE_DEPENDENT_PR: end date is DATE, legacy alias spellings still land', async () => {
    const { ora, schema, issued } = make();
    await new DependentOracleRepository(ora, schema).delete({
      username: 'TESTUSER', lang: 'en', dependentId: '1607679',
      fields: { p_relationship: 'C', p_relationship_end_date: '20260824' },
    });
    const { sql, binds } = issued();
    expectShape(sql, binds, 'XXHMC_SND_REMOVE_DEPENDENT_PR', [
      'p_user_name', 'p_dependent_id', 'p_contact_type', 'p_relation_ship', 'p_relation_ship_end_date', ...ATTACH, ...OUT,
    ]);
    expect(binds.p_relation_ship).toBe('C');
    expect(binds.p_relation_ship_end_date).toEqual(DATE('2026-08-24'));
  });

  it('ADD_DEPENDENT_PKG.ADD_DEPENDENT_PR: MY_TYPE phone arrays via STR_TO_TYPE, DATEs native, trailing IN params after OUTs', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 14, 12));
    try {
      const { ora, schema, issued } = make();
      await new DependentOracleRepository(ora, schema).add({
        username: 'TESTUSER', lang: 'ar',
        fields: {
          p_first_name: 'Child', p_last_name: 'Test', p_relationship: 'Child', p_gender: 'Male',
          p_date_of_birth: '20150101', p_pp_expiry_date: '2030-01-01',
          p_phone_type: ['Qatar Mobile Number', 'Home'], p_phone_number: ['55512345', '44412345'],
          p_employment_status: 'Student', p_comments: 'test',
        },
      });
      const { sql, binds } = issued();
      expect(sql).toContain('BEGIN XXHMC_SND_ADD_DEPENDENT_PKG.XXHMC_SND_ADD_DEPENDENT_PR(');
      expect(Object.keys(binds)).toHaveLength(69);
      expect(sql).not.toContain('p_language');
      expect(sql).toContain('p_phone_type => XXHMC_SND_ADD_DEPENDENT_PKG.STR_TO_TYPE(:p_phone_type)');
      expect(sql).toContain('p_phone_number => XXHMC_SND_ADD_DEPENDENT_PKG.STR_TO_TYPE(:p_phone_number)');
      expect(binds).toMatchObject({
        p_user_name: 'TESTUSER', p_phone_type: 'Qatar Mobile Number,Home', p_phone_number: '55512345,44412345',
        p_employment_status: 'Student', p_comments: 'test',
      });
      expect(binds.p_date_of_birth).toEqual(DATE('2015-01-01'));
      expect(binds.p_pp_expiry_date).toEqual(DATE('2030-01-01'));
      expect(binds.p_effective_date).toEqual(DATE('2026-09-14'));
      expect(binds.p_visa_issue_date).toEqual({ type: oracledb.DB_TYPE_DATE, val: null });
      // Named notation: the two IN params declared after the OUTs are rendered last.
      expect(sql.trim().endsWith('p_employment_status => :p_employment_status, p_comments => :p_comments); END;')).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('ADD_DEPENDENT_PKG.UPDATE_DEPENDENT_PR: both phone groups wrapped, NUMBER ids, legacy spellings', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 14, 12));
    try {
      const { ora, schema, issued } = make();
      await new DependentOracleRepository(ora, schema).update({
        username: 'TESTUSER', lang: 'en',
        fields: {
          p_dependent_id: '329302', p_relation_ship: 'Child', p_gendar: 'Male', p_visa_validy: 'Yes',
          p_type_of_sponsership: 'Employee', p_date_of_issue_qid: '20200101', p_expiry_date: '20301231',
          p_phone_id: ['324324'], p_phone_type: ['Home'], p_phone_number: ['44412345'],
        },
      });
      const { sql, binds } = issued();
      expect(sql).toContain('BEGIN XXHMC_SND_ADD_DEPENDENT_PKG.XXHMC_SND_UPDATE_DEPENDENT_PR(');
      expect(Object.keys(binds)).toHaveLength(75);
      for (const p of ['p_phone_type', 'p_phone_number', 'p_phone_id', 'p_phone_type1', 'p_phone_number1', 'p_phone_id1']) {
        expect(sql).toContain(`${p} => XXHMC_SND_ADD_DEPENDENT_PKG.STR_TO_TYPE(:${p})`);
      }
      expect(binds).toMatchObject({
        p_phone_id: '324324', p_phone_type: 'Home', p_phone_number: '44412345', p_phone_type1: null,
        p_relation_ship: 'Child', p_gendar: 'Male', p_visa_validy: 'Yes', p_type_of_sponsership: 'Employee',
      });
      expect(binds.p_dependent_id).toEqual({ type: oracledb.DB_TYPE_NUMBER, val: 329302 });
      expect(binds.p_date_of_issue_qid).toEqual(DATE('2020-01-01'));
      expect(binds.p_expiry_date).toEqual(DATE('2030-12-31'));
      expect(binds.p_effective_date).toEqual(DATE('2026-09-14'));
    } finally {
      jest.useRealTimers();
    }
  });

  it('TICKET_REQ_PR / CANCEL_TKT_PR: no p_language, ten BLOB slots', async () => {
    const { ora, schema, call } = make();
    const repo = new TicketOracleRepository(ora, schema);
    await repo.apply({ username: 'TESTUSER', lang: 'ar', fields: { p_request_for: 'Self', p_employee: '26023', p_request_type: 'Annual Ticket', p_contractual_year: 'Y', p_traveling_dest: 'Doha', p_travel_class: 'Economy' } });
    await repo.cancel({ username: 'TESTUSER', lang: 'ar', fields: { p_annual_tkt: 'T', p_contractual_year: 'Y', p_reason: 'R', p_ticket_as: 'Cash', p_repayment_method: 'Payroll Deduction' } });
    const [applySql, apply] = call.mock.calls[0];
    const [cancelSql, cancel] = call.mock.calls[1];
    expectShape(String(applySql), apply, 'XXHMC_SND_TICKET_REQ_PR', [
      'p_user_name', 'p_request_for', 'p_employee', 'p_passenger1', 'p_passenger2', 'p_passenger3', 'p_passenger4',
      'p_request_type', 'p_contractual_year', 'p_traveling_dest', 'p_travel_class', 'p_comments', ...ATTACH, ...OUT,
    ]);
    expectShape(String(cancelSql), cancel, 'XXHMC_SND_CANCEL_TKT_PR', [
      'p_user_name', 'p_annual_tkt', 'p_contractual_year', 'p_reason', 'p_ticket_as', 'p_repayment_method',
      'p_comments', 'p_voucher_ref', ...ATTACH, ...OUT,
    ]);
    expect(apply.p_attachment1).toEqual({ type: oracledb.DB_TYPE_BLOB, val: null });
  });

  describe('NUMBER formals (NJS-011 regression: /approvals/:id/request-info)', () => {
    const request = (approvalId: string) => ({
      username: 'AIBRAHIM39', lang: 'en' as const, approvalId, toUsername: 'VPAVITHRAN',
      itemType: 'HRSSA', itemKey: '18876323', mode: 'QUESTION', comment: 'test',
    });

    it('binds the notification id as a JS number, never a numeric string', async () => {
      const { ora, schema, issued } = make();
      await new ApprovalsOracleRepository(ora, schema).requestInfo(request('123864098'));
      const { binds } = issued();
      expect(binds.p_notification_id).toEqual({ type: oracledb.DB_TYPE_NUMBER, val: 123864098 });
      expect(typeof binds.p_notification_id.val).toBe('number');
    });

    it('binds an omitted NUMBER as a typed null and rejects non-numeric text before Oracle', async () => {
      const { ora, schema, call, issued } = make();
      const repo = new ApprovalsOracleRepository(ora, schema);
      await expect(repo.requestInfo(request('abc'))).rejects.toMatchObject({ status: 400 });
      expect(call).not.toHaveBeenCalled();
      await new AddressOracleRepository(ora, schema).update({ username: 'U', lang: 'en', fields: {} });
      expect(issued().binds.p_address_id).toEqual({ type: oracledb.DB_TYPE_NUMBER, val: null });
    });

    it('hands an id beyond double precision to Oracle as text instead of losing digits', async () => {
      const { ora, schema, issued } = make();
      await new ApprovalsOracleRepository(ora, schema).requestInfo(request('12345678901234567890'));
      expect(issued().binds.p_notification_id).toBe('12345678901234567890');
    });
  });

  it('APPROVE_REJECT_PR: NUMBER notification id, no p_language', async () => {
    const { ora, schema, issued } = make();
    await new ApprovalsOracleRepository(ora, schema).decide({
      username: 'test.User', lang: 'ar', approvalId: '12345', itemType: 'HRSSA', itemKey: 'KEY', decision: 'APPROVE', comment: 'ok',
    });
    const { sql, binds } = issued();
    expectShape(sql, binds, 'XXHMC_SND_APPROVE_REJECT_PR', [
      'p_user_name', 'p_itemtype', 'p_item_key', 'p_result', 'p_notification_id', 'p_user_comment', ...OUT,
    ]);
    expect(binds).toMatchObject({ p_user_name: 'TEST.USER', p_result: 'APPROVED', p_user_comment: 'ok' });
    expect(binds.p_notification_id).toEqual({ type: oracledb.DB_TYPE_NUMBER, val: 12345 });
  });
});
