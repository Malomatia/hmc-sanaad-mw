import * as Joi from 'joi';

/**
 * Env schema — fails fast at boot if configuration is missing/invalid.
 * See .env.example for the full list.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  GATEWAY_PORT: Joi.number().default(3000),
  API_PREFIX: Joi.string().default('api/v1'),
  CORS_ORIGINS: Joi.string().default('*'),

  // Upstream backend (HMC_BackEnd)
  BACKEND_BASE_URL: Joi.string().uri().default('http://localhost:3009'),
  BACKEND_API_PREFIX: Joi.string().default('api/v1'),
  BACKEND_TIMEOUT_MS: Joi.number().min(1).default(30000),
  // TLS to an https:// backend: keep validation on and provide the CA
  // (inline PEM or file path — inline wins); set REJECT_UNAUTHORIZED=false
  // only as a last resort for an internal cert whose CA can't be provided.
  BACKEND_TLS_REJECT_UNAUTHORIZED: Joi.boolean().default(true),
  BACKEND_CA_CERT: Joi.string().allow('').default(''),
  BACKEND_CA_CERT_PATH: Joi.string().allow('').default(''),

  // Auth — MUST match HMC_BackEnd's JWT_SECRET/JWT_ISSUER/JWT_AUDIENCE so
  // tokens issued by the backend at login verify locally at the gateway.
  JWT_SECRET: Joi.string().min(8).default('dev-only-secret-change-me'),
  JWT_ISSUER: Joi.string().default('sanaad'),
  JWT_AUDIENCE: Joi.string().default('sanaad-b2e'),
  JWT_EXPIRES_IN: Joi.string().default('1h'),
  AUTH_DISABLED: Joi.boolean().default(false),

  // Rate limiting for login / OTP / MPIN attempt endpoints
  THROTTLE_LOGIN_LIMIT: Joi.number().min(1).default(5),
  THROTTLE_LOGIN_TTL_MS: Joi.number().min(1000).default(60000),

  // Misc
  REQUEST_TIMEOUT_MS: Joi.number().default(35000),
});
