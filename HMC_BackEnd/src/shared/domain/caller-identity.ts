export interface CallerIdentity {
  username: string;
  employeeNumber?: string;
  personId?: string;
}

export function normalizePersonId(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : undefined;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return undefined;
  const id = value.trim().replace(/^0+(?=\d)/, '');
  return id === '0' ? undefined : id;
}
