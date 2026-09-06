import { ConfigService } from '@nestjs/config';
import { AuditService } from '@core/audit/audit.service';
import { OnboardingService } from './onboarding.service';
import { LdapUserPort } from '../domain/ports/ldap-user.port';
import { OtpPort } from '../domain/ports/otp.port';
import { DeviceRegistryPort } from '../domain/ports/device-registry.port';

const IDENTITY = {
  username: 'MKHOJA',
  employeeNumber: '011759',
  employeeName: 'Mouna Bent Abdelkerim Khoja',
  department: 'Cardiothoracic Surgery.Heart Hospital',
  jobName: 'Cardiac Technologist.HMC',
  email: 'MKHOJA@hamad.qa',
  phoneNumber: '55372169',
  isEmployee: true,
  isNewUser: true,
  roles: ['employee'],
};

const DTO = { username: 'MKHOJA', imeinumber: 'imei-1', platform: 'Android', version: '1.0.0' };

function makeService(overrides?: { identity?: Partial<typeof IDENTITY> }) {
  const ldap = {
    validate: jest.fn().mockResolvedValue({ ...IDENTITY, ...overrides?.identity }),
    authenticate: jest.fn(),
  } as unknown as jest.Mocked<LdapUserPort>;
  const otp = {
    send: jest.fn().mockResolvedValue({ requestId: '12345' }),
    verify: jest.fn(),
  } as unknown as jest.Mocked<OtpPort>;
  const devices = {
    bind: jest.fn().mockResolvedValue(undefined),
    isBound: jest.fn(),
    find: jest.fn(),
  } as unknown as jest.Mocked<DeviceRegistryPort>;
  const audit = { lifecycle: jest.fn() } as unknown as jest.Mocked<AuditService>;
  const config = { get: jest.fn().mockReturnValue(false) } as unknown as ConfigService;
  return {
    service: new OnboardingService(ldap, otp, devices, audit, config),
    ldap,
    otp,
    devices,
  };
}

describe('OnboardingService.validateUser (reworked initiate, 2026-09-03)', () => {
  it('rejects a username absent from the employee view without touching the device table', async () => {
    const { service, otp, devices } = makeService({
      identity: { isEmployee: false, roles: [] },
    });

    const res = await service.validateUser(DTO);

    expect(res).toEqual({ status: 'error', message: 'User not found.' });
    expect(devices.find).not.toHaveBeenCalled();
    expect(devices.bind).not.toHaveBeenCalled();
    expect(otp.send).not.toHaveBeenCalled();
  });

  it('existing user (device registered with MPIN): full data from both tables, NO OTP', async () => {
    const { service, otp, devices } = makeService();
    devices.find.mockResolvedValue({ mpinSet: true, status: 'Active' });

    const res = await service.validateUser(DTO);

    expect(res).toMatchObject({
      status: 'success',
      employeeusername: 'MKHOJA',
      employeename: IDENTITY.employeeName,
      employeenumber: '011759',
      jobname: IDENTITY.jobName,
      email: IDENTITY.email,
      department: IDENTITY.department,
      employeephonenumber: '55372169',
      devicestatus: 'Active',
      newuser: 'No',
      employeeflag: 'Yes',
    });
    expect(res.requestid).toBeUndefined();
    expect(otp.send).not.toHaveBeenCalled();
    expect(devices.bind).not.toHaveBeenCalled();
  });

  it('new device: creates the registration (Inactive) and sends the OTP', async () => {
    const { service, otp, devices } = makeService();
    devices.find.mockResolvedValue(undefined);

    const res = await service.validateUser(DTO);

    expect(devices.bind).toHaveBeenCalledWith({
      username: 'MKHOJA',
      imei: 'imei-1',
      platform: 'Android',
    });
    expect(otp.send).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'MKHOJA',
        phoneNumber: '55372169',
        imei: 'imei-1',
        purpose: 'ONBOARDING',
        appVersion: '1.0.0',
      }),
    );
    expect(res).toMatchObject({
      status: 'success',
      message: 'OTP sent successfully',
      newuser: 'Yes',
      requestid: '12345',
    });
  });

  it('registered device WITHOUT an MPIN: no re-bind, OTP still sent', async () => {
    const { service, otp, devices } = makeService();
    devices.find.mockResolvedValue({ mpinSet: false, status: 'Inactive' });

    const res = await service.validateUser(DTO);

    expect(devices.bind).not.toHaveBeenCalled();
    expect(otp.send).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({
      newuser: 'Yes',
      requestid: '12345',
      devicestatus: 'Inactive',
    });
  });
});
