import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ClientContextDto } from './client-context.dto';
import { HealthCheckRequestDto } from './healthcheck.dto';
import { UserValidateRequestDto } from './onboarding.dto';

/**
 * `deviceid` is the WAF-safe alias of the legacy device-identifier keys: the
 * F5 in front of staging/production rejects any body carrying `imeinumber`
 * (block page, support ID 15468526370063513757, 2026-09-02). The DTOs accept
 * either key and mirror `deviceid` onto the legacy property so the services
 * (which read `imeinumber`/`deviceimei`) never see the difference.
 */
const validateDto = (type: new () => object, value: object) =>
  validate(plainToInstance(type, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

const BASE = { username: 'AIBRAHIM39', platform: 'android', appname: 'Sanaad', version: '1.0.0' };
const DEVICE_ID = 'a5b3d106-8d16-482f-bd4e-8c080a5da203';

describe('device-identifier alias (deviceid)', () => {
  it('accepts deviceid alone and mirrors it to imeinumber', async () => {
    const instance = plainToInstance(ClientContextDto, { ...BASE, deviceid: DEVICE_ID });
    expect(instance.imeinumber).toBe(DEVICE_ID);
    expect(await validate(instance, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(
      0,
    );
  });

  it('still accepts the legacy imeinumber alone', async () => {
    const errors = await validateDto(ClientContextDto, { ...BASE, imeinumber: DEVICE_ID });
    expect(errors).toHaveLength(0);
  });

  it('imeinumber wins when both are sent', () => {
    const instance = plainToInstance(ClientContextDto, {
      ...BASE,
      imeinumber: 'legacy-value',
      deviceid: DEVICE_ID,
    });
    expect(instance.imeinumber).toBe('legacy-value');
  });

  it('rejects a body with neither key, naming both in the message', async () => {
    const errors = await validateDto(ClientContextDto, { ...BASE });
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    expect(messages.some((m) => m.includes('deviceid') && m.includes('imeinumber'))).toBe(true);
  });

  it('unknown keys are still rejected (forbidNonWhitelisted intact)', async () => {
    const errors = await validateDto(ClientContextDto, {
      ...BASE,
      deviceid: DEVICE_ID,
      wrong_name: 'value',
    });
    expect(errors.some((e) => e.property === 'wrong_name')).toBe(true);
  });

  it('subclasses inherit the alias (auth journey DTOs extend ClientContextDto)', async () => {
    const instance = plainToInstance(UserValidateRequestDto, { ...BASE, deviceid: DEVICE_ID });
    expect(instance.imeinumber).toBe(DEVICE_ID);
    expect(await validate(instance, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(
      0,
    );
  });

  it('healthcheck mirrors deviceid to deviceimei', async () => {
    const instance = plainToInstance(HealthCheckRequestDto, { deviceid: DEVICE_ID });
    expect(instance.deviceimei).toBe(DEVICE_ID);
    expect(await validate(instance, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(
      0,
    );
  });
});
