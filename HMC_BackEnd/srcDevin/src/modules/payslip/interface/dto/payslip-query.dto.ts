import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { PersonIdQueryDto } from '@shared/dto/common-query.dto';

const PAY_PERIOD_REGEX =
  /^(January|February|March|April|May|June|July|August|September|October|November|December)\s\d{4}$/;

/** op 6 — `?person_id&lang&payslipperiod=August 2024` */
export class PayslipCountQueryDto extends PersonIdQueryDto {
  @ApiProperty({ example: 'August 2024' })
  @IsString()
  @Matches(PAY_PERIOD_REGEX, { message: 'payslipperiod must be "Month YYYY".' })
  payslipperiod!: string;
}

/** op 11 — `?person_id&lang&payperiod=January 2024&assignmentid=...` */
export class PayslipQueryDto extends PersonIdQueryDto {
  @ApiProperty({ example: 'January 2024' })
  @IsString()
  @Matches(PAY_PERIOD_REGEX, { message: 'payperiod must be "Month YYYY".' })
  payperiod!: string;

  @ApiProperty({ example: '7179444713' })
  @IsString()
  @IsNotEmpty()
  assignmentid!: string;
}
