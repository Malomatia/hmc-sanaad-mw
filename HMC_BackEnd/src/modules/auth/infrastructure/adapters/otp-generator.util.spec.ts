import { OtpConfig } from '@core/config/configuration';
import { generateOtp, otpCharClass } from './otp-generator.util';

const BASE: OtpConfig = {
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

describe('otpCharClass', () => {
  it('matches the configured charset', () => {
    expect(new RegExp(`^${otpCharClass(BASE)}+$`).test('042319')).toBe(true);
    expect(new RegExp(`^${otpCharClass(BASE)}+$`).test('AB1234')).toBe(false);
    const alnum = otpCharClass({ ...BASE, charset: 'alphanumeric' });
    expect(new RegExp(`^${alnum}+$`).test('AB1234')).toBe(true);
  });
});
