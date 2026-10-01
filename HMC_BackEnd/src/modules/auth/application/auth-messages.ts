import { Lang } from '@shared/domain/lang';

/** "Invalid OTP" — shared by /auth/otp/validate and /auth/mpin/update/reset. */
export const INVALID_OTP_MESSAGE: Readonly<Record<Lang, string>> = Object.freeze({
  en: 'Invalid OTP',
  ar: 'رمز التحقق غير صحيح',
});

/** /auth/mpin/update/reset — the new MPIN equals the current one (HTTP 400). */
export const MPIN_REUSED_MESSAGE: Readonly<Record<Lang, string>> = Object.freeze({
  en: 'This MPIN was used before. Please enter a different MPIN.',
  ar: 'تم استخدام الرمز التعريفى هذا من قبل. يرجى إدخال رمز تعريفى مختلف.',
});
