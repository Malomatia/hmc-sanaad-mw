import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { defineOptionalStringFields, RequiredString } from '@shared/dto/oracle-submit.dto';

export class PhoneItemDto {
  @ApiProperty({
    example: '310129',
    description:
      'Existing phone id — REQUIRED. Despite its name ADD_OR_UPDATE_PHONE only updates ' +
      'existing rows; read the ids from GET /profile → phones[].phoneId.',
  })
  @IsString()
  @IsNotEmpty()
  phoneId!: string;

  @ApiPropertyOptional({
    example: '1',
    description: 'Object version number. Optional — the procedure re-reads the row version.',
  })
  @IsOptional()
  @IsString()
  objectVersionNumber?: string;

  @ApiProperty({
    example: 'Qatar Mobile Number',
    description: 'Exact phone-type LOV meaning (GET /contact/lov/phone-type → meaning).',
  })
  @IsString()
  @IsNotEmpty()
  phoneType!: string;

  @ApiProperty({ example: '55723893' })
  @IsString()
  @IsNotEmpty()
  phoneNumber!: string;
}

/**
 * op 28 — UPDATE_PHONE_NUMBER (PHONE_PKG.ADD_OR_UPDATE_PHONE).
 *
 * Verified against the database on 2026-08-24 (successflag Y) after reading the
 * package spec: the four value parameters are `ETSND_VARCHAR` COLLECTIONS
 * (`TABLE OF NVARCHAR2(4000) INDEX BY PLS_INTEGER`), not scalars, and the
 * package's own `str_to_type()` builds them from a COMMA-separated string. The
 * whole `phones` array therefore goes to Oracle in a single call, index-aligned.
 *
 * Binding scalars — what we did before — produced an EMPTY collection, which
 * the package reported as "Phone type doesnot exist" for every value; the type
 * was never the problem. Because `str_to_type` drops empty tokens there is no
 * way to express a NEW phone, so `phoneId` is required per item (raised with
 * the DB team: creating a phone needs another entry point).
 */
export class UpdatePhoneRequestDto {
  @ApiProperty({ type: [PhoneItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PhoneItemDto)
  phones!: PhoneItemDto[];
}

/** op 32 — DELETE_PHONE_DETAILS_SUBMIT (DEL_PHONE_NUMBER_PR). */
export class DeletePhoneRequestDto {
  @ApiProperty({ example: '1574794', description: 'Existing phone id of the user (see GET /profile → phones[].phoneId).' })
  @IsString()
  @IsNotEmpty()
  phoneId!: string;

  @ApiPropertyOptional({ example: 'Qatar Mobile Number', description: 'Type of the phone to delete.' })
  @IsOptional()
  @IsString()
  phoneType?: string;

  @ApiPropertyOptional({ example: '+97455512345', description: 'Number of the phone to delete.' })
  @IsOptional()
  @IsString()
  phoneNumber?: string;
}

/**
 * op 29 — CREATE_ADDRESS_PR. Example values are pinned to a combination
 * confirmed to work end-to-end against staging (2026-08-23: successflag S
 * with `Temporary Offer Address`). Rules verified live: `p_country` is the
 * country NAME from the op 30 LOV (`Qatar`, not `QA`), and creating a second
 * address of a type whose date range overlaps an existing one fails with
 * "You have already created an address ... which overlaps this date range".
 */
export class CreateAddressRequestDto {
  @RequiredString('20260823')
  p_effective_date!: string;

  @RequiredString('N')
  p_primary_flag!: string;

  @RequiredString(
    'Qatar',
    'Country NAME from GET /contact/lov/country (`used_value`), e.g. "Qatar". The ISO ' +
      'code "QA" is rejected with "Invalid Country".',
  )
  p_country!: string;

  @RequiredString(
    'Temporary Offer Address',
    'From GET /dependents/lov?data_type=ADDRESS_TYPE (op 64 — there is no separate ' +
      'address-type endpoint). Valid values: HMC Accommodation Address | Primary Home ' +
      'Country Address | Primary Local Address | Recruiting | Temporary Offer Address. ' +
      'Anything else (e.g. "Work Location Address") does not exist.',
  )
  p_address_type!: string;

  @RequiredString('Building 45')
  p_address_line1!: string;

  [key: string]: unknown;
}

defineOptionalStringFields(
  CreateAddressRequestDto,
  ['p_main_address', 'p_address_line2', 'p_address_line3', 'p_town_or_city', 'p_region1', 'p_region2', 'p_region3', 'p_po_box'],
  {
    p_main_address: 'Al Sadd Street',
    p_address_line2: 'Street 12',
    p_address_line3: 'Zone 60',
    p_town_or_city: 'Doha',
    p_region1: 'Al Rayyan',
    p_region2: '',
    p_region3: '',
    p_po_box: '12345',
  },
);

/**
 * op 25 — UPD_ADDRESS_PR. Rules verified live on staging (2026-08-23,
 * successflag S with the pinned example): `p_address_id` must be an address
 * the caller OWNS (GET /profile → outsideAddresses[].addressId),
 * `p_address_type` must match that address's own type, `p_country` takes the
 * country NAME (`Qatar`; the 2-letter `QA` returns "Invalid Country"), and
 * Oracle date-tracks the change — repeating the same update with the same
 * `p_effective_date` fails, so use a fresh effective date per update.
 *
 * Address-type values come from `GET /dependents/lov?data_type=ADDRESS_TYPE`
 * (there is no separate address-type endpoint): `HMC Accommodation Address`,
 * `Primary Home Country Address`, `Primary Local Address`, `Recruiting`,
 * `Temporary Offer Address`.
 */
export class UpdateAddressRequestDto {
  @RequiredString('1720601')
  p_address_id!: string;

  @RequiredString('20260823')
  p_effective_date!: string;

  [key: string]: unknown;
}

defineOptionalStringFields(
  UpdateAddressRequestDto,
  [
    'p_address_line1',
    'p_address_line2',
    'p_address_line3',
    'p_city',
    'p_region1',
    'p_region2',
    'p_region3',
    'p_po_box',
    'p_address_type',
    'p_country',
  ],
  {
    p_address_type: 'Primary Home Country Address',
    p_country: 'Qatar',
    p_address_line1: 'Building 45',
  },
);
