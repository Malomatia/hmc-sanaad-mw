import { UnauthorizedException } from '@nestjs/common';
import { normalizePersonId } from '@shared/domain/caller-identity';
import { AuthenticatedUser, Role } from './auth-user.interface';
import {
  currentIdentity,
  MissingIdentityClaimException,
  requireIdentity,
} from './current-identity';

const user = (claims: Record<string, unknown>): AuthenticatedUser => ({
  username: 'legacy-fallback',
  employeeNumber: 'wrong-fallback',
  roles: [Role.EMPLOYEE],
  claims,
});

describe('verified current identity', () => {
  it('uses only original claims and preserves username casing and employee leading zeros', () => {
    expect(
      currentIdentity(
        user({ username: 'mixed.User', employeeNumber: '001234', person_id: '26023' }),
      ),
    ).toMatchObject({ username: 'mixed.User', employeeNumber: '001234', personId: '26023' });
  });

  it.each([undefined, '', '  ', 123, [], {}])('refuses malformed username %j', (username) => {
    expect(() => currentIdentity(user({ username, sub: 'someone' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('never interprets sub or legacy enum as an employee or person identifier', () => {
    const caller = user({ username: 'mixed.User', sub: '001234', enum: '001234' });
    expect(currentIdentity(caller)).toMatchObject({
      employeeNumber: undefined,
      personId: undefined,
    });
    expect(() => requireIdentity(caller, 'employeeNumber')).toThrow(MissingIdentityClaimException);
    expect(() => requireIdentity(caller, 'personId')).toThrow(MissingIdentityClaimException);
    expect(requireIdentity(caller, 'username')).toBe('mixed.User');
  });

  it.each([undefined, '', '  ', 123, [], {}])(
    'requires a string employeeNumber: %j',
    (employeeNumber) => {
      expect(() =>
        requireIdentity(user({ username: 'user', employeeNumber }), 'employeeNumber'),
      ).toThrow(MissingIdentityClaimException);
    },
  );

  it('identifies the missing session claim with HTTP 422', () => {
    const error = new MissingIdentityClaimException('personId');
    expect(error.getStatus()).toBe(422);
    expect(error.message).toContain('person_id');
    expect(error.message).toContain('log in again');
  });
});

describe('person ID normalization', () => {
  it.each([
    ['26023', '26023'],
    [26023, '26023'],
    [' 0026023 ', '26023'],
  ])('normalizes %j', (input, expected) => expect(normalizePersonId(input)).toBe(expected));
  it.each([
    null,
    undefined,
    '',
    ' ',
    '0',
    0,
    -1,
    '1.5',
    '1e3',
    'person',
    {},
    [],
    Number.MAX_SAFE_INTEGER + 1,
  ])('refuses invalid ID %j', (input) => expect(normalizePersonId(input)).toBeUndefined());
});
