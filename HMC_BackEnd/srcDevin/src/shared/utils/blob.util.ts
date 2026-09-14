/**
 * A BLOB IN value: base64 text (as sent by every client) → `Buffer`;
 * null/undefined/empty stay `null`. Binding the raw base64 string to a BLOB
 * formal is a type mismatch (`PLS-00306: wrong number or types of
 * arguments`) — node-oracledb needs an actual `Buffer` to bind a real LOB.
 */
export function toBlobBuffer(value: unknown): Buffer | null {
  if (value === null || value === undefined || value === '') return null;
  if (Buffer.isBuffer(value)) return value;
  return Buffer.from(String(value), 'base64');
}
