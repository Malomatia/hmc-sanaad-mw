import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiReadOkResponse } from '@shared/swagger/api-read-ok-response.decorator';
import { LeaveService } from '../application/leave.service';
import { LeaveRecordDto, LeavesQueryDto } from './dto/leave.dto';
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
