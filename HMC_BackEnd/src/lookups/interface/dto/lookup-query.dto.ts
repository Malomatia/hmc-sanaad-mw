import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { LangQueryDto } from '@shared/dto/lang-query.dto';

/** `/lookups/lov?lovname=...&lang=...[&username=...]` */
export class LovLookupQueryDto extends LangQueryDto {
  @ApiProperty({ example: 'EMP_MARITAL_LOV', description: 'Public LOV name (allow-listed).' })
  @IsString()
  @IsNotEmpty()
  lovname!: string;

  @ApiPropertyOptional({ example: 'V-NFERNANDO', description: 'User-scoped LOVs only.' })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({
    example: '852709',
    description:
      'Oracle PERSON_ID — filters person-scoped LOV views (WHERE PERSON_ID = :person_id); ' +
      'ignored when the view has no PERSON_ID column.',
  })
  @IsOptional()
  @IsString()
  person_id?: string;
}

/** `/lookups/master?lookupname=...&lang=...` */
export class MasterLookupQueryDto extends LangQueryDto {
  @ApiProperty({ example: 'GetLeaveType', description: 'Master lookup name (non-Cerner).' })
  @IsString()
  @IsNotEmpty()
  lookupname!: string;
}
