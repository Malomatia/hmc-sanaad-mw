import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { DEFAULT_LANG, Lang, SUPPORTED_LANGS } from '../domain/lang';

/** Base query DTO carrying the `lang` param (en|ar, default en). */
export class LangQueryDto {
  @ApiPropertyOptional({ enum: SUPPORTED_LANGS as unknown as string[], default: DEFAULT_LANG })
  @IsOptional()
  @IsIn(SUPPORTED_LANGS as unknown as string[])
  lang: Lang = DEFAULT_LANG;
}
