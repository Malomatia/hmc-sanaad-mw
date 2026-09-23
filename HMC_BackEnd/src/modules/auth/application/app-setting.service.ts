import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppSettingsConfig } from '@core/config/configuration';
import { AppSettingResponseDto } from '../interface/dto/app-setting.dto';

/** Public, env-driven app settings read by the mobile app before login. */
@Injectable()
export class AppSettingService {
  private readonly cfg: AppSettingsConfig;

  constructor(config: ConfigService) {
    this.cfg = config.getOrThrow<AppSettingsConfig>('appSettings');
  }

  get(): AppSettingResponseDto {
    return {
      terms_and_conditions_status: this.cfg.termsAndConditionsStatus,
      terms_and_conditions_url: this.cfg.termsAndConditionsUrl,
    };
  }
}
