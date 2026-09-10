import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { LovUserQueryDto } from '@shared/dto/common-query.dto';

/**
 * op 35 — GET /employee/supervisor/views?username=&lang=&searchKeyWord=
 * `searchKeyWord` filters the supervisor employee list by GLOBAL_NAME
 * (case-insensitive contains, applied Oracle-side before the row cap).
 */
export class SupervisorViewsQueryDto extends LovUserQueryDto {
  @ApiPropertyOptional({
    example: 'Vandana',
    description: 'Case-insensitive substring filter on GLOBAL_NAME in the delegate employee view.',
  })
  @IsOptional()
  @IsString()
  searchKeyWord?: string;
}

export class SupervisorViewsV2QueryDto extends OmitType(SupervisorViewsQueryDto, [
  'username',
] as const) {}
