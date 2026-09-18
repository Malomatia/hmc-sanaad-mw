export interface OracleUserValidationPort {
  validate(username: string): Promise<boolean>;
}

export const ORACLE_USER_VALIDATION_PORT = Symbol('ORACLE_USER_VALIDATION_PORT');
