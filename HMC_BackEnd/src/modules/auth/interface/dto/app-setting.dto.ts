import { ApiProperty } from '@nestjs/swagger';

export class AppSettingResponseDto {
  @ApiProperty({
    example: true,
    description: 'Whether the app must show the terms & conditions (TERMS_AND_CONDITIONS_STATUS).',
  })
  terms_and_conditions_status!: boolean;

  @ApiProperty({
    example: 'https://www.hamad.qa/sanaad/terms',
    description: 'Terms & conditions page URL (TERMS_AND_CONDITIONS_URL); empty when not configured.',
  })
  terms_and_conditions_url!: string;
}
