import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { OwnScopeQueryDto } from './approvals.dto';

/**
 * ops 20/23 ignore any client-supplied identifier, but the property still has
 * to be accepted. The global pipe runs with `forbidNonWhitelisted`, so the two
 * obvious shortcuts both answer 400:
 *
 *  - dropping the property   → "property enum should not exist" for every
 *    client still sending it
 *  - keeping ProfileQueryDto → `enum` stays required, so a client that
 *    correctly stops sending it is rejected
 *
 * Optional is the only shape where both callers work.
 */
describe('OwnScopeQueryDto', () => {
  const check = (query: Record<string, unknown>) =>
    validateSync(plainToInstance(OwnScopeQueryDto, query), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  it('accepts a caller that still sends enum', () => {
    expect(check({ enum: '037400', lang: 'en' })).toHaveLength(0);
  });

  it('accepts a caller that has stopped sending it', () => {
    expect(check({ lang: 'en' })).toHaveLength(0);
  });

  it('accepts the username form too', () => {
    expect(check({ username: 'AIBRAHIM39', lang: 'en' })).toHaveLength(0);
  });

  it('still rejects an unknown parameter', () => {
    const errors = check({ lang: 'en', personId: '26023' });

    expect(errors.length).toBeGreaterThan(0);
  });
});
