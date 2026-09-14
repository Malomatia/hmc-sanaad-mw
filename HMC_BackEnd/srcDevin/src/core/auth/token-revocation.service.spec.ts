import { TokenRevocationService } from './token-revocation.service';

describe('TokenRevocationService', () => {
  it('reports a revoked jti until the token expires', () => {
    const svc = new TokenRevocationService();
    const exp = Math.floor(Date.now() / 1000) + 3600;

    expect(svc.isRevoked('jti-1')).toBe(false);
    svc.revoke('jti-1', exp);
    expect(svc.isRevoked('jti-1')).toBe(true);
    expect(svc.isRevoked('jti-2')).toBe(false);
  });

  it('forgets a revocation once the token itself has expired', () => {
    const svc = new TokenRevocationService();
    const past = Math.floor(Date.now() / 1000) - 10;

    svc.revoke('jti-old', past);
    expect(svc.isRevoked('jti-old')).toBe(false);
  });

  it('retains a revocation without exp using the default TTL', () => {
    const svc = new TokenRevocationService();
    svc.revoke('jti-no-exp');
    expect(svc.isRevoked('jti-no-exp')).toBe(true);
  });
});
