import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Lang } from '@core/i18n/lang.decorator';
import type { Lang as LangCode } from '@shared/domain/lang';
import { CurrentUser } from '@core/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { LangQueryDto } from '@shared/dto/lang-query.dto';
import { LovResponseDto } from '@shared/dto/lov-response.dto';
import { SubmitResultDto } from '@shared/dto/submit-result.dto';
import { SAMPLE_ATTACHMENT, VerifiedBody } from '@shared/dto/verified-body';
import { SchoolFeeService } from '../application/school-fees.service';
import {
  SchoolChildrenQueryDto,
  SchoolFeeApplyRequestDto,
  SchoolLovQueryDto,
} from './dto/school-fees.dto';

/** School-fees endpoints (ops 37, 38, 39, 40, 50, 52, 53). op 51 is out of scope. */
@ApiTags('school-fees')
@ApiBearerAuth()
@Controller('school-fees')
export class SchoolFeesController {
  constructor(private readonly service: SchoolFeeService) {}

  @Post('apply')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 39 — School-fee request', operationId: 'schoolFees_apply' })
  @ApiOkResponse({ type: SubmitResultDto })
  // Exactly the payload that returned successflag S on 2026-08-24. Note
  // p_child_name: it is the composite DOB value from GET /school-fees/children
  // (Name||Gender||DD-MON-YY), not a name — see the DTO doc.
  @VerifiedBody(SchoolFeeApplyRequestDto, {
    p_academic_year: '2025-2026',
    p_acd_st_dt: '20250901',
    p_acd_end_dt: '20260630',
    p_child_name: 'Jerome Amir Sami Samir Ibrahim||Male||23-SEP-10',
    p_child_date_birth: '20100923',
    p_school_name: 'Al Arqam Academy',
    p_educational_stage: 'Primary',
    p_request_type: 'Cash',
    p_term: 'Term1',
    p_amount: '1000',
    p_receipt_number: '123',
    p_spouse_working: 'No',
    p_file_name1: 'receipt.pdf',
    p_attachment1: SAMPLE_ATTACHMENT,
  })
  apply(
    @Body() body: SchoolFeeApplyRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    // Accepts the spec's SCHOOL_FEE_PR body (p_* keys, incl. attachments).
    return this.service.apply(body, user, lang);
  }

  @Get('lov/schools')
  @ApiOperation({ summary: 'op 37 — School name LOV', operationId: 'schoolFees_schoolsLov' })
  @ApiOkResponse({ type: LovResponseDto })
  async schools(@Query() q: SchoolLovQueryDto): Promise<LovResponseDto> {
    return {
      items: await this.service.schoolsLov(q.lang, q.username, {
        search: q.search,
        offset: (q.page - 1) * q.pageSize,
        limit: q.pageSize,
      }),
    };
  }

  @Get('lov/terms')
  @ApiOperation({ summary: 'op 38 — School term LOV', operationId: 'schoolFees_termsLov' })
  @ApiOkResponse({ type: LovResponseDto })
  async terms(@Query() q: LangQueryDto): Promise<LovResponseDto> {
    return { items: await this.service.termsLov(q.lang) };
  }

  @Get('lov/edu-stage')
  @ApiOperation({ summary: 'op 40 — Education stage LOV', operationId: 'schoolFees_eduStageLov' })
  @ApiOkResponse({ type: LovResponseDto })
  async eduStage(@Query() q: LangQueryDto): Promise<LovResponseDto> {
    return { items: await this.service.eduStageLov(q.lang) };
  }

  @Get('lov/academic-year')
  @ApiOperation({ summary: 'op 50 — Academic year LOV', operationId: 'schoolFees_academicYearLov' })
  @ApiOkResponse({ type: LovResponseDto })
  async academicYear(@Query() q: LangQueryDto): Promise<LovResponseDto> {
    return { items: await this.service.academicYearLov(q.lang) };
  }

  @Get('lov/request-type')
  @ApiOperation({ summary: 'op 53 — Request type LOV', operationId: 'schoolFees_requestTypeLov' })
  @ApiOkResponse({ type: LovResponseDto })
  async requestType(@Query() q: SchoolLovQueryDto): Promise<LovResponseDto> {
    return { items: await this.service.requestTypeLov(q.lang, q.username) };
  }

  @Get('children')
  @ApiOperation({ summary: 'op 52 — Child details', operationId: 'schoolFees_children' })
  children(@Query() q: SchoolChildrenQueryDto, @CurrentUser() user: AuthenticatedUser) {
    // CHILD_DETS_VIEW's p_user_name takes the USERNAME, not the employee number
    // (confirmed by the DB team — '053613' returned no rows / PLS-00221 attempts).
    return this.service.children(user.username, q.acadyrstrtdt, q.lang);
  }
}
