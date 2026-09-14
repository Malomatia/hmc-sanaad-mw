import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** op 17 — LetterReqSubmit (placeholder fields; TODO(bind)). */
export class LetterReqSubmitDto {
  @ApiProperty({ example: 'EMPLOYMENT', description: 'Letter type/name code.' })
  @IsString()
  letterName!: string;

  @ApiPropertyOptional({ example: 'en', description: 'Letter language code.' })
  @IsOptional()
  @IsString()
  letterLanguage?: string;

  @ApiPropertyOptional({ example: 'HMC-HQ', description: 'Delivery location code.' })
  @IsOptional()
  @IsString()
  deliveryLocation?: string;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  copies?: number;
}
