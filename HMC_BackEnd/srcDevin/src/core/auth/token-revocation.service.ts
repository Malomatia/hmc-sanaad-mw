import { Injectable, Logger } from '@nestjs/common';

/**
 * In-memory JWT revocation list (jti denylist) behind /auth/logout and the
 * refresh-token rotation. Entries expire together with the token they revoke,
 * so the map stays bounded by the number of tokens revoked within one token
 * lifetime.
 *
 * Deliberately in-memory (the Users DB may be disabled entirely — see
 * AUTH_STATIC_LOGIN/USERS_DB_DISABLED): a restart clears the list, meaning a
 * logged-out-but-unexpired token becomes valid again until it expires, and
 * multiple instances do not share revocations. Move to a shared store
 * (Users DB/Redis) if either trade-off becomes unacceptable.
 */
@Injectable()
export class TokenRevocationService {
  private readonly logger = new Logger(TokenRevocationService.name);
  /** jti → revocation-entry expiry (epoch ms). */
  private readonly revoked = new Map<string, number>();

  /** Fallback retention when the token carries no `exp` claim. */
  private static readonly DEFAULT_TTL_MS = 8 * 24 * 60 * 60 * 1000; // > 7d refresh

  /** Revoke a token by its jti until `expSeconds` (the token's own exp). */
  revoke(jti: string, expSeconds?: number): void {
    this.prune();
    const expiresAt =
      expSeconds !== undefined
        ? expSeconds * 1000
        : Date.now() + TokenRevocationService.DEFAULT_TTL_MS;
    this.revoked.set(jti, expiresAt);
    this.logger.log(`Token ${jti} revoked (until ${new Date(expiresAt).toISOString()}).`);
  }

  isRevoked(jti: string): boolean {
    const expiresAt = this.revoked.get(jti);
    if (expiresAt === undefined) return false;
    if (expiresAt <= Date.now()) {
      // The token itself has expired — the entry is no longer needed.
      this.revoked.delete(jti);
      return false;
    }
    return true;
  }

  /** Drop entries whose tokens have already expired on their own. */
  private prune(): void {
    const now = Date.now();
    for (const [jti, expiresAt] of this.revoked) {
      if (expiresAt <= now) this.revoked.delete(jti);
    }
  }
}
