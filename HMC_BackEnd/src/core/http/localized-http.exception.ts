import { HttpException } from '@nestjs/common';
import { Lang } from '@shared/domain/lang';

/**
 * An HttpException whose client message exists in every supported language.
 * AllExceptionsFilter answers with the one matching the request `lang`
 * (default `en`) and the given status; the category follows the status as for
 * any HttpException.
 */
export class LocalizedHttpException extends HttpException {
  constructor(
    readonly messages: Readonly<Record<Lang, string>>,
    status: number,
  ) {
    super(messages.en, status);
  }
}
