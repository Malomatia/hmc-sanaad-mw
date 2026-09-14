import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LovUserQueryDto } from '@shared/dto/common-query.dto';
import { ApiReadOkResponse } from '@shared/swagger/api-read-ok-response.decorator';
import { PayslipService } from '../application/payslip.service';
import { PayslipCountQueryDto, PayslipQueryDto } from './dto/payslip-query.dto';
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
