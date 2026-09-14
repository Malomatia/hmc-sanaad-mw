import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
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

  constructor(config: ConfigService) {
    this.enabled = config.get<DiagnosticsConfig>('diagnostics', { enabled: true }).enabled;
  }

  canActivate(context: ExecutionContext): boolean {
    if (this.enabled) return true;
    const req = context.switchToHttp().getRequest<Request>();
    // Same response as an unknown route: presence of the API is not leaked.
    throw new NotFoundException(`Cannot ${req.method} ${req.path}`);
  }
}
