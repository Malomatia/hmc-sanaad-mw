import { parseTicketComposite } from './annual-ticket-composite.util';

describe('parseTicketComposite', () => {
  it('splits the nine segments of the live composite and trims them', () => {
    expect(
      parseTicketComposite(
        'Self and Family |Amir |Caroline |Jerome Amir Sami |Jolie Amir Sami | |01-SEP-2025 to 31-AUG-2026 |Cash |20920',
      ),
    ).toEqual({
      requestFor: 'Self and Family',
      employeeName: 'Amir',
      passengers: ['Caroline', 'Jerome Amir Sami', 'Jolie Amir Sami'],
      contractualYear: '01-SEP-2025 to 31-AUG-2026',
      takenAs: 'Cash',
      amount: '20920',
    });
  });

  it('keeps passengers only for non-empty segments 2..5', () => {
    expect(
      parseTicketComposite('Self |Amir | | | | |01-SEP-2024 to 31-AUG-2025 |Voucher |30000'),
    ).toMatchObject({
      requestFor: 'Self',
      passengers: [],
      contractualYear: '01-SEP-2024 to 31-AUG-2025',
      takenAs: 'Voucher',
      amount: '30000',
    });
  });

  it('tolerates missing trailing segments', () => {
    expect(parseTicketComposite('Family |Amir |Caroline')).toEqual({
      requestFor: 'Family',
      employeeName: 'Amir',
      passengers: ['Caroline'],
      contractualYear: null,
      takenAs: null,
      amount: null,
    });
  });

  it.each([[null], [undefined], [''], [42]])('returns an empty composite for %p', (value) => {
    expect(parseTicketComposite(value)).toEqual({
      requestFor: null,
      employeeName: null,
      passengers: [],
      contractualYear: null,
      takenAs: null,
      amount: null,
    });
  });
});
