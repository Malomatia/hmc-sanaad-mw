# Generic LOV endpoint — allowed `lovname` values

> Allow-list for `GET /api/v1/lookups/lov?lovname=...&lang=en|ar[&username=...]`.
> Source of truth: `HMC_BackEnd/src/shared/constants/lov-names.ts` (`LOV_OBJECT`) —
> the ONLY place the public-LOV-name mapping lives; it doubles as the
> injection-safe allow-list. Any name not listed here returns
> `400 Unknown LOV name: <name>`. Keep this file in sync when editing `LOV_OBJECT`.

Notes:

- Responses use the LOV envelope `{ items: [{ code, meaning }] }`; `meaning`
  carries the value for the requested `lang` (Arabic twins are collapsed by the
  `ResponseInterceptor`).
- Reads are cached per (lovname, lang, username, options) for `LOV_CACHE_TTL_MS`
  (default 5 min).
- User-scoped LOVs (`RFL_LEAVE_DET_LOV`, `LEAVE_CANCEL_LOV`, `LEAVE_TO_AMEND_LOV`,
  `RFMI_USER_LOV`, defaults LOVs) take the optional `username` query param;
  `LEAVE_TO_AMEND_LOV` is scoped by employee number in the legacy service.
- `SCHOOL_NAME_LOV` additionally supports `search` / `page` / `pageSize`.

## Profile / contact

| `lovname` | Purpose |
|---|---|
| `EMP_MARITAL_LOV` | Marital-status codes (op 63) — used by `POST /profile/personal` (`p_marital_status`). |
| `COUNTRY_LOV` | Country codes for addresses and letters (`p_country`, `p_country_of_issue`). |
| `PHONE_TYPE_LOV` | Phone types for the contact phone upsert (op 28). |

## Leave

| `lovname` | Purpose |
|---|---|
| `LEAVE_BAL_PLAN_LOV` | Accrual plans for the leave-balance query (op 9 `accurlpln`). |
| `ABSENCE_TYPE_LOV` | Leave types (op 12) — `p_absence_type` of leave apply. |
| `ABSENCE_REASON_LOV` | Leave reasons (op 13) — `p_absence_reason`. |
| `LEAV_CLASS_LOV` | Leave classification, Inside/Outside Qatar (op 14) — `p_leave_classification`. |
| `LEAVE_TYPE_LOV` | Leave-type list used by the request LOV bundle (op 46). |
| `NUM_OF_CHILD_LOV` | Number-of-children options for maternity leave — `p_number_of_children`. |
| `EXAM_CENTRE_LOV` | Examination centres for examination leave — `p_examination_centre`. |
| `BEREAV_RELAT_LOV` | Relationship of the bereaved for compassionate leave — `p_relationship_bereaved`. |
| `BEREAVED_RELATIONSHIP_LOV` | Legacy public spelling of the same LOV (`Lovname=BEREAVED_RELATIONSHIP_LOV` on the old gateway) — alias of `BEREAV_RELAT_LOV`. |
| `CONTRACT_YEAR_LOV` | Contractual-year options — `p_contractual_year`. |
| `ANNUAL_TICKT_LOV` | Annual-ticket default for leave defaults (op 45) — `p_annual_tkt`. |
| `LIBR_DFALT_LOV` | Leave-inclusive-bonus default (op 45) — `p_leave_inc_bonus`. |
| `ALSR_DFALT_LOV` | Advance-leave-salary default (op 45) — `p_adv_leave_salary`. |
| `RFL_REL_LEAVE1_LOV` | Related leave #1 for return-from-leave — `p_related_leave1`. |
| `RFL_REL_LEAVE2_LOV` | Related leave #2 for return-from-leave — `p_related_leave2`. |
| `RFL_LEAVE_DET_LOV` | Leaves eligible for return (op 55, user-scoped) — `p_leave_details` of `POST /leave/return`. |
| `LEAVE_CANCEL_LOV` | Leaves eligible for cancellation (op 61, user-scoped) — `p_leave_to_cancel`. |
| `LEAVE_TO_AMEND_LOV` | Leaves eligible for amendment (op 62, scoped by employee number) — `p_leave_to_amend`. |

## Letters

| `lovname` | Purpose |
|---|---|
| `LETTER_MOBILE_NO_LOV` | Mobile numbers selectable on a letter request. |
| `LETTER_COUNTRY_LOV` | Destination countries for letters. |
| `LETTER_NAME_LOV` | Letter types/names that can be requested. |
| `LETTER_LANGUAGE_LOV` | Letter languages. |
| `EXIT_COPIES_LOV` | Number-of-copies options for exit letters. |
| `DELIVERY_LOC_LOV` | Letter delivery locations. |
| `EMP_LTR_DEFAULT_COPY` | Default number of letter copies for the employee. |

## Identity (QID / SIT)

| `lovname` | Purpose |
|---|---|
| `SIT_WORK_LOC_LOV` | Work locations for the QID-change request. |
| `SIT_DELEV_LOC_LOV` | Delivery locations for the QID-change request. |
| `SIT_REASON_LOV` | Reasons for the QID-change request. |

## Dependents

| `lovname` | Purpose |
|---|---|
| `DEP_LOOKUP_LOV` | Multi-type dependent lookups (rows carry a `type` grouping column). |
| `DEP_PLACE_LOV` | Places of issue for dependent documents. |
| `PASSPORT_TYPE_LOV` | Passport types — `p_type_of_passport` of the passport submit. |

## School fees

| `lovname` | Purpose |
|---|---|
| `SCHOOL_NAME_LOV` | School names (`search`/`page`/`pageSize` supported) — `p_school_name`. |
| `SCHOOL_TERM_LOV` | School terms. |
| `EDU_STAGE_LOV` | Education stages. |
| `ACAD_YR_STRT_END_LOV` | Academic-year start/end tokens (`acadyrstrtdt`). |
| `REQUEST_TYPE_LOV` | School-fee request types — `p_request_type`. |

## Annual ticket / shared

| `lovname` | Purpose |
|---|---|
| `TICKET_MASTER_LOV` | Annual-ticket master data for the ticket request. |
| `YES_NO_LOV` | Generic Yes/No options (op 15; also `GET /lookups/yes-no`). |
| `RFMI_USER_LOV` | RFMI user list (op 26; also `GET /lookups/rfmi-user`). |
| `EMPLOYMENT_STATUS_LOV` | Employment-status options (`XXHMC_SND_EMPLOYMENT_STATUS_LOV`). |

## JSON (name → purpose)

```json
{
  "EMP_MARITAL_LOV": "Marital-status codes for the personal-details update",
  "COUNTRY_LOV": "Country codes for addresses and letters",
  "PHONE_TYPE_LOV": "Phone types for the contact phone upsert",
  "LEAVE_BAL_PLAN_LOV": "Accrual plans for the leave-balance query",
  "ABSENCE_TYPE_LOV": "Leave types (p_absence_type)",
  "ABSENCE_REASON_LOV": "Leave reasons (p_absence_reason)",
  "LEAV_CLASS_LOV": "Leave classification Inside/Outside Qatar",
  "LEAVE_TYPE_LOV": "Leave-type list for the request LOV bundle",
  "NUM_OF_CHILD_LOV": "Number-of-children options (maternity leave)",
  "EXAM_CENTRE_LOV": "Examination centres (examination leave)",
  "BEREAV_RELAT_LOV": "Relationship of the bereaved (compassionate leave)",
  "BEREAVED_RELATIONSHIP_LOV": "Legacy spelling — alias of BEREAV_RELAT_LOV",
  "CONTRACT_YEAR_LOV": "Contractual-year options",
  "ANNUAL_TICKT_LOV": "Annual-ticket default (leave defaults)",
  "LIBR_DFALT_LOV": "Leave-inclusive-bonus default (leave defaults)",
  "ALSR_DFALT_LOV": "Advance-leave-salary default (leave defaults)",
  "RFL_REL_LEAVE1_LOV": "Related leave #1 (return from leave)",
  "RFL_REL_LEAVE2_LOV": "Related leave #2 (return from leave)",
  "RFL_LEAVE_DET_LOV": "Leaves eligible for return (user-scoped)",
  "LEAVE_CANCEL_LOV": "Leaves eligible for cancellation (user-scoped)",
  "LEAVE_TO_AMEND_LOV": "Leaves eligible for amendment (employee-number-scoped)",
  "LETTER_MOBILE_NO_LOV": "Mobile numbers for letter requests",
  "LETTER_COUNTRY_LOV": "Destination countries for letters",
  "LETTER_NAME_LOV": "Letter types/names",
  "LETTER_LANGUAGE_LOV": "Letter languages",
  "EXIT_COPIES_LOV": "Copies options for exit letters",
  "DELIVERY_LOC_LOV": "Letter delivery locations",
  "EMP_LTR_DEFAULT_COPY": "Default number of letter copies",
  "SIT_WORK_LOC_LOV": "Work locations (QID change)",
  "SIT_DELEV_LOC_LOV": "Delivery locations (QID change)",
  "SIT_REASON_LOV": "Reasons (QID change)",
  "DEP_LOOKUP_LOV": "Multi-type dependent lookups (rows carry a type column)",
  "DEP_PLACE_LOV": "Places of issue for dependent documents",
  "PASSPORT_TYPE_LOV": "Passport types",
  "SCHOOL_NAME_LOV": "School names (search/page/pageSize supported)",
  "SCHOOL_TERM_LOV": "School terms",
  "EDU_STAGE_LOV": "Education stages",
  "ACAD_YR_STRT_END_LOV": "Academic-year start/end tokens",
  "REQUEST_TYPE_LOV": "School-fee request types",
  "TICKET_MASTER_LOV": "Annual-ticket master data",
  "YES_NO_LOV": "Generic Yes/No options",
  "RFMI_USER_LOV": "RFMI user list",
  "EMPLOYMENT_STATUS_LOV": "Employment-status options"
}
```
