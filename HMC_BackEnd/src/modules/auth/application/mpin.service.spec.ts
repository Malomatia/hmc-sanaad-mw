import { ConfigService } from '@nestjs/config';
import { AuditService } from '@core/audit/audit.service';
import { MpinService } from './mpin.service';
import { MpinStorePort } from '../domain/ports/mpin-store.port';
import { OtpPort } from '../domain/ports/otp.port';
import { DeviceRegistryPort } from '../domain/ports/device-registry.port';
import { LdapUserPort } from '../domain/ports/ldap-user.port';
import { EmployeeIdentity } from '../domain/auth-identity';

const IDENTITY: EmployeeIdentity = {
  username: 'hmc1',
  employeeName: 'Jane Doe',
  phoneNumber: '77861234',
  isEmployee: true,
  isNewUser: false,
};

function makeService({ authDisabled = false } = {}) {
  const store: jest.Mocked<MpinStorePort> = {
    set: jest.fn().mockResolvedValue(undefined),
    verify: jest.fn(),
    exists: jest.fn(),
  };
  const otp: jest.Mocked<OtpPort> = {
    send: jest.fn().mockResolvedValue({ requestId: '42' }),
    verify: jest.fn().mockResolvedValue(true),
  };
  const devices: jest.Mocked<DeviceRegistryPort> = {
    bind: jest.fn().mockResolvedValue(undefined),
    isBound: jest.fn().mockResolvedValue(true),
    find: jest.fn().mockResolvedValue(undefined),
  };
  const ldap: jest.Mocked<LdapUserPort> = {
    validate: jest.fn().mockResolvedValue(IDENTITY),
    authenticate: jest.fn(),
  };
  const audit = { lifecycle: jest.fn() } as unknown as AuditService;
  const config = {
    get: jest.fn((key: string, def?: unknown) => {
      if (key === 'auth.disabled') return authDisabled;
      return def;
    }),
    getOrThrow: jest
      .fn()
      .mockReturnValue({ minLength: 4, maxLength: 6, maxAttempts: 5, lockoutMinutes: 15 }),
  } as unknown as ConfigService;
  const service = new MpinService(store, otp, devices, ldap, audit, config);
  return { service, store, otp, devices, ldap };
}

const DTO = { username: 'hmc1', imeinumber: 'imei-1', platform: 'Android' };

describe('MpinService.forgotInitiate (API-6)', () => {
  it('requires the device to be registered for the user (legacy forgetMPIN check)', async () => {
    const { service, devices, otp } = makeService();
    devices.isBound.mockResolvedValue(false);

    const result = await service.forgotInitiate(DTO);

    expect(result.status).toBe('error');
    expect(result.requestid).toBeUndefined();
    expect(otp.send).not.toHaveBeenCalled();
  });

  it('resolves the phone from the directory and sends the OTP', async () => {
    const { service, otp, ldap } = makeService();

    const result = await service.forgotInitiate(DTO);

    expect(ldap.validate).toHaveBeenCalledWith({
      username: 'hmc1',
      imei: 'imei-1',
      platform: 'Android',
    });
    expect(otp.send).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'hmc1',
        phoneNumber: '77861234',
        imei: 'imei-1',
        purpose: 'FORGOT_MPIN',
      }),
    );
    expect(result).toMatchObject({ status: 'initiated successfully', requestid: '42' });
  });

  it('keeps the dev bypass: no DB/directory/OTP calls when AUTH_DISABLED=true', async () => {
    const { service, otp, devices, ldap } = makeService({ authDisabled: true });

    const result = await service.forgotInitiate(DTO);

    expect(result.status).toBe('initiated successfully');
    expect(result.requestid).toEqual(expect.any(String));
    expect(devices.isBound).not.toHaveBeenCalled();
    expect(ldap.validate).not.toHaveBeenCalled();
    expect(otp.send).not.toHaveBeenCalled();
  });
});
