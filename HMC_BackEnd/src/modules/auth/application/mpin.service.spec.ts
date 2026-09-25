import { ConfigService } from '@nestjs/config';
import { AuthStateService } from '@core/auth/auth-state.service';
import { AuditService } from '@core/audit/audit.service';
import { MpinService } from './mpin.service';
import { MpinStorePort } from '../domain/ports/mpin-store.port';
import { OtpPort } from '../domain/ports/otp.port';
import { DeviceRegistryPort } from '../domain/ports/device-registry.port';
import { LdapUserPort } from '../domain/ports/ldap-user.port';

const DTO = { username: 'hmc1', imeinumber: 'device-1', platform: 'Android' };
const GRANT = 'g'.repeat(43);
const REQUEST_ID = 'r'.repeat(43);
const IDENTITY = {
  username: DTO.username,
  employeeName: 'Test Employee',
  phoneNumber: '77861234',
  email: 'employee@example.test',
  isEmployee: true,
  isNewUser: false,
};

function makeService(authDisabled = false) {
  const store = {
    set: jest.fn(),
    exists: jest.fn().mockResolvedValue(false),
    verify: jest.fn(),
  } as jest.Mocked<MpinStorePort>;
  const otp = {
    send: jest.fn().mockResolvedValue({ requestId: REQUEST_ID }),
    verify: jest.fn().mockResolvedValue(true),
  } as jest.Mocked<OtpPort>;
  const devices = {
    bind: jest.fn(),
    find: jest.fn(),
    touch: jest.fn(),
    isBound: jest.fn().mockResolvedValue(true),
  } as jest.Mocked<DeviceRegistryPort>;
  const ldap = {
    validate: jest.fn().mockResolvedValue(IDENTITY),
    authenticate: jest.fn(),
  } as jest.Mocked<LdapUserPort>;
  const state = {
    limit: jest.fn().mockResolvedValue(undefined),
    enroll: jest.fn().mockResolvedValue(true),
    resetMpin: jest.fn().mockResolvedValue(true),
    resetMpinWithGrant: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<AuthStateService>;
  const config = {
    get: (key: string, fallback: unknown) => (key === 'auth.disabled' ? authDisabled : fallback),
    getOrThrow: () => ({ minLength: 4, maxLength: 6, maxAttempts: 5, lockoutMinutes: 15 }),
  } as unknown as ConfigService;
  const audit = { lifecycle: jest.fn() } as unknown as AuditService;
  return {
    service: new MpinService(store, otp, devices, ldap, audit, config, state),
    store,
    otp,
    devices,
    ldap,
    state,
  };
}

describe('First MPIN enrollment', () => {
  it.each(['client-hashed-test-value+/=', '1', '1234567890'])(
    'preserves a client MPIN value after proof: %s',
    async (mpin) => {
      const { service, state, store, devices } = makeService();
      await expect(
        service.setMpin({ ...DTO, mpin, enrollmenttoken: GRANT }),
      ).resolves.toMatchObject({ status: 'success' });
      expect(state.enroll).toHaveBeenCalledWith(DTO.username, DTO.imeinumber, mpin, GRANT);
      expect(store.set).not.toHaveBeenCalled();
      expect(devices.bind).not.toHaveBeenCalled();
    },
  );

  it.each(['', 'invalid'])(
    'refuses missing/malformed authorization: %s',
    async (enrollmenttoken) => {
      const { service, state } = makeService();
      await expect(
        service.setMpin({ ...DTO, mpin: 'hash', enrollmenttoken }),
      ).resolves.toMatchObject({ status: 'error' });
      expect(state.enroll).not.toHaveBeenCalled();
    },
  );

  it('refuses expired/reused/wrong-user proof when the atomic store rejects it', async () => {
    const { service, state } = makeService();
    state.enroll.mockResolvedValue(false);
    await expect(
      service.setMpin({ ...DTO, mpin: 'hash', enrollmenttoken: GRANT }),
    ).resolves.toMatchObject({ status: 'error' });
  });

  it('does not overwrite an existing MPIN through enrollment', async () => {
    const { service, store, state } = makeService();
    store.exists.mockResolvedValue(true);
    await expect(
      service.setMpin({ ...DTO, mpin: 'hash', enrollmenttoken: GRANT }),
    ).resolves.toMatchObject({ status: 'error' });
    expect(state.enroll).not.toHaveBeenCalled();
  });

  it('rechecks employee eligibility', async () => {
    const { service, ldap, state } = makeService();
    ldap.validate.mockResolvedValue({ ...IDENTITY, isEmployee: false });
    await expect(
      service.setMpin({ ...DTO, mpin: 'hash', enrollmenttoken: GRANT }),
    ).resolves.toMatchObject({ status: 'error' });
    expect(state.enroll).not.toHaveBeenCalled();
  });

  it('keeps explicitly configured local bypass database-free', async () => {
    const { service, state } = makeService(true);
    await expect(
      service.setMpin({ ...DTO, mpin: 'hash', enrollmenttoken: GRANT }),
    ).resolves.toMatchObject({ status: 'success' });
    expect(state.enroll).not.toHaveBeenCalled();
  });
});

describe('Forgot MPIN', () => {
  it.each([true, false])('returns a generic response when registered=%s', async (registered) => {
    const { service, devices, otp } = makeService();
    devices.isBound.mockResolvedValue(registered);
    const result = await service.forgotInitiate(DTO);
    expect(result).toEqual({
      status: 'initiated successfully',
      requestid: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      message: 'If eligible, a verification code will be sent to your registered contact.',
    });
    expect(otp.send).toHaveBeenCalledTimes(registered ? 1 : 0);
  });

  it.each(['en', 'ar', undefined] as const)(
    'uses directory contacts, recovery purpose and lang=%s',
    async (lang) => {
      const { service, otp } = makeService();
      await service.forgotInitiate(DTO, lang);
      expect(otp.send).toHaveBeenCalledWith(
        expect.objectContaining({
          phoneNumber: IDENTITY.phoneNumber,
          email: IDENTITY.email,
          purpose: 'FORGOT_MPIN',
          smsTemplate: 'forget',
          lang: lang ?? 'en',
        }),
      );
    },
  );

  it('does not send a recovery OTP for an ineligible employee', async () => {
    const { service, ldap, otp } = makeService();
    ldap.validate.mockResolvedValue({ ...IDENTITY, isEmployee: false });
    await service.forgotInitiate(DTO);
    expect(otp.send).not.toHaveBeenCalled();
  });
});

describe('MPIN reset', () => {
  const reset = { ...DTO, newmpin: 'opaque-client-hash+/=', requestid: REQUEST_ID, otp: '012345' };

  it('requires a recovery OTP and delegates the MPIN update/session invalidation atomically', async () => {
    const { service, otp, state, store } = makeService();
    await expect(service.resetMpin(reset)).resolves.toMatchObject({ status: 'success' });
    expect(otp.verify).toHaveBeenCalledWith({
      username: DTO.username,
      imei: DTO.imeinumber,
      requestId: REQUEST_ID,
      otp: '012345',
      purpose: 'FORGOT_MPIN',
    });
    expect(state.resetMpin).toHaveBeenCalledWith(DTO.username, DTO.imeinumber, reset.newmpin);
    expect(store.set).not.toHaveBeenCalled();
  });

  it('rejects invalid input before spending an OTP', async () => {
    const { service, otp } = makeService();
    await expect(service.resetMpin({ ...reset, newmpin: '' })).resolves.toMatchObject({
      status: 'error',
    });
    expect(otp.verify).not.toHaveBeenCalled();
  });

  it('never writes an MPIN after failed OTP verification', async () => {
    const { service, otp, state } = makeService();
    otp.verify.mockResolvedValue(false);
    await expect(service.resetMpin(reset)).resolves.toMatchObject({ status: 'error' });
    expect(state.resetMpin).not.toHaveBeenCalled();
  });

  it('does not report success when the registration is inactive or missing', async () => {
    const { service, state } = makeService();
    state.resetMpin.mockResolvedValue(false);
    await expect(service.resetMpin(reset)).resolves.toMatchObject({ status: 'error' });
  });

  it('refuses a reset with neither an OTP nor a token, without spending anything', async () => {
    const { service, otp, state } = makeService();
    await expect(service.resetMpin({ ...DTO, newmpin: 'hash' })).resolves.toMatchObject({
      status: 'error',
    });
    expect(otp.verify).not.toHaveBeenCalled();
    expect(state.resetMpinWithGrant).not.toHaveBeenCalled();
  });
});

describe('MPIN reset with the /auth/otp/validate token (forgot → validate → reset)', () => {
  const reset = { ...DTO, newmpin: 'opaque-client-hash+/=', enrollmenttoken: GRANT };

  it('uses the grant instead of re-checking the already spent OTP', async () => {
    const { service, otp, state, store } = makeService();
    await expect(service.resetMpin(reset)).resolves.toEqual({
      status: 'success',
      message: 'MPIN Changed successfully',
    });
    expect(otp.verify).not.toHaveBeenCalled();
    expect(state.limit).toHaveBeenCalledWith('mpin-reset', 'HMC1', 5, 300);
    expect(state.resetMpinWithGrant).toHaveBeenCalledWith(
      DTO.username,
      DTO.imeinumber,
      reset.newmpin,
      GRANT,
    );
    expect(state.resetMpin).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
  });

  it('prefers the token when an OTP is sent as well', async () => {
    const { service, otp, state } = makeService();
    await service.resetMpin({ ...reset, otp: '012345', requestid: REQUEST_ID });
    expect(otp.verify).not.toHaveBeenCalled();
    expect(state.resetMpinWithGrant).toHaveBeenCalled();
  });

  it('refuses a malformed token without touching the database', async () => {
    const { service, state } = makeService();
    await expect(service.resetMpin({ ...reset, enrollmenttoken: 'short' })).resolves.toMatchObject({
      status: 'error',
    });
    expect(state.limit).not.toHaveBeenCalled();
    expect(state.resetMpinWithGrant).not.toHaveBeenCalled();
  });

  it('refuses an expired, reused or onboarding grant (the atomic reset rejects it)', async () => {
    const { service, state } = makeService();
    state.resetMpinWithGrant.mockResolvedValue(false);
    await expect(service.resetMpin(reset)).resolves.toEqual({
      status: 'error',
      message: 'Invalid or expired reset authorization.',
    });
  });

  it('rechecks employee eligibility before resetting', async () => {
    const { service, ldap, state } = makeService();
    ldap.validate.mockResolvedValue({ ...IDENTITY, isEmployee: false });
    await expect(service.resetMpin(reset)).resolves.toMatchObject({ status: 'error' });
    expect(state.resetMpinWithGrant).not.toHaveBeenCalled();
  });

  it('keeps the local bypass database-free', async () => {
    const { service, state } = makeService(true);
    await expect(service.resetMpin(reset)).resolves.toMatchObject({ status: 'success' });
    expect(state.resetMpinWithGrant).not.toHaveBeenCalled();
  });
});
