import { LookupsService } from '@lookups/application/lookups.service';
import { LovMapper } from '@lookups/infrastructure/oracle/lov.mapper';
import { localizeArTwins } from '@shared/utils/localize.util';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { AddressRepository, PhoneRepository } from '../domain/contact.repository';
import { AddressService, PhoneService } from './contact.service';

function make() {
  const getByObject = jest.fn().mockResolvedValue([]);
  const lookups = { getByObject } as unknown as LookupsService;
  return {
    address: new AddressService({} as AddressRepository, lookups),
    phone: new PhoneService({} as PhoneRepository, lookups),
    getByObject,
  };
}

describe('Contact LOV submit values', () => {
  it.each(['en', 'ar'] as const)(
    'keeps the English country name as used_value for lang=%s',
    async (lang) => {
      const { address, getByObject } = make();
      const country = Object.freeze({
        code: 'AD',
        meaning: 'Andorra',
        meaningAr: 'localized country label',
        used_value: 'Andorra',
      });
      getByObject.mockResolvedValue([country]);

      const items = await address.countryLov(lang);

      expect(getByObject).toHaveBeenCalledWith(ORACLE_OBJECTS.COUNTRY_LOV, lang);
      expect(items).toEqual([{ ...country, used_value: 'Andorra' }]);
    },
  );

  it('keeps used_value English after lang=ar localization', async () => {
    const { address, getByObject } = make();
    getByObject.mockResolvedValue([
      LovMapper.toItem({ CODE: 'QA', VALUE: 'Qatar', VALUEAR: encodeURIComponent('قطر') }, 'ar'),
    ]);

    const [item] = await address.countryLov('ar');

    expect(localizeArTwins(item, 'ar')).toEqual({ code: 'QA', meaning: 'قطر', used_value: 'Qatar' });
  });

  it('preserves an empty country list', async () => {
    const { address } = make();
    await expect(address.countryLov('en')).resolves.toEqual([]);
  });

  it('leaves phone-type submit values unchanged', async () => {
    const { phone, getByObject } = make();
    const items = [{ code: 'M', meaning: 'Mobile', used_value: 'Mobile' }];
    getByObject.mockResolvedValue(items);

    await expect(phone.phoneTypeLov('en')).resolves.toBe(items);
    expect(getByObject).toHaveBeenCalledWith(ORACLE_OBJECTS.PHONE_TYPE_V, 'en');
  });
});
