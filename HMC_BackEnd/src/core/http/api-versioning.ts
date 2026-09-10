import { INestApplication, VERSION_NEUTRAL, VersioningType } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

const normalizePrefix = (prefix: string): string => prefix.replace(/^\/+|\/+$/g, '');
const hasVersion = (prefix: string): boolean => /(^|\/)v1$/.test(prefix);
const rootPrefix = (prefix: string): string => prefix.replace(/(^|\/)v1$/, '');

export function apiVersionPrefix(legacyPrefix: string, version: '1' | '2'): string {
  const prefix = normalizePrefix(legacyPrefix);
  if (version === '1') return prefix;
  return [hasVersion(prefix) ? rootPrefix(prefix) : prefix, 'v2'].filter(Boolean).join('/');
}

export function configureApiVersioning(app: INestApplication, legacyPrefix: string): void {
  const prefix = normalizePrefix(legacyPrefix);
  const versioned = hasVersion(prefix);
  app.setGlobalPrefix(versioned ? rootPrefix(prefix) : prefix);
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: versioned ? '1' : VERSION_NEUTRAL,
  });
}

export function removeDiagnosticsFromDocument(document: OpenAPIObject, legacyPrefix: string): void {
  const bases = (['1', '2'] as const).map((version) =>
    `/${apiVersionPrefix(legacyPrefix, version)}`.replace(/\/+$/, ''),
  );
  const gatedPrefixes = bases.flatMap((base) => [`${base}/diagnostics`, `${base}/api-logs`]);
  const gatedExact = new Set(bases.flatMap((base) => [
    `${base}/health/db`, `${base}/health/users-db`, `${base}/health/motc-sms-db`,
  ]));
  for (const path of Object.keys(document.paths)) {
    if (gatedExact.has(path) || gatedPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      delete document.paths[path];
    }
  }
}
