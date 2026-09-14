import oracledb = require('oracledb');

const USERNAME_FIELD = /^(?:p_?)?(?:(?:(?:from|to|requestor|approver)_?)?user_?name|dusername)$/i;

function normalizeValue(value: unknown): unknown {
  if (typeof value === 'string') return value.toUpperCase();
  if (Array.isArray(value)) {
    return value.map((item: unknown) => (typeof item === 'string' ? item.toUpperCase() : item));
  }
  return value;
}

export function normalizeOracleUsername(name: string, value: unknown): unknown {
  if (!USERNAME_FIELD.test(name)) return value;
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !Buffer.isBuffer(value)
  ) {
    const bind = value as Record<string, unknown>;
    if (bind.dir === oracledb.BIND_OUT) return value;
    if (
      'val' in bind &&
      ('type' in bind || bind.dir === oracledb.BIND_IN || bind.dir === oracledb.BIND_INOUT)
    ) {
      const val = normalizeValue(bind.val);
      return val === bind.val ? value : { ...bind, val };
    }
  }
  return normalizeValue(value);
}

export function normalizeOracleUsernameBinds(
  binds: oracledb.BindParameters,
): oracledb.BindParameters {
  if (Array.isArray(binds)) return binds;
  return Object.fromEntries(
    Object.entries(binds).map(([name, value]) => [name, normalizeOracleUsername(name, value)]),
  ) as oracledb.BindParameters;
}
