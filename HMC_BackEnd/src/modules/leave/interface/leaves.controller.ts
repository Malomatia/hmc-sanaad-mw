import { Controller, Get, Query, Version } from '@nestjs/common';
import { requireIdentity } from '@core/auth/current-identity';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { CurrentUser } from '@core/auth/decorators/current-user.decorator';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiReadOkResponse } from '@shared/swagger/api-read-ok-response.decorator';
import { LeaveService } from '../application/leave.service';
import { LeaveRecordDto, LeavesQueryDto, LeavesV2QueryDto } from './dto/leave.dto';
import { LEAVES_LIST_EXAMPLE } from './leave.examples';

/**
 * GET /leaves — the user's leave history from ABSENCE_V, filtered by
 * `user_name` and optionally `leave_type`. Lives in the leave module but on
 * its own `leaves` route (the requested public path), not under `/leave`.
 */
@ApiTags('leave')
@ApiBearerAuth()
@Controller('leaves')
export class LeavesController {
  constructor(private readonly service: LeaveService) {}

  @Get()
  @Version('2')
  @ApiOperation({
    summary: 'Leave history (ABSENCE_V) — ?leave_type=&lang=',
    operationId: 'leave_list_v2',
  })
  @ApiOkResponse({ type: [LeaveRecordDto] })
  @ApiReadOkResponse({ example: LEAVES_LIST_EXAMPLE })
  listV2(@Query() q: LeavesV2QueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.listLeaves(requireIdentity(user, 'username'), q.leave_type);
  }

  @Get()
  @ApiOperation({
    summary: 'Leave history (ABSENCE_V) — ?user_name=&leave_type=&lang=',
    operationId: 'leave_list',
  })
  @ApiOkResponse({ type: [LeaveRecordDto] })
  @ApiReadOkResponse({ example: LEAVES_LIST_EXAMPLE })
  list(@Query() q: LeavesQueryDto) {
    return this.service.listLeaves(q.user_name, q.leave_type);
  }
}
