import { Lang } from '@shared/domain/lang';
import { LovItem } from '@shared/domain/lov-item';
import { col, str, strAr } from '@shared/utils/mapper.util';

/**
 * Maps a generic Oracle LOV/view row to a LovItem. The `XXHMC_SND_*` LOVs expose
 * several unrelated column vocabularies, all documented in the Sanaad mapping:
 *
 *  - `CODE` / `VALUE` / `VALUEAR`                          — COUNTRY_LOV
 *  - `FLEX_VALUE_ID` / `FLEX_VALUE` / `FLEX_VALUE_MEANING` — value-set LOVs
 *    (EDU_STAGE_LOV, SCH_TERM_LOV, PASSPORT_TYPE, ...)
 *  - `CODE` / `DATA` / `DATAAR` / `DATATYPE`               — DEP_LOOKUP_LOV
 *  - `PLACE`, `NAME`, `CONTRACT_YEAR`, `DEFAULT_VALUE`     — single-column LOVs
 *  - `MEANING` / `MEANING_AR`                              — plain lookup LOVs
 *
 * Probing only `meaning`-style names meant the label was never found for the
 * value-set and country LOVs, and the "first non-null column" fallback then
 * returned the surrogate id — hence responses such as `{"code":"AD",
 * "meaning":"AD"}` and `{"code":"315540","meaning":"315540"}`. Labels are now
 * probed with the documented vocabularies first, and the generic fallback skips
 * the code column and the technical columns (ids, username, grouping type).
 * Arabic values are URL-decoded here (Anticorruption Layer).
 */
export class LovMapper {
  private static readonly CODE_COLUMNS = [
    'code',
    'lookup_code',
    'flex_value',
    'flexvalue',
    'flex_value_id',
    'flexvalueid',
    'meaning_code',
    'establishment_id',
    'establishmentid',
  ];

  private static readonly MEANING_COLUMNS = [
    'meaning',
    'flex_value_meaning',
    'flexvaluemeaning',
    // ABSENCE_REASON_V pairs LEAVE_REASON/LEAVE_REASON_AR with a LEAVE_TYPE
    // grouping column — the reason is the label, never the type.
    'leave_reason',
    'description',
    'display_value',
    'value',
    'data',
    'place',
    'contract_year',
    'contractyear',
    'default_value',
    'defaultvalue',
    'name',
    'meaning_en',
  ];

  private static readonly MEANING_AR_COLUMNS = [
    'meaning_ar',
    'meaningar',
    'flex_value_meaning_ar',
    'flexvaluemeaningar',
    'leave_reason_ar',
    'description_ar',
    'valuear',
    'value_ar',
    'dataar',
    'data_ar',
    'placear',
    'place_ar',
    'defaultvaluear',
    'default_value_ar',
    'namear',
    'name_ar',
  ];

  /** Column that groups the multi-type LOVs (DEP_LOOKUP_LOV exposes `D_DATA_TYPE`). */
  private static readonly TYPE_COLUMNS = ['datatype', 'data_type', 'd_data_type', 'lookup_type'];

  /** Never used as a label by the generic fallback. */
  private static readonly TECHNICAL_COLUMNS = new Set([
    'username',
    'user_name',
    'person_id',
    'employee_number',
    'object_version_number',
    'language',
    'lang',
    ...LovMapper.TYPE_COLUMNS,
  ]);

  /**
   * Record ids surfaced as their own `id` field, for views whose submit binds
   * the id rather than the label: RET_FRM_LEAV_PR runs TO_NUMBER on
   * `p_leave_details`, so op 56 needs ABSENCE_ATTENDANCE_ID and any text form
   * answers ORA-01722.
   *
   * Deliberately additive — `code`/`meaning`/`used_value` keep the values they
   * always had, so a client that does not know about `id` behaves exactly as
   * before.
   */
  private static readonly RECORD_ID_COLUMNS = ['absence_attendance_id'];

  static toItem(row: Record<string, any>, _lang: Lang): LovItem {
    const codeColumn = this.firstColumn(row, this.CODE_COLUMNS);
    const code = codeColumn ? str(row, codeColumn) : undefined;
    const meaning =
      this.firstString(row, this.MEANING_COLUMNS) ?? this.fallbackLabel(row, codeColumn);
    const meaningAr = this.firstArString(row, this.MEANING_AR_COLUMNS);
    const type = this.firstString(row, this.TYPE_COLUMNS);
    const id = this.firstString(row, this.RECORD_ID_COLUMNS);
    // Only when DESCRIPTION is carrying something other than the label — on
    // LETTER_NAME_LOV it holds the one language that letter exists in, which
    // op 17 must be given alongside the name.
    const description = this.firstString(row, ['description']);

    return {
      code: code ?? meaning ?? '',
      meaning: meaning ?? code ?? '',
      meaningAr,
      // Always the English label: `meaning` is localized (swapped for the
      // Arabic twin) by the ResponseInterceptor on lang=ar, while `used_value`
      // has no *Ar twin and therefore survives untouched — submits bind it.
      used_value: meaning ?? code ?? '',
      ...(type ? { type } : {}),
      ...(id ? { id } : {}),
      ...(description && description !== meaning ? { description } : {}),
    };
  }

  static toItems(rows: Record<string, any>[], lang: Lang): LovItem[] {
    return rows.map((r) => this.toItem(r, lang));
  }

  /**
   * Label for a LOV whose columns are not in the documented vocabularies: the
   * first descriptive column that is neither the code column, an id, nor a
   * technical column.
   */
  private static fallbackLabel(
    row: Record<string, any>,
    codeColumn: string | undefined,
  ): string | undefined {
    const key = Object.keys(row).find((k) => {
      const lower = k.toLowerCase();
      if (codeColumn && lower === codeColumn.toLowerCase()) return false;
      if (this.TECHNICAL_COLUMNS.has(lower)) return false;
      // Surrogate keys and Arabic twins are never the English label. Only a
      // suffix on a word boundary counts, so `academic_year` is not read as
      // Arabic and `visa_validity` is not read as an id.
      if (lower === 'id' || lower.endsWith('_id')) return false;
      if (lower.endsWith('_ar') || this.MEANING_AR_COLUMNS.includes(lower)) return false;
      return col(row, k) != null;
    });
    return key ? str(row, key) : undefined;
  }

  private static firstColumn(row: Record<string, any>, names: string[]): string | undefined {
    return names.find((name) => {
      const value = str(row, name);
      return value !== undefined && value !== '';
    });
  }

  private static firstString(row: Record<string, any>, names: string[]): string | undefined {
    const name = this.firstColumn(row, names);
    return name ? str(row, name) : undefined;
  }

  private static firstArString(row: Record<string, any>, names: string[]): string | undefined {
    for (const name of names) {
      const value = strAr(row, name);
      if (value !== undefined && value !== '') return value;
    }
    return undefined;
  }
}
