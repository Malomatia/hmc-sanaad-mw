import { FunctionAccess } from '../auth-identity';

/**
 * Resolves the module/function access list for an employee (login API-5,
 * `functionaccesslist`). Backed by an HR/Oracle mapping of employee → enabled
 * function codes. Source object pending.
 */
export interface FunctionAccessPort {
  list(employeeNumber: string): Promise<FunctionAccess[]>;
}

export const FUNCTION_ACCESS_PORT = Symbol('FUNCTION_ACCESS_PORT');
