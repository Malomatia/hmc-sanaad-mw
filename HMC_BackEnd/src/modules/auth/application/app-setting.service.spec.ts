import { ConfigService } from '@nestjs/config';
import configuration, { AppSettingsConfig, DEFAULT_PRIVACY_POLICY_URL } from '@core/config/configuration';
import { AppSettingService } from './app-setting.service';

const makeService = (cfg: AppSettingsConfig) =>
  new AppSettingService({ getOrThrow: jest.fn().mockReturnValue(cfg) } as unknown as ConfigService);

describe('AppSettingService', () => {
  it('returns the configured terms & conditions and privacy policy values', () => {
    expect(
      makeService({
        termsAndConditionsStatus: true,
        termsAndConditionsUrl: 'https://example.com/terms',
        privacyPolicyUrl: 'https://example.com/privacy',
      }).get(),
    ).toEqual({
      terms_and_conditions_status: true,
      terms_and_conditions_url: 'https://example.com/terms',
      privacy_policy_url: 'https://example.com/privacy',
    });
  });

  it('returns false and an empty terms URL when unset', () => {
    expect(
      makeService({
        termsAndConditionsStatus: false,
        termsAndConditionsUrl: '',
        privacyPolicyUrl: DEFAULT_PRIVACY_POLICY_URL,
      }).get(),
    ).toEqual({
      terms_and_conditions_status: false,
      terms_and_conditions_url: '',
      privacy_policy_url: DEFAULT_PRIVACY_POLICY_URL,
    });
  });

  it('defaults the privacy policy URL to the Sanad page when PRIVACY_POLICY_URL is unset', () => {
    const previous = process.env.PRIVACY_POLICY_URL;
    delete process.env.PRIVACY_POLICY_URL;
    try {
      expect(configuration().appSettings.privacyPolicyUrl).toBe(
        'https://www.hamad.qa/EN/Sanad/Pages/Privacy-Policy.html',
      );
    } finally {
      if (previous !== undefined) process.env.PRIVACY_POLICY_URL = previous;
    }
  });
});
