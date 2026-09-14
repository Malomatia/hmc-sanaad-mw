import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ErrorCategory } from '../../http/error-category';

/** Query filters shared by GET /api-logs and its /errors, /success, /slow shortcuts. */
export class ApiLogQueryDto {
  @IsOptional()
  @IsString()
  requestId?: string;

  @IsOptional()
  @IsString()
  method?: string;

  @IsOptional()
  @IsString()
  endpoint?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  statusCode?: number;

  // `@Type(() => Boolean)` would treat the string "false" as truthy — convert explicitly instead.
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === true || value === 'true'))
  @IsBoolean()
  success?: boolean;

  @IsOptional()
  @IsIn(Object.values(ErrorCategory))
  errorCategory?: ErrorCategory;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minDurationMs?: number;

  @IsOptional()
  @IsString()
  since?: string;

  @IsOptional()
  @IsString()
  until?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @IsOptional()
  @IsIn(['timestamp', 'responseTimeMs'])
  sortBy?: 'timestamp' | 'responseTimeMs';
}
