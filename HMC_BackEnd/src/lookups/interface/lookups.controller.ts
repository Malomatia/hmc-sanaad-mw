import { Controller, Get, Query, Version } from '@nestjs/common';
import { currentIdentity } from '@core/auth/current-identity';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { CurrentUser } from '@core/auth/decorators/current-user.decorator';
import { LangQueryDto } from '@shared/dto/lang-query.dto';
import { LovResponseDto } from '@shared/dto/lov-response.dto';
import { LookupsService } from '../application/lookups.service';
import {
  LovLookupQueryDto,
  LovLookupV2QueryDto,
  MasterLookupQueryDto,
} from './dto/lookup-query.dto';

/**
 * Shared LOV / master-lookup endpoints (ops 15, 26 + generic).
 * See Docs_Ai/API/README.md — Module: lookups.
 */
@ApiTags('lookups')
@ApiBearerAuth()
@Controller('lookups')
export class LookupsController {
  constructor(private readonly service: LookupsService) {}

  @Get('lov')
  @Version('2')
  @ApiOperation({ summary: 'Generic LOV read by name', operationId: 'lookups_lov_v2' })
  @ApiOkResponse({ type: LovResponseDto })
  async lovV2(
    @Query() q: LovLookupV2QueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LovResponseDto> {
    return { items: await this.service.getLovForCaller(q.lovname, q.lang, currentIdentity(user)) };
  }

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
  async lov(
    @Query() q: LovLookupQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LovResponseDto> {
    return {
      items: await this.service.getLov(q.lovname, q.lang, q.username, q.person_id, user?.username),
    };
  }

  @Get('master')
  @ApiOperation({ summary: 'Generic master-lookup read by name', operationId: 'lookups_master' })
  @ApiOkResponse({ type: LovResponseDto })
  async master(@Query() q: MasterLookupQueryDto): Promise<LovResponseDto> {
    return { items: await this.service.getMaster(q.lookupname, q.lang) };
  }

  @Get('yes-no')
  @Version('2')
  @ApiOperation({ summary: 'op 15 — Yes/No LOV', operationId: 'lookups_yesNo_v2' })
  @ApiOkResponse({ type: LovResponseDto })
  async yesNoV2(@Query() q: LangQueryDto): Promise<LovResponseDto> {
    return this.yesNo(q);
  }

  @Get('rfmi-user')
  @Version('2')
  @ApiOperation({ summary: 'op 26 — RFMI user LOV', operationId: 'lookups_rfmiUser_v2' })
  @ApiOkResponse({ type: LovResponseDto })
  async rfmiUserV2(@Query() q: LangQueryDto): Promise<LovResponseDto> {
    return this.rfmiUser(q);
  }

  @Get('master')
  @Version('2')
  @ApiOperation({ summary: 'Generic master-lookup read by name', operationId: 'lookups_master_v2' })
  @ApiOkResponse({ type: LovResponseDto })
  async masterV2(@Query() q: MasterLookupQueryDto): Promise<LovResponseDto> {
    return this.master(q);
  }
}
