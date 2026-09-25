import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { DiagnosticsConfig } from '../config/configuration';

/**
 * Kill switch for the observability/test surface (see DiagnosticsConfig):
 * `/diagnostics/*`, `/api-logs/*` and the dedicated DB connection-test
 * endpoints under `/health`. Mirrors DevConsoleGuard: with
 * DIAGNOSTICS_ENABLED=false the routes respond exactly like unknown routes
 * (404), so probing cannot tell the features exist.
 */
@Injectable()
export class DiagnosticsEnabledGuard implements CanActivate {
  private readonly enabled: boolean;
  private readonly token: string;

  constructor(config: ConfigService) {
    this.enabled = config.get<DiagnosticsConfig>('diagnostics', { enabled: false }).enabled &&
      config.get<string>('app.nodeEnv') !== 'production';
    this.token = config.get<string>('devConsole.token', '');
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    // Same response as an unknown route: presence of the API is not leaked.
    if (!this.enabled) throw new NotFoundException(`Cannot ${req.method} ${req.path}`);
    const supplied = req.headers['x-console-token'];
    const actual = Buffer.from(typeof supplied === 'string' ? supplied : '');
    const expected = Buffer.from(this.token);
    if (expected.length < 32 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new ForbiddenException('Invalid console token.');
    }
    return true;
  }
}
