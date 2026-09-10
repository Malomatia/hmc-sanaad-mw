import { Controller, Get, Query, Version } from '@nestjs/common';
import { requireIdentity } from '@core/auth/current-identity';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { CurrentUser } from '@core/auth/decorators/current-user.decorator';
import { LangQueryDto } from '@shared/dto/lang-query.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LovUserQueryDto } from '@shared/dto/common-query.dto';
import { ApiReadOkResponse } from '@shared/swagger/api-read-ok-response.decorator';
import { PayslipService } from '../application/payslip.service';
import {
  PayslipCountQueryDto,
  PayslipCountV2QueryDto,
  PayslipQueryDto,
  PayslipV2QueryDto,
} from './dto/payslip-query.dto';
import {
  PAYSLIP_COUNT_EXAMPLE,
  PAYSLIP_GENERATE_EXAMPLE,
  PAYSLIP_PERIODS_EXAMPLE,
} from './payslip.examples';

/** Payslip endpoints (ops 5, 6, 11). See Docs_Ai/API/README.md. */
@ApiTags('payslip')
@ApiBearerAuth()
@Controller('payslip')
export class PayslipController {
  constructor(private readonly service: PayslipService) {}

  @Get('periods')
  @Version('2')
  @ApiOperation({ summary: 'op 5 — Payslip periods', operationId: 'payslip_periods_v2' })
  @ApiReadOkResponse({ example: PAYSLIP_PERIODS_EXAMPLE })
  periodsV2(@Query() q: LangQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.getPeriods(requireIdentity(user, 'username'), q.lang);
  }

  @Get('count')
  @Version('2')
  @ApiOperation({ summary: 'op 6 — Payslip count for a period', operationId: 'payslip_count_v2' })
  @ApiReadOkResponse({ example: PAYSLIP_COUNT_EXAMPLE })
  countV2(@Query() q: PayslipCountV2QueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.checkCount(requireIdentity(user, 'personId'), q.lang, q.payslipperiod);
  }

  @Get()
  @Version('2')
  @ApiOperation({ summary: 'op 11 — Generate payslip', operationId: 'payslip_generate_v2' })
  @ApiReadOkResponse({ example: PAYSLIP_GENERATE_EXAMPLE })
  generateV2(@Query() q: PayslipV2QueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.generate(requireIdentity(user, 'personId'), q.lang, q.payperiod, q.assignmentid);
  }

  @Get('periods')
  @ApiOperation({ summary: 'op 5 — Payslip periods', operationId: 'payslip_periods' })
  @ApiReadOkResponse({ example: PAYSLIP_PERIODS_EXAMPLE })
  periods(@Query() q: LovUserQueryDto) {
    return this.service.getPeriods(q.username, q.lang);
  }

  @Get('count')
  @ApiOperation({ summary: 'op 6 — Payslip count for a period', operationId: 'payslip_count' })
  @ApiReadOkResponse({ example: PAYSLIP_COUNT_EXAMPLE })
  count(@Query() q: PayslipCountQueryDto) {
    return this.service.checkCount(q.person_id, q.lang, q.payslipperiod);
  }

  @Get()
  @ApiOperation({ summary: 'op 11 — Generate payslip', operationId: 'payslip_generate' })
  @ApiReadOkResponse({ example: PAYSLIP_GENERATE_EXAMPLE })
  generate(@Query() q: PayslipQueryDto) {
    return this.service.generate(q.person_id, q.lang, q.payperiod, q.assignmentid);
  }
}
