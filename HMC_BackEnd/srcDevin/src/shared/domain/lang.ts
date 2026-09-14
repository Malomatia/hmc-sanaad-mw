/**
 * Language value object (i18n). Most Sanaad reads accept `lang=en|ar`.
 * Framework-free — safe to import from the domain layer.
 */
export type Lang = 'en' | 'ar';

export const DEFAULT_LANG: Lang = 'en';

export const SUPPORTED_LANGS: readonly Lang[] = ['en', 'ar'] as const;

export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'ar';
}

export function toLang(value: unknown): Lang {
  return isLang(value) ? value : DEFAULT_LANG;
}

/** Some Oracle procedures expect the long language form ("ENGLISH"/"ARABIC"). */
export function toOracleLanguage(lang: Lang): 'ENGLISH' | 'ARABIC' {
  return lang === 'ar' ? 'ARABIC' : 'ENGLISH';
}
