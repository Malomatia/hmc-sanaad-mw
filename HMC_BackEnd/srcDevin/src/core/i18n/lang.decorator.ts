import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { toLang } from '@shared/domain/lang';
import type { Lang as LangCode } from '@shared/domain/lang';

/**
 * Resolves the request language from `?lang=en|ar` or the `lang` header
 * (query wins; default `en`). The header form is what the mobile auth
 * journey sends (client request 2026-09-06).
 * Usage: `method(@Lang() lang: Lang)`.
 */
export const Lang = createParamDecorator((_data: unknown, ctx: ExecutionContext): LangCode => {
  const req = ctx
    .switchToHttp()
    .getRequest<{ query?: { lang?: string }; headers?: Record<string, unknown> }>();
  const header = req.headers?.lang;
  return toLang(req.query?.lang ?? (Array.isArray(header) ? header[0] : header));
});
