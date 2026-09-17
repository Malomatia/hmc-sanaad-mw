import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateAddressRequestDto,
  UpdateAddressRequestDto,
} from '../../modules/contact/interface/dto/contact.dto';
import {
  AddDependentRequestDto,
  PassportApplyRequestDto,
  UpdateDependentRequestDto,
} from '../../modules/dependents/interface/dto/dependents.dto';
import { SchoolFeeApplyRequestDto } from '../../modules/school-fees/interface/dto/school-fees.dto';
import { ApplyLeaveRequestDto } from '../../modules/leave/interface/dto/leave.dto';
import { UpdatePersonalRequestDto } from '../../modules/profile/interface/dto/update-personal.request.dto';
import { PROFILE_UPDATE_PERSONAL_BODY } from '../../modules/profile/interface/profile.examples';
import { DECORATORS } from '@nestjs/swagger';

const validateDto = (type: new () => object, value: object) =>
  validate(plainToInstance(type, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('Oracle submit DTOs', () => {
  describe('personal first name', () => {
    const payload = {
      p_effective_date: '01-Jan-2026',
      p_last_name: 'Ibrahim',
      p_marital_status: 'Married',
    };

    it.each([{}, { p_first_name: null }, { p_first_name: 'Amir' }])(
      'accepts an omitted, null, or populated first name: %j',
      async (fields) => {
        expect(await validateDto(UpdatePersonalRequestDto, { ...payload, ...fields })).toHaveLength(0);
      },
    );

    it.each(['', 123, false, [], {}])('rejects an invalid non-null first name: %j', async (value) => {
      const errors = await validateDto(UpdatePersonalRequestDto, { ...payload, p_first_name: value });
      expect(errors.map((error) => error.property)).toEqual(['p_first_name']);
    });

    it('keeps the other required fields and unknown-field rejection', async () => {
      const errors = await validateDto(UpdatePersonalRequestDto, { p_first_name: null, unknown: 'x' });
      expect(errors.map((error) => error.property).sort()).toEqual([
        'p_effective_date', 'p_last_name', 'p_marital_status', 'unknown',
      ]);
    });

    it('documents first name as optional and nullable', () => {
      expect(PROFILE_UPDATE_PERSONAL_BODY.schema.required).not.toContain('p_first_name');
      expect(PROFILE_UPDATE_PERSONAL_BODY.schema.properties.p_first_name).toMatchObject({
        type: 'string', nullable: true,
      });
    });
  });

  describe('add dependent gender', () => {
    const payload = {
      p_first_name: 'Testchild',
      p_last_name: 'Ibrahim',
      p_relationship: 'Child',
      p_date_of_birth: '20150101',
    };

    it.each([{}, { p_gender: null }, { p_gender: 'Male' }, { p_gender: 'Female' }])(
      'accepts omitted, null, or populated gender: %j',
      async (fields) => {
        expect(await validateDto(AddDependentRequestDto, { ...payload, ...fields })).toHaveLength(0);
      },
    );

    it.each(['', 123, false, [], {}])('rejects invalid non-null gender: %j', async (value) => {
      const errors = await validateDto(AddDependentRequestDto, { ...payload, p_gender: value });
      expect(errors.map((error) => error.property)).toEqual(['p_gender']);
    });

    it('keeps the other business fields mandatory', async () => {
      const errors = await validateDto(AddDependentRequestDto, {});
      expect(errors.map((error) => error.property).sort()).toEqual(Object.keys(payload).sort());
    });

    it('still rejects unknown fields when gender is omitted', async () => {
      const errors = await validateDto(AddDependentRequestDto, { ...payload, unknown: 'value' });
      expect(errors.map((error) => error.property)).toEqual(['unknown']);
    });

    it('documents gender as optional and nullable', () => {
      expect(
        Reflect.getMetadata(DECORATORS.API_MODEL_PROPERTIES, AddDependentRequestDto.prototype, 'p_gender'),
      ).toMatchObject({ required: false, nullable: true, type: String });
    });
  });

  describe('add dependent phone id', () => {
    const payload = {
      p_first_name: 'Testchild',
      p_last_name: 'Ibrahim',
      p_relationship: 'Child',
      p_gender: 'Male',
      p_date_of_birth: '20150101',
      p_phone_type: ['Home'],
      p_phone_number: ['44412345'],
    };

    it.each([
      { fields: {}, expected: undefined },
      { fields: { p_phone_id: null }, expected: null },
      { fields: { p_phone_id: ['324324'] }, expected: ['324324'] },
      { fields: { p_phone_id: 324324 }, expected: ['324324'] },
      { fields: { p_phone_id: '324324' }, expected: ['324324'] },
    ])('accepts and preserves or normalizes $fields', async ({ fields, expected }) => {
      const dto = plainToInstance(AddDependentRequestDto, { ...payload, ...fields });
      expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
      expect(dto.p_phone_id).toEqual(expected);
    });

    it.each([false, {}, [null], [{}]])('rejects an invalid phone id: %j', async (value) => {
      const errors = await validateDto(AddDependentRequestDto, { ...payload, p_phone_id: value });
      expect(errors.map((error) => error.property)).toEqual(['p_phone_id']);
    });

    it('documents phone id as optional and nullable', () => {
      expect(Reflect.getMetadata(
        DECORATORS.API_MODEL_PROPERTIES, AddDependentRequestDto.prototype, 'p_phone_id',
      )).toMatchObject({ required: false, nullable: true, isArray: true });
    });
  });

  it('rejects an empty create-address payload', async () => {
    const errors = await validateDto(CreateAddressRequestDto, {});
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining([
        'p_effective_date',
        'p_primary_flag',
        'p_country',
        'p_address_type',
        'p_address_line1',
      ]),
    );
  });

  it('accepts the documented update-address keys and rejects unknown keys', async () => {
    const valid = await validateDto(UpdateAddressRequestDto, {
      p_address_id: '312605',
      p_effective_date: '20240911',
      p_region1: 'Doha',
    });
    expect(valid).toHaveLength(0);

    const invalid = await validateDto(UpdateAddressRequestDto, {
      p_address_id: '312605',
      p_effective_date: '20240911',
      wrong_name: 'value',
    });
    expect(invalid.some((error) => error.property === 'wrong_name')).toBe(true);
  });

  describe.each([
    {
      name: 'add dependent',
      type: AddDependentRequestDto,
      payload: {
        p_first_name: 'Testchild',
        p_last_name: 'Ibrahim',
        p_relationship: 'Child',
        p_gender: 'Male',
        p_date_of_birth: '20150101',
      },
    },
    {
      name: 'update dependent',
      type: UpdateDependentRequestDto,
      payload: { p_dependent_id: '5001' },
    },
  ])('$name effective date', ({ type, payload }) => {
    it('accepts the payload without a client-supplied effective date', async () => {
      expect(await validateDto(type, payload)).toHaveLength(0);
    });

    it('rejects a client-supplied effective date as an unsupported field', async () => {
      const errors = await validateDto(type, { ...payload, p_effective_date: '20260101' });
      expect(errors).toEqual([
        expect.objectContaining({
          property: 'p_effective_date',
          constraints: { whitelistValidation: 'property p_effective_date should not exist' },
        }),
      ]);
    });
  });

  it('accepts canonical and legacy dependent spelling aliases', async () => {
    const errors = await validateDto(UpdateDependentRequestDto, {
      p_dependent_id: '5001',
      p_gender: 'Male',
      p_gendar: 'Male',
      p_date_of_issue_qid: '20260101',
      p_date_of_issuue_qid: '20260101',
    });
    expect(errors).toHaveLength(0);
  });

  describe('passport application fields', () => {
    const payload = {
      p_passport_number: 'A498989',
      p_date_of_expiry: '20360121',
      p_type_of_passport: 'Normal',
      p_country_of_issue: 'QA',
    };

    it('keeps the remaining business fields mandatory', async () => {
      const errors = await validateDto(PassportApplyRequestDto, {});
      expect(errors.map((error) => error.property).sort()).toEqual(Object.keys(payload).sort());
    });

    it.each([
      {},
      { p_date_of_issue: null, p_place_of_issue: null },
      { p_date_of_issue: '20260121' },
      { p_place_of_issue: 'Doha' },
      { p_date_of_issue: '20260121', p_place_of_issue: 'Doha' },
    ])('accepts optional issue fields: %j', async (fields) => {
      expect(await validateDto(PassportApplyRequestDto, { ...payload, ...fields })).toHaveLength(0);
    });

    describe.each(['p_date_of_issue', 'p_place_of_issue'])('%s', (field) => {
      it.each(['', 123, false, [], {}])('rejects invalid non-null values: %j', async (value) => {
        const errors = await validateDto(PassportApplyRequestDto, { ...payload, [field]: value });
        expect(errors.map((error) => error.property)).toEqual([field]);
      });

      it('is documented as optional and nullable', () => {
        expect(
          Reflect.getMetadata(DECORATORS.API_MODEL_PROPERTIES, PassportApplyRequestDto.prototype, field),
        ).toMatchObject({ required: false, nullable: true, type: String });
      });
    });

    it('still rejects unknown fields', async () => {
      const errors = await validateDto(PassportApplyRequestDto, { ...payload, unknown: 'value' });
      expect(errors.map((error) => error.property)).toEqual(['unknown']);
    });
  });

  it('accepts all ten leave-apply attachment slots and rejects unknown keys', async () => {
    const attachments: Record<string, string> = {};
    for (let i = 1; i <= 10; i++) {
      attachments[`p_file_name${i}`] = `report${i}.pdf`;
      attachments[`p_attachment${i}`] = 'JVBERi0xLjQKJ...==';
    }
    const valid = await validateDto(ApplyLeaveRequestDto, {
      absenceType: 'Sick Leave',
      startDate: '12-Jun-2025',
      endDate: '14-Jun-2025',
      ...attachments,
    });
    expect(valid).toHaveLength(0);

    const invalid = await validateDto(ApplyLeaveRequestDto, {
      absenceType: 'Sick Leave',
      startDate: '12-Jun-2025',
      endDate: '14-Jun-2025',
      p_attachment11: 'JVBERi0xLjQKJ...==',
    });
    expect(invalid.some((error) => error.property === 'p_attachment11')).toBe(true);
  });

  // p_phone_type / p_phone_number are PL/SQL associative arrays (my_type) on
  // the Oracle side — the wire value is an array of strings, paired by index.
  it('accepts string arrays for the dependent phone fields', async () => {
    const errors = await validateDto(AddDependentRequestDto, {
      p_first_name: 'Testchild',
      p_last_name: 'Ibrahim',
      p_relationship: 'Child',
      p_gender: 'Male',
      p_date_of_birth: '20150101',
      p_phone_type: ['Qatar Mobile Number', 'Home'],
      p_phone_number: ['55512345', '44412345'],
    });
    expect(errors).toHaveLength(0);
  });

  it('wraps a lone phone string into a one-item array (backward compat)', () => {
    const dto = plainToInstance(AddDependentRequestDto, {
      p_phone_type: 'Qatar Mobile Number',
      p_phone_number: '55512345',
    });
    expect(dto.p_phone_type).toEqual(['Qatar Mobile Number']);
    expect(dto.p_phone_number).toEqual(['55512345']);
  });

  it('coerces numeric items to strings (my_type is a VARCHAR2 table)', () => {
    const dto = plainToInstance(UpdateDependentRequestDto, {
      p_dependent_id: '329302',
      p_phone_id: [324324, 4324234],
      p_phone_id1: [111, '222'],
    });
    expect(dto.p_phone_id).toEqual(['324324', '4324234']);
    expect(dto.p_phone_id1).toEqual(['111', '222']);
  });

  it('accepts the update phone groups as string arrays', async () => {
    const errors = await validateDto(UpdateDependentRequestDto, {
      p_dependent_id: '329302',
      p_phone_id: ['324324'],
      p_phone_type: ['Qatar Mobile Number'],
      p_phone_number: ['55512345'],
      p_phone_id1: [4324234],
      p_phone_type1: ['Home'],
      p_phone_number1: ['44412345'],
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects non-string/non-number items in the phone arrays', async () => {
    const errors = await validateDto(AddDependentRequestDto, {
      p_first_name: 'Testchild',
      p_last_name: 'Ibrahim',
      p_relationship: 'Child',
      p_gender: 'Male',
      p_date_of_birth: '20150101',
      p_phone_number: [{ number: '55512345' }],
    });
    expect(errors.some((error) => error.property === 'p_phone_number')).toBe(true);
  });

  it('requires school-fee identifiers and amount', async () => {
    const errors = await validateDto(SchoolFeeApplyRequestDto, {});
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining([
        'p_academic_year',
        'p_child_name',
        'p_school_name',
        'p_request_type',
        'p_amount',
      ]),
    );
  });
});
