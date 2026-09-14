import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Lang } from '@core/i18n/lang.decorator';
import type { Lang as LangCode } from '@shared/domain/lang';
import { CurrentUser } from '@core/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { LangQueryDto } from '@shared/dto/lang-query.dto';
import { LovResponseDto } from '@shared/dto/lov-response.dto';
import { SubmitResultDto } from '@shared/dto/submit-result.dto';
import { VerifiedBody } from '@shared/dto/verified-body';
import { AddressService, PhoneService } from '../application/contact.service';
import {
  CreateAddressRequestDto,
  DeletePhoneRequestDto,
  UpdateAddressRequestDto,
  UpdatePhoneRequestDto,
} from './dto/contact.dto';

/** Contact endpoints (ops 25, 27, 28, 29, 30, 32). See Docs_Ai/API/README.md. */
@ApiTags('contact')
@ApiBearerAuth()
@Controller('contact')
export class ContactController {
  constructor(
    private readonly phone: PhoneService,
    private readonly address: AddressService,
  ) {}

  @Get('lov/phone-type')
  @ApiOperation({ summary: 'op 27 — Phone-type LOV', operationId: 'contact_phoneTypeLov' })
  @ApiOkResponse({ type: LovResponseDto })
  async phoneTypeLov(@Query() q: LangQueryDto): Promise<LovResponseDto> {
    return { items: await this.phone.phoneTypeLov(q.lang) };
  }

  @Post('phone')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 28 — Update phone number(s)', operationId: 'contact_upsertPhone' })
  @ApiOkResponse({ type: SubmitResultDto })
  // Verified against the database (p_success_flag = Y) once the parameters are
  // built as the PL/SQL collections the package declares. `phoneId` is required:
  // this procedure only updates existing phones.
  @VerifiedBody(
    UpdatePhoneRequestDto,
    { phones: [{ phoneId: '310129', phoneType: 'Qatar Mobile Number', phoneNumber: '55723893' }] },
    'Verified against staging. Replace phoneId/phoneNumber with your own — read the ids from GET /profile → phones[].phoneId.',
  )
  upsertPhone(
    @Body() dto: UpdatePhoneRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    return this.phone.upsert(dto.phones, user, lang);
  }

  @Post('phone/delete')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 32 — Delete phone', operationId: 'contact_deletePhone' })
  @ApiOkResponse({ type: SubmitResultDto })
  @VerifiedBody(
    DeletePhoneRequestDto,
    { phoneId: '310129', phoneType: 'Qatar Mobile Number', phoneNumber: '55723893' },
    'Shape verified; not executed on staging — the test user has a single real phone we will not delete. An unknown id answers successflag N "Phone ID doesnot exist".',
  )
  deletePhone(
    @Body() dto: DeletePhoneRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    return this.phone.delete(dto, user, lang);
  }

  @Post('address')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 29 — Create address', operationId: 'contact_createAddress' })
  @ApiOkResponse({ type: SubmitResultDto })
  // successflag S on staging. p_country is the country NAME ('Qatar'); the ISO
  // code is rejected with "Invalid Country", and an overlapping address of the
  // same type is refused — pick a type the employee does not already have.
  @VerifiedBody(
    CreateAddressRequestDto,
    {
      p_effective_date: '20260824',
      p_primary_flag: 'N',
      p_country: 'Qatar',
      p_address_type: 'Temporary Offer Address',
      p_address_line1: 'Building 45',
      p_town_or_city: 'Doha',
      p_po_box: '12345',
    },
    'Verified against staging (successflag S). Use an address type the employee does not already have, and a fresh p_effective_date.',
  )
  createAddress(
    @Body() body: CreateAddressRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    // Accepts the spec's CREATE_ADDRESS_PR body (p_* keys).
    return this.address.create(body, user, lang);
  }

  @Post('address/update')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 25 — Update address', operationId: 'contact_updateAddress' })
  @ApiOkResponse({ type: SubmitResultDto })
  // successflag S on staging. `p_address_type` must equal the target address's
  // OWN type, and the same p_effective_date cannot be reused for a second
  // update of that address (date-tracked → ORA-20001).
  @VerifiedBody(
    UpdateAddressRequestDto,
    {
      p_address_id: '1720601',
      p_effective_date: '20260824',
      p_address_type: 'Primary Home Country Address',
      p_country: 'Qatar',
      p_address_line1: 'Building 45',
    },
    'Verified against staging (successflag S). Use your own p_address_id (GET /profile → addresses) and a NEW p_effective_date each time.',
  )
  updateAddress(
    @Body() body: UpdateAddressRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    // Accepts the spec's UPDATE_ADDRESS_PR body (p_* keys, incl. p_address_id).
    return this.address.update(body, user, lang);
  }

  @Get('lov/country')
  @ApiOperation({ summary: 'op 30 — Country LOV', operationId: 'contact_countryLov' })
  @ApiOkResponse({ type: LovResponseDto })
  async countryLov(@Query() q: LangQueryDto): Promise<LovResponseDto> {
    return { items: await this.address.countryLov(q.lang) };
  }
}
