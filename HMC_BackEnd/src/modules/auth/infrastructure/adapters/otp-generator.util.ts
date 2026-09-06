import { randomInt } from 'node:crypto';
import { OtpConfig } from '@core/config/configuration';

/**
 * Uppercase letters + digits with the ambiguous I/O/0/1 removed, so an OTP
 * read from a small SMS font cannot be mistyped.
 */
const ALPHANUMERIC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * One OTP per the configured policy, shared by every OtpPort store:
 *
 *  - OTP_STATIC_VALUE non-empty → that exact value (testing aid; the journey
 *    can be exercised without reading the SMS).
 *  - OTP_CHARSET=numeric (default) → OTP_LENGTH digits, leading zeros kept.
 *  - OTP_CHARSET=alphanumeric → OTP_LENGTH characters from the unambiguous
 *    A-Z/2-9 alphabet.
 */
export function generateOtp(cfg: OtpConfig): string {
  if (cfg.staticValue) return cfg.staticValue;
  if (cfg.charset === 'alphanumeric') {
    return Array.from({ length: cfg.length }, () => ALPHANUMERIC[randomInt(ALPHANUMERIC.length)])
      .join('');
  }
  const max = 10 ** cfg.length;
  return String(randomInt(0, max)).padStart(cfg.length, '0');
}

/** Character class matching one OTP character of the configured charset. */
export function otpCharClass(cfg: OtpConfig): string {
  return cfg.charset === 'alphanumeric' ? '[A-Za-z0-9]' : '\\d';
}
