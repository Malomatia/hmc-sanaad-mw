import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LangQueryDto } from '@shared/dto/lang-query.dto';
import { LovResponseDto } from '@shared/dto/lov-response.dto';
import { LookupsService } from '../application/lookups.service';
import { LovLookupQueryDto, MasterLookupQueryDto } from './dto/lookup-query.dto';

/**
 * Shared LOV / master-lookup endpoints (ops 15, 26 + generic).
 * See Docs_Ai/API/README.md — Module: lookups.
 */
@ApiTags('lookups')
@ApiBearerAuth()
@Controller('lookups')
export class LookupsController {
  constructor(private readonly service: LookupsService) {}

  @Get('yes-no')
  @ApiOperation({ summary: 'op 15 — Yes/No LOV', operationId: 'lookups_yesNo' })
  @ApiOkResponse({ type: LovResponseDto })
  async yesNo(@Query() q: LangQueryDto): Promise<LovResponseDto> {
    return { items: await this.service.yesNo(q.lang) };
  }

  @Get('rfmi-user')
  @ApiOperation({ summary: 'op 26 — RFMI user LOV', operationId: 'lookups_rfmiUser' })
  @ApiOkResponse({ type: LovResponseDto })
  async rfmiUser(@Query() q: LangQueryDto): Promise<LovResponseDto> {
    return { items: await this.service.rfmiUser(q.lang) };
  }

  @Get('lov')
  @ApiOperation({ summary: 'Generic LOV read by name', operationId: 'lookups_lov' })
  @ApiOkResponse({ type: LovResponseDto })
  async lov(@Query() q: LovLookupQueryDto): Promise<LovResponseDto> {
    return { items: await this.service.getLov(q.lovname, q.lang, q.username, q.person_id) };
  }

  @Get('master')
  @ApiOperation({ summary: 'Generic master-lookup read by name', operationId: 'lookups_master' })
  @ApiOkResponse({ type: LovResponseDto })
  async master(@Query() q: MasterLookupQueryDto): Promise<LovResponseDto> {
    return { items: await this.service.getMaster(q.lookupname, q.lang) };
  }
}
