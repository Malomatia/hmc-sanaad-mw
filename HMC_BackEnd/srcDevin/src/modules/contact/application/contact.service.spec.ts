import { LookupsService } from '@lookups/application/lookups.service';
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
    'uses the country code for lang=%s without changing labels or cached items',
    async (lang) => {
      const { address, getByObject } = make();
      const country = Object.freeze({
        code: 'AD',
        meaning: 'Andorra',
        meaningAr: 'localized country label',
        used_value: 'Andorra',
      });
      const cached = Object.freeze([country]);
      getByObject.mockResolvedValue(cached);

      const items = await address.countryLov(lang);

      expect(getByObject).toHaveBeenCalledWith(ORACLE_OBJECTS.COUNTRY_LOV, lang);
      expect(items).toEqual([{ ...country, used_value: 'AD' }]);
      expect(items).not.toBe(cached);
      expect(items[0]).not.toBe(country);
      expect(country.used_value).toBe('Andorra');
    },
  );

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
