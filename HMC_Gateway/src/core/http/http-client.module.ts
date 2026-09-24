import { Global, Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import * as https from 'node:https';
import { BackendConfig } from '../config/configuration';

/**
 * Build the https.Agent for an https:// backend, honoring the TLS config:
 * a trusted CA (BACKEND_CA_CERT[_PATH]) validates HMC's internal/self-signed
 * cert properly; BACKEND_TLS_REJECT_UNAUTHORIZED=false disables validation
 * entirely (the Node equivalent of .NET's trust-all
 * ServerCertificateValidationCallback) — last resort only, loudly warned.
 * A plain http:// backend needs no agent.
 */
export function buildBackendHttpsAgent(backend: BackendConfig): https.Agent | undefined {
  if (!backend.baseUrl.startsWith('https://')) return undefined;

  if (!backend.tlsRejectUnauthorized) {
    return new https.Agent({ rejectUnauthorized: false });
  }
  if (backend.caCert) {
    return new https.Agent({ rejectUnauthorized: true, ca: backend.caCert });
  }
  return undefined; // default Node trust store
}

/**
 * Single shared axios HttpService, configured with the backend's base URL,
 * timeout and TLS agent, used by both ProxyService (generic forwarding) and
 * the auth-proxy controller (pre-login journey) and HealthController.
 */
@Global()
@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const backend = config.getOrThrow<BackendConfig>('backend');
        return {
          baseURL: backend.baseUrl,
          timeout: backend.timeoutMs,
          validateStatus: () => true, // let ProxyService/callers see all statuses, not just 2xx
          httpsAgent: buildBackendHttpsAgent(backend),
        };
      },
    }),
  ],
  exports: [HttpModule],
})
export class HttpClientModule {}
