import { Body, Controller, Get, Post, Query, HttpCode } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Lang } from '@core/i18n/lang.decorator';
import type { Lang as LangCode } from '@shared/domain/lang';
import { CurrentUser } from '@core/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { LovUserQueryDto, ProfileQueryDto } from '@shared/dto/common-query.dto';
import { ApiReadOkResponse } from '@shared/swagger/api-read-ok-response.decorator';
import { ApiActionOkResponse } from '@shared/swagger/api-action-ok-response.decorator';
import { EmployeeService, SupervisorService } from '../application/employee.service';
import { SupervisorUpdateRequestDto } from './dto/supervisor-update.request.dto';
import { SupervisorViewsQueryDto } from './dto/supervisor-views.query.dto';
import {
  EMPLOYEE_EMPLOYMENT_EXAMPLE,
  EMPLOYEE_EMPLOYMENT_INFO_EXAMPLE,
  EMPLOYEE_PERFORMANCE_EXAMPLE,
  EMPLOYEE_SUPERVISOR_UPDATE_BODY,
  EMPLOYEE_SUPERVISOR_UPDATE_EXAMPLE,
  EMPLOYEE_SUPERVISOR_VIEWS_EXAMPLE,
} from './employee.examples';

/** Employee endpoints (ops 3, 7, 8, 35, 36). See Docs_Ai/API/README.md. */
@ApiTags('employee')
@ApiBearerAuth()
@Controller('employee')
export class EmployeeController {
  constructor(
    private readonly employee: EmployeeService,
    private readonly supervisor: SupervisorService,
  ) {}

  @Get('employment')
  @ApiOperation({
    summary: 'op 3 — Employee (employment) details + salary/assignment history',
    operationId: 'employee_employment',
  })
  @ApiReadOkResponse({ example: EMPLOYEE_EMPLOYMENT_INFO_EXAMPLE })
  employment(@Query() q: LovUserQueryDto) {
    // Keyed by username (was `enum`) and aggregates EMPLOYMENT_DETAILS_V +
    // SALARY_V + EMPLOYMENT_V (client request 2026-08-24).
    return this.employee.employment(q.username, q.lang);
  }

  @Get('basic')
  @ApiOperation({ summary: 'op 8 — Basic employee info', operationId: 'employee_basic' })
  @ApiReadOkResponse({ example: EMPLOYEE_EMPLOYMENT_EXAMPLE })
  basic(@Query() q: ProfileQueryDto) {
    return this.employee.basic(q.enum, q.lang);
  }

  @Get('performance')
  @ApiOperation({ summary: 'op 7 — Performance records', operationId: 'employee_performance' })
  @ApiReadOkResponse({ example: EMPLOYEE_PERFORMANCE_EXAMPLE })
  performance(@Query() q: LovUserQueryDto) {
    return this.employee.performance(q.username, q.lang);
  }

  @Get('supervisor/views')
  @ApiOperation({ summary: 'op 35 — Supervisor view', operationId: 'employee_supervisorViews' })
  @ApiReadOkResponse({ example: EMPLOYEE_SUPERVISOR_VIEWS_EXAMPLE })
  supervisorViews(@Query() q: SupervisorViewsQueryDto) {
    return this.supervisor.views(q.username, q.lang, q.searchKeyWord);
  }

  @Post('supervisor')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 36 — Supervisor update', operationId: 'employee_supervisorUpdate' })
  @ApiBody(EMPLOYEE_SUPERVISOR_UPDATE_BODY)
  @ApiActionOkResponse({ example: EMPLOYEE_SUPERVISOR_UPDATE_EXAMPLE })
  supervisorUpdate(
    @Body() body: SupervisorUpdateRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    // Accepts the spec's SUPERVISOR_PR body (p_* keys, incl. attachments).
    return this.supervisor.update(body, user, lang);
  }
}
