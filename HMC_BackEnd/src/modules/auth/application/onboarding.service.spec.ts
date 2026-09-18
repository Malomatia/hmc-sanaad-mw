import { ConfigService } from '@nestjs/config';
import { AuthStateService } from '@core/auth/auth-state.service';
import { AuditService } from '@core/audit/audit.service';
import { safePreview } from '@core/logging/sensitive-data.util';
import { OnboardingService } from './onboarding.service';
import { LdapUserPort } from '../domain/ports/ldap-user.port';
import { OtpPort } from '../domain/ports/otp.port';
import { DeviceRegistryPort } from '../domain/ports/device-registry.port';

const IDENTITY = {
  username: 'TESTUSER',
  employeeNumber: '011759',
  employeeName: 'Test Employee',
  department: 'Test Department',
  facility: 'Test Facility',
  jobName: 'Test Job',
  email: 'employee@example.test',
  phoneNumber: '55372169',
  isEmployee: true,
  isNewUser: true,
  roles: ['employee'],
};
const DTO = {
  username: 'TESTUSER',
  imeinumber: 'device-1',
  platform: 'Android',
  version: '1.0.0',
  devicemodel: 'Test Model',
  osversion: '13',
};
const REQUEST_ID = 'r'.repeat(43);
const GRANT = 'g'.repeat(43);
const GENERIC = 'If eligible, a verification code will be sent to your registered contact.';

function makeService(
  overrides: { identity?: Partial<typeof IDENTITY>; config?: Record<string, unknown> } = {},
) {
  const ldap = {
    validate: jest.fn().mockResolvedValue({ ...IDENTITY, ...overrides.identity }),
    authenticate: jest.fn(),
  } as unknown as jest.Mocked<LdapUserPort>;
  const otp = {
    send: jest
      .fn()
      .mockResolvedValue({
        requestId: REQUEST_ID,
        status: 'NEW',
        mode: 'SMS',
        validForSeconds: 300,
      }),
    verify: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<OtpPort>;
  const devices = {
    bind: jest.fn().mockResolvedValue(undefined),
    find: jest.fn(),
    isBound: jest.fn(),
    touch: jest.fn(),
  } as unknown as jest.Mocked<DeviceRegistryPort>;
  const audit = { lifecycle: jest.fn() } as unknown as AuditService;
  const state = {
    limit: jest.fn().mockResolvedValue(undefined),
    issueEnrollment: jest.fn().mockResolvedValue(GRANT),
  } as unknown as jest.Mocked<AuthStateService>;
  const config = {
    get: (key: string, fallback: unknown) => overrides.config?.[key] ?? fallback,
  } as ConfigService;
  return {
    service: new OnboardingService(ldap, otp, devices, audit, config, state),
    ldap,
    otp,
    devices,
    state,
  };
}

const PII_FIELDS = [
  'employeeusername',
  'employeename',
  'employeenumber',
  'jobname',
  'department',
  'email',
  'emailunmasked',
  'employeephonenumber',
  'employeephonenumberunmasked',
  'newuser',
  'vflag',
  'employeeflag',
  'devicestatus',
  'otpmode',
];

describe('Onboarding security boundaries', () => {
  it('never delivers an authentication OTP to caller-selected contacts', async () => {
    const { service, otp, ldap } = makeService();
    await service.sendOtp({
      ...DTO,
      phonenumber: 'untrusted-phone',
      email: 'untrusted@example.test',
    });
    expect(ldap.validate).toHaveBeenCalled();
    expect(otp.send).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumber: IDENTITY.phoneNumber,
        email: IDENTITY.email,
        purpose: 'ONBOARDING',
      }),
    );
  });

  it.each(['new', 'existing', 'unknown', 'pending'] as const)(
    'does not expose identity or registration state for %s users',
    async (kind) => {
      const { service, otp, devices } = makeService({
        identity: { isEmployee: kind !== 'unknown' },
      });
      if (kind === 'existing') devices.find.mockResolvedValue({ mpinSet: true, status: 'Active' });
      if (kind === 'pending')
        otp.send.mockResolvedValue({
          requestId: REQUEST_ID,
          status: 'PENDING',
          mode: 'Email',
          validForSeconds: 120,
        });
      const result = await service.validateUser(DTO);
      expect(result).toEqual({
        status: 'success',
        message: GENERIC,
        requestid: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      });
      for (const key of PII_FIELDS) expect(result).not.toHaveProperty(key);
      if (kind === 'unknown') expect(devices.bind).not.toHaveBeenCalled();
      if (kind === 'existing' || kind === 'unknown') expect(otp.send).not.toHaveBeenCalled();
    },
  );

  it('creates an inactive registration before sending the onboarding OTP', async () => {
    const { service, devices, otp } = makeService();
    await service.validateUser(DTO);
    expect(devices.bind).toHaveBeenCalledWith({
      username: DTO.username,
      imei: DTO.imeinumber,
      platform: DTO.platform,
      deviceModel: DTO.devicemodel,
      osVersion: DTO.osversion,
      department: IDENTITY.facility,
    });
    expect(otp.send).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'ONBOARDING', imei: DTO.imeinumber }),
    );
  });

  it('does not re-bind a registered device without an MPIN', async () => {
    const { service, devices, otp } = makeService();
    devices.find.mockResolvedValue({ mpinSet: false, status: 'Inactive' });
    await service.validateUser(DTO);
    expect(devices.bind).not.toHaveBeenCalled();
    expect(otp.send).toHaveBeenCalledTimes(1);
  });

  it('shares the resend budget between initiate and send-otp', async () => {
    const { service, state, ldap } = makeService();
    state.limit.mockRejectedValue(new Error('rate limited'));
    await expect(service.validateUser(DTO)).rejects.toThrow('rate limited');
    await expect(service.sendOtp(DTO)).rejects.toThrow('rate limited');
    expect(state.limit).toHaveBeenNthCalledWith(1, 'otp-send', DTO.username, 1, 60);
    expect(state.limit).toHaveBeenNthCalledWith(2, 'otp-send', DTO.username, 1, 60);
    expect(ldap.validate).not.toHaveBeenCalled();
  });

  it('fails closed on a delivery or state-store failure', async () => {
    const { service, otp } = makeService();
    otp.send.mockRejectedValue(new Error('Unavailable'));
    await expect(service.validateUser(DTO)).rejects.toThrow('Unavailable');
  });
});

describe.each(['validateUser', 'sendOtp'] as const)(
  'OnboardingService.%s language and testing options',
  (method) => {
    it.each(['en', 'ar', undefined] as const)(
      'uses directory email and preserves lang=%s',
      async (lang) => {
        const { service, otp } = makeService({ identity: { phoneNumber: undefined } });
        await service[method](DTO, lang);
        expect(otp.send).toHaveBeenCalledWith(
          expect.objectContaining({ email: IDENTITY.email, lang: lang ?? 'en' }),
        );
      },
    );

    it('uses the same Arabic message for eligible and unknown users', async () => {
      const valid = makeService();
      const unknown = makeService({ identity: { isEmployee: false } });
      expect((await valid.service[method](DTO, 'ar')).message).toBe(
        (await unknown.service[method](DTO, 'ar')).message,
      );
    });

    it.each([undefined, false, 'true'])(
      'does not expose a testing OTP for flag=%s',
      async (flag) => {
        const { service, otp } = makeService({ config: { 'otp.inResponse': flag } });
        otp.send.mockResolvedValue({
          requestId: REQUEST_ID,
          status: 'NEW',
          mode: 'SMS',
          validForSeconds: 300,
          otp: '012345',
        });
        expect(await service[method](DTO)).not.toHaveProperty('otp');
      },
    );

    it('redacts an explicitly enabled local testing OTP', async () => {
      const { service, otp } = makeService({ config: { 'otp.inResponse': true } });
      otp.send.mockResolvedValue({
        requestId: REQUEST_ID,
        status: 'NEW',
        mode: 'SMS',
        validForSeconds: 300,
        otp: '012345',
      });
      const result = await service[method](DTO);
      expect(result.otp).toBe('012345');
      expect(safePreview(result)).toHaveProperty('otp', '******');
    });

    it('never exposes the OTP in production even if a store returns it', async () => {
      const { service, otp } = makeService({
        config: { 'otp.inResponse': true, 'app.nodeEnv': 'production' },
      });
      otp.send.mockResolvedValue({
        requestId: REQUEST_ID,
        status: 'NEW',
        mode: 'SMS',
        validForSeconds: 300,
        otp: '012345',
      });
      expect(await service[method](DTO)).not.toHaveProperty('otp');
    });
  },
);

describe('Enrollment authorization', () => {
  it('issues proof only after consuming an onboarding OTP', async () => {
    const { service, otp, state } = makeService();
    const dto = { ...DTO, requestid: REQUEST_ID, otp: '012345' };
    await expect(service.validateOtp(dto)).resolves.toEqual({
      status: 'success',
      message: 'OTP Validated successfully',
      enrollmenttoken: GRANT,
      expiresinseconds: 300,
    });
    expect(otp.verify).toHaveBeenCalledWith({
      username: DTO.username,
      imei: DTO.imeinumber,
      requestId: REQUEST_ID,
      otp: '012345',
      purpose: 'ONBOARDING',
    });
    expect(state.issueEnrollment).toHaveBeenCalledWith(DTO.username, DTO.imeinumber);
    expect(safePreview({ enrollmenttoken: GRANT })).toEqual({ enrollmenttoken: '******' });
  });

  it('does not issue proof after an invalid, expired, reused, or wrong-purpose OTP', async () => {
    const { service, otp, state } = makeService();
    otp.verify.mockResolvedValue(false);
    await expect(
      service.validateOtp({ ...DTO, requestid: REQUEST_ID, otp: 'wrong' }),
    ).resolves.toEqual({ status: 'error', message: 'Invalid OTP' });
    expect(state.issueEnrollment).not.toHaveBeenCalled();
  });

  it('does not report success if persisting the grant fails', async () => {
    const { service, state } = makeService();
    state.issueEnrollment.mockRejectedValue(new Error('Unavailable'));
    await expect(
      service.validateOtp({ ...DTO, requestid: REQUEST_ID, otp: '012345' }),
    ).rejects.toThrow('Unavailable');
  });
});
