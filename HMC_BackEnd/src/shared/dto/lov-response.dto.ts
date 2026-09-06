import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LovItem } from '../domain/lov-item';

export class LovItemDto implements LovItem {
  @ApiProperty({ example: 'M' })
  code!: string;

  @ApiProperty({ example: 'Married' })
  meaning!: string;

  @ApiPropertyOptional({ example: 'متزوج' })
  meaningAr?: string;

  @ApiProperty({
    example: 'Married',
    description:
      'The English meaning, always — regardless of lang. Submit procedures expect English values; bind this field back on submits.',
  })
  used_value!: string;

  @ApiPropertyOptional({
    example: 'CONTACT',
    description: 'Grouping type, returned by the multi-type LOVs (e.g. DEP_LOOKUP_LOV).',
  })
  type?: string;

  @ApiPropertyOptional({
    example: '56949953',
    description:
      "The row's record id, present only where a submit binds the id instead of the label — " +
      'today the return-from-leave LOV (op 55), whose id goes to op 56 `p_leave_details`. ' +
      'Additive: `code`/`meaning`/`used_value` are unchanged.',
  })
  id?: string;

  @ApiPropertyOptional({
    example: 'English',
    description:
      'The row\'s DESCRIPTION, when it is not the label. On the letter-name LOV (op 16) it is ' +
      'the ONE language that letter exists in — op 17 looks the letter up by name AND language, ' +
      'so send this as `p_letter_language`. Not localized; it is a value to send back, not to display.',
  })
  description?: string;
}

export class LovResponseDto {
  @ApiProperty({ type: [LovItemDto] })
  items!: LovItemDto[];
}
