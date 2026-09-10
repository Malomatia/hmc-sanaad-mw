import { Body, Controller, Get, HttpCode, Post, Query, Version } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Lang } from '@core/i18n/lang.decorator';
import type { Lang as LangCode } from '@shared/domain/lang';
import { CurrentUser } from '@core/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { LangQueryDto } from '@shared/dto/lang-query.dto';
import { LovResponseDto } from '@shared/dto/lov-response.dto';
import { SubmitResultDto } from '@shared/dto/submit-result.dto';
import { SAMPLE_ATTACHMENT, VerifiedBody } from '@shared/dto/verified-body';
import { DependentService, PassportService } from '../application/dependents.service';
import {
  AddDependentRequestDto,
  DeleteDependentRequestDto,
  DependentLovQueryDto,
  PassportApplyRequestDto,
  UpdateDependentRequestDto,
} from './dto/dependents.dto';

/** Dependents endpoints (ops 24, 31, 33, 34, 49, 64, 65). See Docs_Ai/API/README.md. */
@ApiTags('dependents')
@ApiBearerAuth()
@Controller('dependents')
export class DependentsController {
  constructor(
    private readonly dependents: DependentService,
    private readonly passport: PassportService,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'op 65 — Add dependent', operationId: 'dependents_add' })
  @ApiOkResponse({ type: SubmitResultDto })
  // successflag S on 2026-08-23 with this exact flexfield combination
  // (p_relationship from the op 64 CONTACT group, visa type from
  // HMC_HR_VISA_TYPE_VS, unique QID, >= 1 attachment).
  @VerifiedBody(
    AddDependentRequestDto,
    {
      p_title: 'Mr',
      p_first_name: 'Testchild',
      p_last_name: 'Ibrahim',
      p_relationship: 'Child',
      p_gender: 'Male',
      p_date_of_birth: '20150101',
      p_national_identifier: '29912345678',
      p_id_number: '29912345678',
      p_id_expiry_date: '20301231',
      p_id_issue_date: '20200101',
      p_passport_number: 'B12345678',
      p_pp_issue_date: '20200101',
      p_pp_expiry_date: '20301231',
      p_place_of_issue: 'Doha',
      p_country_of_issue: 'QA',
      p_visa_type: 'Residence Permit',
      p_visa_number: '987654321',
      p_visa_issue_date: '20200101',
      p_visa_expiry_date: '20301231',
      p_visa_validity: 'Yes',
      p_type_of_sponsorship: 'Employee',
      p_phone_type: ['Qatar Mobile Number'],
      p_phone_number: ['55512345'],
      p_file_name1: 'birth-certificate.pdf',
      p_attachment1: SAMPLE_ATTACHMENT,
    },
    'Verified against staging (successflag S). Use a UNIQUE p_id_number — a duplicate QID is rejected with "This QID already exists." ' +
      'p_phone_type/p_phone_number are ARRAYS paired by index (PL/SQL my_type; added 2026-08-24, not part of the original verified run).',
  )
  add(
    @Body() body: AddDependentRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    // Accepts the spec's ADD_DEPENDENT_PR body (p_* keys, incl. address + phone).
    return this.dependents.add(body, user, lang);
  }

  @Post('update')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 24 — Update dependent', operationId: 'dependents_update' })
  @ApiOkResponse({ type: SubmitResultDto })
  // successflag S on 2026-08-24. The procedure re-validates the whole
  // flexfield, so this full body is the minimum that works; note
  // p_relation_ship is the MEANING here (delete wants the CODE).
  @VerifiedBody(
    UpdateDependentRequestDto,
    {
      p_dependent_id: '329302',
      p_relation_ship: 'Child',
      p_relation_ship_start_date: '20100923',
      p_title: 'Mr',
      p_first_name: 'Jerome',
      p_last_name: 'Ibrahim',
      p_gendar: 'Male',
      p_date_of_birth: '20100923',
      p_id_number: '28812345678',
      p_expiry_date: '20301231',
      p_date_of_issue_qid: '20200101',
      p_passport_number: 'A38697134',
      p_date_of_issue: '20200101',
      p_date_of_expire: '20301231',
      p_place_of_issue: 'Doha',
      p_country_of_issue: 'QA',
      p_visa_type: 'Residence Permit',
      p_visa_number: '123456789',
      p_date_of_issue_visa: '20200101',
      p_date_of_expire_visa: '20301231',
      p_visa_validy: 'Yes',
      p_type_of_sponsership: 'Employee',
      p_name_of_sponsor: 'Amir Sami Samir Ibrahim',
      p_phone_id: ['324324'],
      p_phone_type: ['Qatar Mobile Number'],
      p_phone_number: ['55512345'],
      p_file_name1: 'update-proof.pdf',
      p_attachment1: SAMPLE_ATTACHMENT,
    },
    'Verified against staging (successflag S) BEFORE the phone-array change. ' +
      'p_phone_id/p_phone_type/p_phone_number (and the p_*1 group) are ARRAYS paired by index ' +
      '(PL/SQL my_type; added 2026-08-24) — p_phone_id[i] is the phone that p_phone_type[i]/p_phone_number[i] update.',
  )
  update(
    @Body() body: UpdateDependentRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    // Accepts the spec's UPDATE_DEPENDENT_PR body (p_* keys, incl. p_dependent_id).
    return this.dependents.update(body, user, lang);
  }

  @Post('delete')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 31 — Delete dependent', operationId: 'dependents_delete' })
  @ApiOkResponse({ type: SubmitResultDto })
  // successflag S on 2026-08-24. p_relationship is the LOV CODE here ('C'),
  // which the procedure forwards to the HR API as the contact type.
  @VerifiedBody(
    DeleteDependentRequestDto,
    {
      p_dependent_id: '1607679',
      p_relationship: 'C',
      p_relationship_end_date: '20260824',
      p_file_name1: 'end-proof.pdf',
      p_attachment1: SAMPLE_ATTACHMENT,
    },
    'Verified against staging (successflag S). Replace p_dependent_id — running as-is ends a real contact relationship.',
  )
  delete(
    @Body() dto: DeleteDependentRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    const { p_dependent_id: dependentId, ...fields } = dto;
    return this.dependents.delete(dependentId, fields, user, lang);
  }

  @Get('lov')
  @ApiOperation({
    summary: 'op 64 — Dependent LOV (also the source for ADDRESS_TYPE / SPONSORSHIP / VISA)',
    operationId: 'dependents_lov',
  })
  @ApiOkResponse({ type: LovResponseDto })
  async dependentLov(@Query() q: DependentLovQueryDto): Promise<LovResponseDto> {
    return { items: await this.dependents.dependentLov(q.lang, q.data_type) };
  }

  @Get('passport/types')
  @ApiOperation({ summary: 'op 33 — Passport types', operationId: 'dependents_passportTypes' })
  @ApiOkResponse({ type: LovResponseDto })
  async passportTypes(@Query() q: LangQueryDto): Promise<LovResponseDto> {
    return { items: await this.passport.types(q.lang) };
  }

  @Post('passport/apply')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 34 — Passport detail request', operationId: 'dependents_passportApply' })
  @ApiOkResponse({ type: SubmitResultDto })
  // successflag S on staging. Passport type comes from GET
  // /dependents/passport/types; the country is the ISO code here.
  @VerifiedBody(PassportApplyRequestDto, {
    p_passport_number: 'A498989',
    p_date_of_issue: '20260121',
    p_date_of_expiry: '20360121',
    p_type_of_passport: 'Normal',
    p_place_of_issue: 'Doha',
    p_country_of_issue: 'QA',
  })
  passportApply(
    @Body() body: PassportApplyRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    // Accepts the spec's PASSPORT_DET_REQ_PR body (p_* keys, incl. attachments).
    return this.passport.apply(body, user, lang);
  }

  @Get('passport/issue-place')
  @ApiOperation({ summary: 'op 49 — Passport issue place LOV', operationId: 'dependents_issuePlaceLov' })
  @ApiOkResponse({ type: LovResponseDto })
  async issuePlaceLov(@Query() q: LangQueryDto): Promise<LovResponseDto> {
    return { items: await this.passport.issuePlaceLov(q.lang) };
  }

  @Post()
  @Version('2')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 65 — Add dependent', operationId: 'dependents_add_v2' })
  @ApiOkResponse({ type: SubmitResultDto })
  @VerifiedBody(
    AddDependentRequestDto,
    {
      p_title: 'Mr',
      p_first_name: 'Testchild',
      p_last_name: 'Ibrahim',
      p_relationship: 'Child',
      p_gender: 'Male',
      p_date_of_birth: '20150101',
      p_national_identifier: '29912345678',
      p_id_number: '29912345678',
      p_id_expiry_date: '20301231',
      p_id_issue_date: '20200101',
      p_passport_number: 'B12345678',
      p_pp_issue_date: '20200101',
      p_pp_expiry_date: '20301231',
      p_place_of_issue: 'Doha',
      p_country_of_issue: 'QA',
      p_visa_type: 'Residence Permit',
      p_visa_number: '987654321',
      p_visa_issue_date: '20200101',
      p_visa_expiry_date: '20301231',
      p_visa_validity: 'Yes',
      p_type_of_sponsorship: 'Employee',
      p_phone_type: ['Qatar Mobile Number'],
      p_phone_number: ['55512345'],
      p_file_name1: 'birth-certificate.pdf',
      p_attachment1: SAMPLE_ATTACHMENT,
    },
    'Verified against staging (successflag S). Use a UNIQUE p_id_number — a duplicate QID is rejected with "This QID already exists." ' +
      'p_phone_type/p_phone_number are ARRAYS paired by index (PL/SQL my_type; added 2026-08-24, not part of the original verified run).',
  )
  addV2(
    @Body() body: AddDependentRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    return this.add(body, user, lang);
  }

  @Post('update')
  @Version('2')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 24 — Update dependent', operationId: 'dependents_update_v2' })
  @ApiOkResponse({ type: SubmitResultDto })
  @VerifiedBody(
    UpdateDependentRequestDto,
    {
      p_dependent_id: '329302',
      p_relation_ship: 'Child',
      p_relation_ship_start_date: '20100923',
      p_title: 'Mr',
      p_first_name: 'Jerome',
      p_last_name: 'Ibrahim',
      p_gendar: 'Male',
      p_date_of_birth: '20100923',
      p_id_number: '28812345678',
      p_expiry_date: '20301231',
      p_date_of_issue_qid: '20200101',
      p_passport_number: 'A38697134',
      p_date_of_issue: '20200101',
      p_date_of_expire: '20301231',
      p_place_of_issue: 'Doha',
      p_country_of_issue: 'QA',
      p_visa_type: 'Residence Permit',
      p_visa_number: '123456789',
      p_date_of_issue_visa: '20200101',
      p_date_of_expire_visa: '20301231',
      p_visa_validy: 'Yes',
      p_type_of_sponsership: 'Employee',
      p_name_of_sponsor: 'Amir Sami Samir Ibrahim',
      p_phone_id: ['324324'],
      p_phone_type: ['Qatar Mobile Number'],
      p_phone_number: ['55512345'],
      p_file_name1: 'update-proof.pdf',
      p_attachment1: SAMPLE_ATTACHMENT,
    },
    'Verified against staging (successflag S) BEFORE the phone-array change. ' +
      'p_phone_id/p_phone_type/p_phone_number (and the p_*1 group) are ARRAYS paired by index ' +
      '(PL/SQL my_type; added 2026-08-24) — p_phone_id[i] is the phone that p_phone_type[i]/p_phone_number[i] update.',
  )
  updateV2(
    @Body() body: UpdateDependentRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    return this.update(body, user, lang);
  }

  @Post('delete')
  @Version('2')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 31 — Delete dependent', operationId: 'dependents_delete_v2' })
  @ApiOkResponse({ type: SubmitResultDto })
  @VerifiedBody(
    DeleteDependentRequestDto,
    {
      p_dependent_id: '1607679',
      p_relationship: 'C',
      p_relationship_end_date: '20260824',
      p_file_name1: 'end-proof.pdf',
      p_attachment1: SAMPLE_ATTACHMENT,
    },
    'Verified against staging (successflag S). Replace p_dependent_id — running as-is ends a real contact relationship.',
  )
  deleteV2(
    @Body() dto: DeleteDependentRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    return this.delete(dto, user, lang);
  }

  @Get('lov')
  @Version('2')
  @ApiOperation({
    summary: 'op 64 — Dependent LOV (also the source for ADDRESS_TYPE / SPONSORSHIP / VISA)',
    operationId: 'dependents_lov_v2',
  })
  @ApiOkResponse({ type: LovResponseDto })
  async dependentLovV2(@Query() q: DependentLovQueryDto): Promise<LovResponseDto> {
    return this.dependentLov(q);
  }

  @Get('passport/types')
  @Version('2')
  @ApiOperation({ summary: 'op 33 — Passport types', operationId: 'dependents_passportTypes_v2' })
  @ApiOkResponse({ type: LovResponseDto })
  async passportTypesV2(@Query() q: LangQueryDto): Promise<LovResponseDto> {
    return this.passportTypes(q);
  }

  @Post('passport/apply')
  @Version('2')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 34 — Passport detail request', operationId: 'dependents_passportApply_v2' })
  @ApiOkResponse({ type: SubmitResultDto })
  @VerifiedBody(PassportApplyRequestDto, {
    p_passport_number: 'A498989',
    p_date_of_issue: '20260121',
    p_date_of_expiry: '20360121',
    p_type_of_passport: 'Normal',
    p_place_of_issue: 'Doha',
    p_country_of_issue: 'QA',
  })
  passportApplyV2(
    @Body() body: PassportApplyRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    return this.passportApply(body, user, lang);
  }

  @Get('passport/issue-place')
  @Version('2')
  @ApiOperation({ summary: 'op 49 — Passport issue place LOV', operationId: 'dependents_issuePlaceLov_v2' })
  @ApiOkResponse({ type: LovResponseDto })
  async issuePlaceLovV2(@Query() q: LangQueryDto): Promise<LovResponseDto> {
    return this.issuePlaceLov(q);
  }
}
