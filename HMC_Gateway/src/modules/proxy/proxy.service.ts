import { BadGatewayException, GatewayTimeoutException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosRequestConfig } from 'axios';
import { firstValueFrom } from 'rxjs';
import { Request, Response } from 'express';
import { AppConfig, BackendConfig } from '@core/config/configuration';
import { CORRELATION_ID_HEADER } from '@core/http/correlation-id.middleware';

/**
 * Request headers forwarded from the mobile client to HMC_BackEnd.
 *
 * The attestation headers are on this list because the gateway's check is a
 * cheap first pass — presence, shape, and whether the body hash matches — and
 * the cryptographic verification happens in the backend. Dropping them here
 * would leave that verification permanently blind, since the gateway is the
 * only way in.
 */
const FORWARD_REQUEST_HEADERS = [
  'authorization',
  'content-type',
  'accept',
  'accept-language',
  'x-integrity-token',
  'x-integrity-request-hash',
  'x-integrity-challenge',
  'x-ios-assertion',
  'x-ios-key-id',
];
/** Response headers relayed from HMC_BackEnd back to the mobile client. */
const FORWARD_RESPONSE_HEADERS = ['content-type'];

/**
 * Forwards an inbound request to HMC_BackEnd unchanged and relays the
 * response (status, body, selected headers) back untouched — the backend
 * already fully shapes both success (SanaadEnvelope) and error
 * (SanaadErrorEnvelope) response bodies, so this never re-wraps them.
 *
 * A real network failure (timeout, connection refused, DNS) is the only case
 * this service turns into a gateway-originated error (502/504), because
 * `validateStatus: () => true` on the shared HttpService (see
 * HttpClientModule) means any HTTP response the backend actually returns —
 * including its own 4xx/5xx — resolves normally and is streamed through.
 */
@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async forward(req: Request, res: Response): Promise<void> {
    const backend = this.config.getOrThrow<BackendConfig>('backend');
    const app = this.config.getOrThrow<AppConfig>('app');

    const targetPath = this.resolveTargetPath(req.originalUrl, app.apiPrefix, backend.apiPrefix);
    const correlationId = (req as Request & { correlationId?: string }).correlationId;

    const axiosConfig: AxiosRequestConfig = {
      url: targetPath,
      method: req.method as AxiosRequestConfig['method'],
      headers: this.buildForwardHeaders(req, correlationId),
      // The original bytes when we have them, rather than axios re-encoding
      // the parsed object: Play Integrity binds a token to a hash the client
      // computed over exactly what it sent, and a re-serialized body is a
      // different string even when it is the same data.
      data: (req as Request & { rawBody?: Buffer }).rawBody ?? req.body,
      responseType: 'arraybuffer',
    };

    let response;
    try {
      response = await firstValueFrom(this.http.request(axiosConfig));
    } catch (err) {
      this.handleNetworkError(err as AxiosError, req);
      return;
    }

    res.status(response.status);
    for (const header of FORWARD_RESPONSE_HEADERS) {
      const value = response.headers[header];
      if (value) res.setHeader(header, value);
    }
    const responseCorrelationId = response.headers[CORRELATION_ID_HEADER];
    if (responseCorrelationId) res.setHeader(CORRELATION_ID_HEADER, responseCorrelationId);

    res.send(response.data);
  }

  /**
   * `/api/v1/auth/login?lang=ar` (gateway prefix) → `/api/v1/auth/login?lang=ar`
   * (backend prefix) against `backend.baseUrl`. Prefixes are configured
   * independently in case they ever diverge.
   */
  private resolveTargetPath(
    originalUrl: string,
    gatewayPrefix: string,
    backendPrefix: string,
  ): string {
    const trimmedGatewayPrefix = `/${gatewayPrefix.replace(/^\/+|\/+$/g, '')}`;
    const trimmedBackendPrefix = `/${backendPrefix.replace(/^\/+|\/+$/g, '')}`;
    const suffix = originalUrl.startsWith(trimmedGatewayPrefix)
      ? originalUrl.slice(trimmedGatewayPrefix.length)
      : originalUrl;
    return `${trimmedBackendPrefix}${suffix}`;
  }

  private buildForwardHeaders(req: Request, correlationId?: string): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const header of FORWARD_REQUEST_HEADERS) {
      const value = req.headers[header];
      if (typeof value === 'string') headers[header] = value;
    }
    if (correlationId) headers[CORRELATION_ID_HEADER] = correlationId;
    return headers;
  }

  private handleNetworkError(err: AxiosError, req: Request): never {
    const detail = `${req.method} ${req.originalUrl} :: ${err.message}`;
    if (err.code === 'ECONNABORTED' || err.message?.toLowerCase().includes('timeout')) {
      this.logger.error(`Backend request timed out — ${detail}`);
      throw new GatewayTimeoutException('The upstream service timed out. Please try again.');
    }
    this.logger.error(`Backend request failed — ${detail}`, err.stack);
    throw new BadGatewayException('The upstream service is currently unavailable.');
  }
}
