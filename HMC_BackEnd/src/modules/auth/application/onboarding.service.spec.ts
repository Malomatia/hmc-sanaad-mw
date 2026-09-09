import { ConfigService } from '@nestjs/config';
import { AuditService } from '@core/audit/audit.service';
import { safePreview } from '@core/logging/sensitive-data.util';
import { OnboardingService } from './onboarding.service';
import { LdapUserPort } from '../domain/ports/ldap-user.port';
import { OtpPort } from '../domain/ports/otp.port';
import { DeviceRegistryPort } from '../domain/ports/device-registry.port';

const IDENTITY = {
  username: 'MKHOJA',
  employeeNumber: '011759',
  employeeName: 'Mouna Bent Abdelkerim Khoja',
  department: 'Cardiothoracic Surgery.Heart Hospital',
  facility: 'Heart Hospital',
  jobName: 'Cardiac Technologist.HMC',
  email: 'MKHOJA@hamad.qa',
  phoneNumber: '55372169',
  isEmployee: true,
  isNewUser: true,
  roles: ['employee'],
};

const DTO = {
  username: 'MKHOJA',
  imeinumber: 'imei-1',
  platform: 'Android',
  version: '1.0.0',
  devicemodel: 'SM-G965F',
  osversion: '13',
};

function makeService(overrides?: {
  identity?: Partial<typeof IDENTITY>;
  config?: Record<string, unknown>;
}) {
  const ldap = {
    validate: jest.fn().mockResolvedValue({ ...IDENTITY, ...overrides?.identity }),
    authenticate: jest.fn(),
  } as unknown as jest.Mocked<LdapUserPort>;
  const otp = {
    send: jest
      .fn()
      .mockResolvedValue({ requestId: '12345', status: 'NEW', mode: 'SMS', validForSeconds: 300 }),
    verify: jest.fn(),
  } as unknown as jest.Mocked<OtpPort>;
  const devices = {
    bind: jest.fn().mockResolvedValue(undefined),
    isBound: jest.fn(),
    find: jest.fn(),
    touch: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<DeviceRegistryPort>;
  const audit = { lifecycle: jest.fn() } as unknown as jest.Mocked<AuditService>;
  const config = {
    get: jest.fn((key: string, fallback: unknown) => overrides?.config?.[key] ?? fallback),
  } as unknown as ConfigService;
  return {
    service: new OnboardingService(ldap, otp, devices, audit, config),
    ldap,
    otp,
    devices,
  };
}

describe.each(['validateUser', 'sendOtp'] as const)('OnboardingService.%s language', (method) => {
  it.each(['en', 'ar', undefined] as const)('passes lang=%s to OTP delivery', async (lang) => {
    const { service, otp } = makeService({ identity: { phoneNumber: undefined } });

    await service[method]({ ...DTO, email: IDENTITY.email }, lang);

    expect(otp.send).toHaveBeenCalledWith(
      expect.objectContaining({ email: IDENTITY.email, lang: lang ?? 'en' }),
    );
  });
});

describe.each(['validateUser', 'sendOtp'] as const)('OTP response for %s', (method) => {
  it.each(['012345', 'A2B3C4'])('returns the exact OTP when enabled: %s', async (code) => {
    const { service, otp } = makeService({ config: { 'otp.inResponse': true } });
    otp.send.mockResolvedValue({
      requestId: '12345',
      status: 'NEW',
      mode: 'SMS',
      validForSeconds: 300,
      otp: code,
    });

    const result = await service[method]({ ...DTO, phonenumber: IDENTITY.phoneNumber });

    expect(result).toHaveProperty('otp', code);
    expect(result.requestid).toBe('12345');
    expect(safePreview(result)).toHaveProperty('otp', '******');
    expect(JSON.stringify(safePreview(result))).not.toContain(`"otp":"${code}"`);
    expect(result).toHaveProperty('otp', code);
  });

  it.each([undefined, false, 'true'])('requires boolean true: %s', async (flag) => {
    const { service, otp } = makeService({ config: { 'otp.inResponse': flag } });
    otp.send.mockResolvedValue({
      requestId: '12345',
      status: 'NEW',
      mode: 'SMS',
      validForSeconds: 300,
      otp: '012345',
    });

    expect(await service[method](DTO)).not.toHaveProperty('otp');
  });

  it('omits the OTP in production even if the store returns one', async () => {
    const { service, otp } = makeService({
      config: { 'otp.inResponse': true, 'app.nodeEnv': 'production' },
    });
    otp.send.mockResolvedValue({
      requestId: '12345',
      status: 'NEW',
      mode: 'SMS',
      validForSeconds: 300,
      otp: '012345',
    });

    expect(await service[method](DTO)).not.toHaveProperty('otp');
  });

  it('returns a pending email OTP without changing the request id or status', async () => {
    const { service, otp } = makeService({ config: { 'otp.inResponse': true } });
    otp.send.mockResolvedValue({
      requestId: '77',
      status: 'PENDING',
      mode: 'Email',
      validForSeconds: 120,
      otp: '000123',
    });

    expect(await service[method]({ ...DTO, email: IDENTITY.email })).toMatchObject({
      status: 'success',
      requestid: '77',
      otp: '000123',
    });
  });

  it('does not invent an OTP for the auth-disabled bypass', async () => {
    const { service, otp } = makeService({
      config: { 'otp.inResponse': true, 'auth.disabled': true },
    });

    expect(await service[method](DTO)).not.toHaveProperty('otp');
    expect(otp.send).not.toHaveBeenCalled();
  });

  it('does not turn a delivery failure into a successful OTP response', async () => {
    const { service, otp } = makeService({ config: { 'otp.inResponse': true } });
    otp.send.mockRejectedValue(new Error('Delivery unavailable'));

    await expect(service[method](DTO)).rejects.toThrow('Delivery unavailable');
  });
});

describe('OnboardingService.validateUser (reworked initiate, 2026-09-03)', () => {
  it('rejects a username absent from the employee view without touching the device table', async () => {
    const { service, otp, devices } = makeService({
      identity: { isEmployee: false, roles: [] },
      config: { 'otp.inResponse': true },
    });

    const res = await service.validateUser(DTO);

    expect(res).toEqual({ status: 'error', message: 'Invalid Username.' });
    expect(devices.find).not.toHaveBeenCalled();
    expect(devices.bind).not.toHaveBeenCalled();
    expect(otp.send).not.toHaveBeenCalled();
  });

  it('existing user (device registered with MPIN): masked data from both tables, vflag=Exist, NO OTP', async () => {
    const { service, otp, devices } = makeService({ config: { 'otp.inResponse': true } });
    devices.find.mockResolvedValue({ mpinSet: true, status: 'Active' });

    const res = await service.validateUser(DTO);

    expect(res).toMatchObject({
      status: 'success',
      employeeusername: 'MKHOJA',
      employeename: IDENTITY.employeeName,
      employeenumber: '011759',
      jobname: IDENTITY.jobName,
      email: 'MK****@hamad.qa',
      department: IDENTITY.department,
      employeephonenumber: 'XXXXX169',
      devicestatus: 'Active',
      newuser: 'No',
      vflag: 'Exist',
      employeeflag: 'Yes',
    });
    expect(res.requestid).toBeUndefined();
    expect(res).not.toHaveProperty('otp');
    expect(res.otpmode).toBeUndefined();
    expect(otp.send).not.toHaveBeenCalled();
    expect(devices.bind).not.toHaveBeenCalled();
  });

  it('new device: creates the registration (Inactive) and sends the OTP (vflag=New)', async () => {
    const { service, otp, devices } = makeService();
    devices.find.mockResolvedValue(undefined);

    const res = await service.validateUser(DTO);

    expect(devices.bind).toHaveBeenCalledWith({
      username: 'MKHOJA',
      imei: 'imei-1',
      platform: 'Android',
      deviceModel: 'SM-G965F',
      osVersion: '13',
      department: 'Heart Hospital',
    });
    expect(otp.send).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'MKHOJA',
        phoneNumber: '55372169',
        email: 'MKHOJA@hamad.qa',
        imei: 'imei-1',
        purpose: 'ONBOARDING',
        appVersion: '1.0.0',
      }),
    );
    expect(res).toMatchObject({
      status: 'success',
      message: 'OTP sent successfully',
      newuser: 'Yes',
      vflag: 'New',
      otpmode: 'SMS',
      elapsedtimeinmins: 5,
      requestid: '12345',
      employeephonenumber: 'XXXXX169',
      email: 'MK****@hamad.qa',
    });
  });

  it.each([
    ['31141206', 'XXXXX206'],
    ['0097567534123', 'XXXXXXXXXX123'],
    ['55372169', 'XXXXX169'],
    ['+974 55 12 34', '+XXX XX X2 34'],
    [' 0097567534123 ', 'XXXXXXXXXX123'],
    ['123', 'XXX'],
    ['12', 'XX'],
    ['+12', '+XX'],
    ['', undefined],
    [undefined, undefined],
  ])('shows only the last three phone digits in the response: %s', async (phoneNumber, expected) => {
    const { service, otp } = makeService({ identity: { phoneNumber } });

    const res = await service.validateUser(DTO);

    expect(res.employeephonenumber).toBe(expected);
    expect(otp.send).toHaveBeenCalledWith(expect.objectContaining({ phoneNumber }));
  });

  it('valid unused OTP already exists: keeps it and answers vflag=Pending with remaining minutes', async () => {
    const { service, otp, devices } = makeService();
    devices.find.mockResolvedValue({ mpinSet: false, status: 'Inactive' });
    otp.send.mockResolvedValue({
      requestId: '311',
      status: 'PENDING',
      mode: 'SMS',
      validForSeconds: 240,
    });

    const res = await service.validateUser(DTO);

    expect(res).toMatchObject({
      status: 'success',
      message: 'An OTP was already sent and is still valid',
      newuser: 'Yes',
      vflag: 'Pending',
      otpmode: 'SMS',
      elapsedtimeinmins: 4,
      requestid: '311',
      employeephonenumber: 'XXXXX169',
    });
  });

  it('localizes the messages when lang=ar (header/query)', async () => {
    const { service, devices, otp } = makeService();
    devices.find.mockResolvedValue(undefined);

    const sent = await service.validateUser(DTO, 'ar');
    expect(sent.message).toBe('تم إرسال رمز التحقق بنجاح');
    expect(otp.send).toHaveBeenCalledWith(expect.objectContaining({ lang: 'ar' }));

    const { service: rejecting } = makeService({ identity: { isEmployee: false, roles: [] } });
    const rejected = await rejecting.validateUser(DTO, 'ar');
    expect(rejected).toEqual({ status: 'error', message: 'اسم المستخدم غير صحيح.' });
  });

  it('registered device WITHOUT an MPIN: no re-bind, OTP still sent', async () => {
    const { service, otp, devices } = makeService();
    devices.find.mockResolvedValue({ mpinSet: false, status: 'Inactive' });

    const res = await service.validateUser(DTO);

    expect(devices.bind).not.toHaveBeenCalled();
    expect(otp.send).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({
      newuser: 'Yes',
      vflag: 'New',
      requestid: '12345',
      devicestatus: 'Inactive',
    });
  });

  it('reports otpmode=Email when the OTP store used the email channel', async () => {
    const { service, otp, devices } = makeService({ identity: { phoneNumber: undefined } });
    devices.find.mockResolvedValue(undefined);
    otp.send.mockResolvedValue({
      requestId: '77',
      status: 'NEW',
      mode: 'Email',
      validForSeconds: 300,
    });

    const res = await service.validateUser(DTO);

    expect(res).toMatchObject({
      vflag: 'New',
      otpmode: 'Email',
      requestid: '77',
      employeephonenumber: undefined,
      email: 'MK****@hamad.qa',
    });
  });
});
