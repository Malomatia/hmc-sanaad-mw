import { NotFoundException } from '@nestjs/common';
import { OracleQueryError } from '../database/oracle.error';
import { classifyException } from './exception-classifier';
import { ErrorCategory } from './error-category';

/**
 * ORA-01403 only escapes from a SELECT INTO inside a procedure — i.e. a value
 * WE submitted did not resolve. Reporting it as 404 "The requested resource was
 * not found" pointed at the wrong thing: op 17 answered 404 for a bad
 * letter/language pair, an unknown delivery location and a mobile that is not
 * the employee's alike, so the only way to tell them apart was to read the
 * Oracle log. It is a rejected input; it should read like one.
 */
describe('a submitted value that Oracle could not resolve', () => {
  const noDataFound = () => new OracleQueryError('ORA-01403: no data found', 1403);

  it('is 422, not 404', () => {
    const classified = classifyException(noDataFound());

    expect(classified.httpStatus).toBe(422);
    expect(classified.category).toBe(ErrorCategory.UNRESOLVED_VALUE);
  });

  it('says which kind of value to re-check, without leaking Oracle detail', () => {
    const { message } = classifyException(noDataFound());

    expect(message).toMatch(/not recognised/i);
    expect(message).toMatch(/lookup|LOV/i);
    expect(message).not.toMatch(/ORA-|SELECT|01403/);
  });

  it('is a client fault, so it is logged as a warning', () => {
    expect(classifyException(noDataFound()).serverSide).toBe(false);
  });

  it('leaves a genuine 404 alone', () => {
    const classified = classifyException(new NotFoundException('no such route'));

    expect(classified.httpStatus).toBe(404);
    expect(classified.category).toBe(ErrorCategory.NOT_FOUND);
  });

  it('still treats ORA-20xxx as a business rule', () => {
    const classified = classifyException(
      new OracleQueryError('ORA-20001: FLEX-VALUE DOES NOT EXIST', 20001),
    );

    expect(classified.category).toBe(ErrorCategory.BUSINESS_RULE_ERROR);
  });
});
