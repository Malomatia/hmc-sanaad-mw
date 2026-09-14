import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** op 44 — Book appointment (validate + create). Placeholder fields; TODO(cerner). */
export class BookAppointmentRequestDto {
  @ApiProperty({ example: 'CLINIC-001', description: 'Cerner clinic id.' })
  @IsString()
  clinicId!: string;

  @ApiProperty({ example: 'LOC-001', description: 'Cerner location id.' })
  @IsString()
  locationId!: string;

  @ApiPropertyOptional({ example: 'SVC-001', description: 'Medical service id.' })
  @IsOptional()
  @IsString()
  serviceId?: string;

  @ApiProperty({ example: '2026-09-01T09:30:00', description: 'Requested slot (ISO).' })
  @IsString()
  slot!: string;
}
