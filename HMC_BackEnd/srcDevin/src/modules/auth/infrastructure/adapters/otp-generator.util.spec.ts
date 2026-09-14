import configuration, { OtpConfig } from '@core/config/configuration';
import { envValidationSchema } from '@core/config/env.validation';
import { generateOtp, otpCharClass } from './otp-generator.util';

const BASE: OtpConfig = {
  inResponse: false,
  length: 6,
  ttlSeconds: 300,
  maxAttempts: 5,
  resendWindowSeconds: 60,
  staticValue: '',
  charset: 'numeric',
  delivery: 'motc',
  store: 'legacy',
};

describe('generateOtp', () => {
  it('returns the static value verbatim when configured', () => {
    expect(generateOtp({ ...BASE, staticValue: '123456' })).toBe('123456');
    expect(generateOtp({ ...BASE, staticValue: 'AB12', charset: 'alphanumeric' })).toBe('AB12');
  });

  it('numeric: OTP_LENGTH digits, leading zeros preserved', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateOtp({ ...BASE, length: 4 })).toMatch(/^\d{4}$/);
    }
  });

  it('alphanumeric: OTP_LENGTH characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const otp = generateOtp({ ...BASE, charset: 'alphanumeric', length: 8 });
      expect(otp).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    }
  });
});

describe('OTP_IN_RESPONSE configuration', () => {
  const keys = ['OTP_IN_RESPONSE', 'NODE_ENV'] as const;
  let saved: (string | undefined)[];

  beforeEach(() => {
    saved = keys.map((key) => process.env[key]);
  });

  afterEach(() => {
    keys.forEach((key, index) => {
      if (saved[index] === undefined) delete process.env[key];
      else process.env[key] = saved[index];
    });
  });

  it.each([
    ['development', undefined, false],
    ['development', 'false', false],
    ['development', 'true', true],
    ['test', 'true', true],
    ['production', 'true', false],
    ['production', 'false', false],
  ])('uses NODE_ENV=%s and OTP_IN_RESPONSE=%s', (nodeEnv, flag, expected) => {
    process.env.NODE_ENV = nodeEnv as string;
    if (flag === undefined) delete process.env.OTP_IN_RESPONSE;
    else process.env.OTP_IN_RESPONSE = flag as string;

    expect(configuration().otp.inResponse).toBe(expected);
  });

  it('validates boolean values and defaults to false', () => {
    const schema = envValidationSchema.extract('OTP_IN_RESPONSE');
    expect(schema.validate(undefined).value).toBe(false);
    expect(schema.validate('true').value).toBe(true);
    expect(schema.validate('false').value).toBe(false);
    expect(schema.validate('yes').error).toBeDefined();
  });
});

describe('otpCharClass', () => {
  it('matches the configured charset', () => {
    expect(new RegExp(`^${otpCharClass(BASE)}+$`).test('042319')).toBe(true);
    expect(new RegExp(`^${otpCharClass(BASE)}+$`).test('AB1234')).toBe(false);
    const alnum = otpCharClass({ ...BASE, charset: 'alphanumeric' });
    expect(new RegExp(`^${alnum}+$`).test('AB1234')).toBe(true);
  });
});
