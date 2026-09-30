/**
 * The composite `ANNUAL_LEAVE_PASS_TKT_VALUE` of XXHMC_SND_CANCEL_TICKETS_V,
 * split into its nine pipe-separated segments:
 *
 *   requestFor |employeeName |passenger1 |passenger2 |passenger3 |passenger4 |contractYear |takenAs |amount
 *
 * e.g. `Self and Family |Amir |Caroline |Jerome Amir Sami |Jolie Amir Sami | |01-SEP-2025 to 31-AUG-2026 |Cash |20920`.
 * Segments are trimmed; an empty or missing segment is null (passengers are
 * only the non-empty ones), so a shorter value never throws. The composite
 * itself is still sent to CANCEL_TKT_PR verbatim — this is only for display
 * and for the values derived from it (`p_contractual_year`, the taken-as
 * fallback).
 */
export interface TicketComposite {
  requestFor: string | null;
  employeeName: string | null;
  passengers: string[];
  contractualYear: string | null;
  takenAs: string | null;
  amount: string | null;
}

export function parseTicketComposite(value: unknown): TicketComposite {
  const segments = typeof value === 'string' ? value.split('|').map((s) => s.trim()) : [];
  const at = (index: number): string | null => segments[index] || null;
  return {
    requestFor: at(0),
    employeeName: at(1),
    passengers: [2, 3, 4, 5].map(at).filter((name): name is string => name !== null),
    contractualYear: at(6),
    takenAs: at(7),
    amount: at(8),
  };
}
