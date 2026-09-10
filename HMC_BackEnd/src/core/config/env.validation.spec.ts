import { envValidationSchema } from './env.validation';

describe('Oracle pool configuration bounds', () => {
  it.each([
    { ORACLE_POOL_MIN: -1 },
    { ORACLE_POOL_MIN: 1.5 },
    { ORACLE_POOL_MAX: 2.5 },
    { ORACLE_POOL_MIN: 0, ORACLE_POOL_MAX: 0 },
    { ORACLE_POOL_MAX: -1 },
    { ORACLE_POOL_MIN: 4, ORACLE_POOL_MAX: 3 },
    { ORACLE_POOL_MIN: 11 },
    { ORACLE_POOL_MAX: 1 },
    { ORACLE_POOL_MIN: 'invalid' },
    { ORACLE_POOL_MAX: 'invalid' },
  ])('rejects invalid bounds %j', (input) => {
    expect(envValidationSchema.validate(input).error).toBeDefined();
  });

  it.each([
    [0, 1],
    [1, 1],
    [2, 10],
    ['3', '3'],
  ])('accepts minimum %s and maximum %s', (min, max) => {
    const { error, value } = envValidationSchema.validate({
      ORACLE_POOL_MIN: min,
      ORACLE_POOL_MAX: max,
    });
    expect(error).toBeUndefined();
    expect(value.ORACLE_POOL_MIN).toBe(Number(min));
    expect(value.ORACLE_POOL_MAX).toBe(Number(max));
  });

  it('retains the current pool and credential defaults', () => {
    const { error, value } = envValidationSchema.validate({});
    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      ORACLE_POOL_MIN: 2,
      ORACLE_POOL_MAX: 10,
      ORACLE_USER: '',
      ORACLE_PASSWORD: '',
      ORACLE_DSN: '',
      ORACLE_DISABLED: false,
      ORACLE_THICK_MODE: true,
    });
  });
});
