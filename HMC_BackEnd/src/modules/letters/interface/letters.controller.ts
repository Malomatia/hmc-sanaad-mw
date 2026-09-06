import { Body, Controller, Get, Post, Query, HttpCode } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Lang } from '@core/i18n/lang.decorator';
import type { Lang as LangCode } from '@shared/domain/lang';
import { CurrentUser } from '@core/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { ProfileQueryDto } from '@shared/dto/common-query.dto';
import { SubmitResultDto } from '@shared/dto/submit-result.dto';
import { ApiReadOkResponse } from '@shared/swagger/api-read-ok-response.decorator';
import { VerifiedBody } from '@shared/dto/verified-body';
import { LettersService } from '../application/letters.service';
import { LetterApplyRequestDto } from './dto/letters.dto';
import { LETTERS_LOV_EXAMPLE } from './letters.examples';

/** Letters endpoints (ops 16, 17). See Docs_Ai/API/README.md. */
@ApiTags('letters')
@ApiBearerAuth()
@Controller('letters')
export class LettersController {
  constructor(private readonly service: LettersService) {}

  /**
   * The authenticated username is passed alongside `?enum=` because
   * LETTER_MOBILE_NO_LOV keys on the login, not the employee number: op 16 is
   * documented with `?enum=`, so `mobileNo` came back empty and op 17 had no
   * legal `p_mobile_number` to send. Both forms go to the view and whichever
   * it uses matches.
   */
  @Get('lov')
  @ApiOperation({ summary: 'op 16 — Letter request LOVs', operationId: 'letters_lov' })
  @ApiReadOkResponse({ example: LETTERS_LOV_EXAMPLE })
  lov(@Query() q: ProfileQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.getLetterLovs(q.lang, q.enum, user.username);
  }

  @Post('apply')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 17 — Submit letter request', operationId: 'letters_apply' })
  @ApiOkResponse({ type: SubmitResultDto })
  // NOTE what is NOT here: `p_country`. It only applies to the "Passage to
  // Saudi Arabia" letter, and sending it with any other letter guarantees
  // ORA-01403. The name/language pair must also match — see the DTO doc.
  @VerifiedBody(
    LetterApplyRequestDto,
    {
      p_letter_language: 'English',
      p_letter_name: 'Bank letter with details with effective date',
      p_no_of_copies: '1',
      p_mobile_number: '55723893',
      p_letter_delivery_loc: 'Al Wakra Hospital',
      p_purpose_comments: 'test',
    },
    'Payload rules verified from the procedure source; p_mobile_number must be an existing mobile of the employee (GET /letters/lov → mobileNo).',
  )
  apply(
    @Body() body: LetterApplyRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    // Accepts the spec's HR_EMPLYMNT_LTR_PR body (p_* keys).
    return this.service.submit(body, user, lang);
  }
}
