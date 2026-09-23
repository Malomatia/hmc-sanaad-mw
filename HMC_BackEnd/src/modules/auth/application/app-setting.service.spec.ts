import { ConfigService } from '@nestjs/config';
import { AppSettingsConfig } from '@core/config/configuration';
import { AppSettingService } from './app-setting.service';

const makeService = (cfg: AppSettingsConfig) =>
  new AppSettingService({ getOrThrow: jest.fn().mockReturnValue(cfg) } as unknown as ConfigService);

describe('AppSettingService', () => {
  it('returns the configured terms & conditions values', () => {
    expect(
      makeService({
        termsAndConditionsStatus: true,
        termsAndConditionsUrl: 'https://example.com/terms',
      }).get(),
    ).toEqual({
      terms_and_conditions_status: true,
      terms_and_conditions_url: 'https://example.com/terms',
    });
  });

  it('returns false and an empty URL when unset', () => {
    expect(
      makeService({ termsAndConditionsStatus: false, termsAndConditionsUrl: '' }).get(),
    ).toEqual({ terms_and_conditions_status: false, terms_and_conditions_url: '' });
  });
});
