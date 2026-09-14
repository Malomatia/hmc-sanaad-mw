import {
  BadGatewayException,
  Injectable,
  Logger,
  NotImplementedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { CernerConfig } from '@core/config/configuration';
import { ERROR_MESSAGES } from '@shared/constants/error-codes';
import { CERNER_MASTER_LOOKUPS } from '@shared/constants/lov-names';
import { ClinicMasters } from '../../domain/appointments.repository';

/**
 * Anticorruption client isolating Cerner (never leak Cerner shapes upward).
 * Masters use the gateway `masterlookup=Cerner*` path (from the mapping);
 * upcoming/book paths are not documented → NotImplemented until the spec lands.
 */
@Injectable()
export class CernerClient {
  private readonly logger = new Logger(CernerClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    const cfg = config.getOrThrow<CernerConfig>('cerner');
    this.baseUrl = cfg.baseUrl;
    this.timeoutMs = cfg.timeoutMs;
  }

  private ensureConfigured(): void {
    if (!this.baseUrl) {
      throw new ServiceUnavailableException(ERROR_MESSAGES.CERNER_UNAVAILABLE);
    }
  }

  async getMasters(lang: string): Promise<ClinicMasters> {
    this.ensureConfigured();
    try {
      const [clinics, locations, services] = await Promise.all(
        CERNER_MASTER_LOOKUPS.map((name) => this.masterLookup(name, lang)),
      );
      return { clinics, locations, services };
    } catch (err) {
      this.logger.error(`Cerner masters failed: ${(err as Error).message}`);
      throw new BadGatewayException(ERROR_MESSAGES.CERNER_UNAVAILABLE);
    }
  }

  private async masterLookup(lookupName: string, lang: string): Promise<unknown[]> {
    // TODO(verify): confirm the Cerner master-lookup path/response shape.
    const url = `${this.baseUrl}/data/masterlookup`;
    const response = await firstValueFrom(
      this.http.get(url, { params: { lookupname: lookupName, lang }, timeout: this.timeoutMs }),
    );
    const data = response.data as { result?: unknown[] } | unknown[];
    return Array.isArray(data) ? data : (data?.result ?? []);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getUpcoming(_employeeNumber: string, _lang: string): Promise<Record<string, unknown>[]> {
    this.ensureConfigured();
    throw new NotImplementedException('Cerner upcoming-appointments path — TODO(cerner).');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async book(_payload: Record<string, unknown>): Promise<{ status: string; message?: string }> {
    this.ensureConfigured();
    throw new NotImplementedException('Cerner book-appointment path — TODO(cerner).');
  }
}
