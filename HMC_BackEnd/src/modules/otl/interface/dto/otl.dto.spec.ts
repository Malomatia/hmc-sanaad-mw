import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { OtlPeriodsQueryDto, SubmitTimecardRequestDto } from './otl.dto';
import { OTL_SUBMIT_BODY } from '../otl.examples';

/** The submit body runs through the app's global pipe settings (AGENTS.md: unknown keys are 400). */
describe('SubmitTimecardRequestDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const validate = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: SubmitTimecardRequestDto });
  const clone = () => JSON.parse(JSON.stringify(OTL_SUBMIT_BODY)) as Record<string, any>;

  const messages = async (body: unknown): Promise<string[]> => {
    try {
      await validate(body);
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      return ((err as BadRequestException).getResponse() as { message: string[] }).message;
    }
    throw new Error('expected a 400');
  };

  it('accepts the documented example', async () => {
    const dto = (await validate(clone())) as SubmitTimecardRequestDto;
    expect(dto).toBeInstanceOf(SubmitTimecardRequestDto);
    expect(dto.p_entries).toHaveLength(32);
  });

  it.each(['p_user_name', 'p_period', 'username'])(
    'rejects a client-supplied %s (unknown key)',
    async (key) => {
      expect((await messages({ ...clone(), [key]: 'SPOOF' })).join()).toContain(
        `property ${key} should not exist`,
      );
    },
  );

  it.each(['p_from_date', 'p_to_date', 'p_days'])(
    'rejects the range key %s inside an entry (B8)',
    async (key) => {
      const body = clone();
      body.p_entries[0][key] = key === 'p_days' ? 3 : '2026-07-01';
      expect((await messages(body)).join()).toContain(`property ${key} should not exist`);
    },
  );

  it.each(['09-Jul-2026', '2026-7-9', '2026-02-30', ''])(
    'rejects the entry date %j',
    async (date) => {
      const body = clone();
      body.p_entries[0].p_entry_date = date;
      expect((await messages(body)).join()).toContain('p_entry_date must be a real calendar date');
    },
  );

  it('requires the element NAME, not ELEMENT_TYPE_ID', async () => {
    const body = clone();
    body.p_entries[0].p_hour_type_id = '154';
    expect((await messages(body)).join()).toContain('p_hour_type_id must be the element NAME');
  });

  it('requires facility and cost-center codes on a cross-charged entry', async () => {
    const body = clone();
    body.p_entries[0].p_cross_dept_flag = 'Y';
    const errors = (await messages(body)).join();
    expect(errors).toContain('p_dept_id');
    expect(errors).toContain('p_cost_center');
  });

  it.each([
    ['p_value', '8'],
    ['p_value', 25],
    ['p_cross_dept_flag', 'X'],
  ])('rejects %s = %j', async (field, value) => {
    const body = clone();
    body.p_entries[0][field] = value;
    expect((await messages(body)).join()).toContain(field);
  });

  it('rejects a confirmation flag other than Y and an empty entry list', async () => {
    expect((await messages({ ...clone(), p_confirmation_flag: 'N' })).join()).toContain(
      'p_confirmation_flag',
    );
    expect((await messages({ ...clone(), p_entries: [] })).join()).toContain('p_entries');
  });
});

describe('OtlPeriodsQueryDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const validate = (query: unknown) =>
    pipe.transform(query, { type: 'query', metatype: OtlPeriodsQueryDto });

  it('normalizes the status filter and tolerates (ignores) a username', async () => {
    await expect(
      validate({ status: 'submitted', year: '2026', username: 'AIBRAHIM39' }),
    ).resolves.toMatchObject({
      status: 'SUBMITTED',
      year: '2026',
    });
  });

  it('rejects an unknown status or a malformed year', async () => {
    await expect(validate({ status: 'CLOSED' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ year: '26' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
