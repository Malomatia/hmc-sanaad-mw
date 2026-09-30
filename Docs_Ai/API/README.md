# API Catalog — Target NestJS Endpoints (by Module)

> Proposed REST surface for the new NestJS backend, derived 1:1 from the 71 operations in `sanaad-api-service-mapping.html`. Legacy gateway paths are preserved in `Docs Project/Legacy APIs/README.md`; here every operation is normalized under a versioned prefix.

## Conventions
- **Base:** `/{prefix}` where `prefix = api/v1`. Full UAT host: `https://apigwuat.api.hamad.qa/sanaad` → mapped to `https://<host>/api/v1`.
- **Auth:** all routes require `Authorization: Bearer <jwt>` except `@Public()` login (op 1). Approver/supervisor routes add `@Roles(...)`.
- **i18n:** `lang` query (`en|ar`, default `en`) on reads; Arabic values URL-decoded by the mapper.
- **Validation:** global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`); DTO names below.
- **Success envelope:** `{ result, opstatus:0, status:"success", httpStatusCode:200 }`. **Action envelope:** `{ status, successflag:"S", errormessage, result }`.
- **Error envelope:** `{ status:"error", opstatus:1, errormessage, httpStatusCode }` (see per-module error rows; produced by `OracleExceptionFilter`/`AllExceptionsFilter`).
- **Common errors:** `400` validation, `401` missing/invalid token, `403` role, `404`/empty for `ORA-01403 no data found`, `502` Oracle/Cerner unavailable, `500` unexpected.
- `*` after a method = inferred (source lacked an explicit badge); confirm during implementation.

---

## Module: `auth` (op 1)
| Op | Method | Route | Req DTO | Resp DTO | Auth | Service → Repo → Oracle |
|---|---|---|---|---|---|---|
| 1 | POST | `/auth/login` | `LoginRequestDto` *(spec pending)* | `TokenResponseDto` | Public | `AuthService.login` → (external IdP/gateway) |
| — | GET | `/auth/me` | — | `MeResponseDto` | Bearer | `AuthService.me` → `ProfileRepository` → `PERSONAL_DETAILS_V` |

**Errors:** 401 invalid credentials/token. **Note:** login body/flow is out-of-band; guard + `@Public()` scaffolded.

## Module: `profile` (ops 2, 48, 63)
| Op | Method | Route | Req DTO | Resp DTO | Roles | Service / Oracle |
|---|---|---|---|---|---|---|
| 2 | GET | `/profile?enum&lang` | `ProfileQueryDto` | `ProfileResponseDto` | — | `ProfileService.get` → `PERSONAL_DETAILS_V, EMP_PHONE_V, EMP_OUT_ADDRESS_V, TEMP_ADD_TYPE_V, DEP_PHONE_V, PND_DEPENDENT_ADDR_V, COUNTRY_LOV` |
| 48 | POST* | `/profile/personal` | `UpdatePersonalRequestDto` | `SubmitResultDto` | — | `ProfileService.updatePersonal` → `UPD_PERSONAL_INFO_PR` |
| 63 | GET | `/profile/lov/marital-status?lang` | `LangQueryDto` | `LovResponseDto` | — | `ProfileService.maritalStatusLov` → `EMP_MARITAL_LOV` |

**Validation:** `enum` required string; `lang∈{en,ar}`. **Errors:** 404/empty (no employee), 400.

## Module: `employee` (ops 3, 7, 8, 35, 36)
| Op | Method | Route | Req DTO | Resp DTO | Roles | Oracle |
|---|---|---|---|---|---|---|
| 3 | GET | `/employee/employment?enum&lang` | `ProfileQueryDto` | `EmploymentDetailsResponseDto` | — | `EMPLOYMENT_DETAILS_V, GET_PAYSLIP_PERIODS` |
| 8 | GET | `/employee/basic?enum&lang` | `ProfileQueryDto` | `BasicEmpResponseDto` | — | `EMPLOYMENT_DETAILS_V` |
| 7 | GET | `/employee/performance?enum&lang` | `ProfileQueryDto` | `PerformanceResponseDto` | — | `PERFORMANCE_V` |
| 35 | GET | `/employee/supervisor/views?enum&lang` | `ProfileQueryDto` | `SupervisorViewResponseDto` | `SUPERVISOR` | `SUPERVISOR_VIEW` |
| 36 | POST* | `/employee/supervisor` | `SupervisorUpdateRequestDto` | `SubmitResultDto` | `SUPERVISOR` | `SUPERVISOR_PR` |

## Module: `payslip` (ops 5, 6, 11)
| Op | Method | Route | Req DTO | Resp DTO | Oracle |
|---|---|---|---|---|---|
| 5 | GET | `/payslip/periods?enum&lang` | `ProfileQueryDto` | `PayslipPeriodResponseDto` | `GET_PAYSLIP_PERIODS` |
| 6 | GET | `/payslip/count?enum&lang&payslipperiod` | `PayslipCountQueryDto` | `PayslipCountResponseDto` | `CHK_PAYROLL_CNT` |
| 11 | GET | `/payslip?enum&lang&payperiod&assignmentid` | `PayslipQueryDto` | `PayslipResponseDto` | `PAYSLIP_PR` |

**Validation:** `payperiod` matches `"Month YYYY"`; `assignmentid` numeric string.

## Module: `leave` (ops 9,10,12,13,14,45,46,47,55,56,57,58,61,62)
| Op | Method | Route | Req DTO | Resp DTO | Oracle |
|---|---|---|---|---|---|
| 9 | GET | `/leave/balance?enum&lang&accurlpln&effectivedate` | `LeaveBalanceQueryDto` | `LeaveBalanceResponseDto` | `LEAVE_BAL_PLAN_LOV, LEAVE_BALANCE_PR` |
| 10 | POST | `/leave/apply` | `ApplyLeaveRequestDto` | `SubmitResultDto` | `LEAV_OF_ABSEN_NEW_PR` |
| 47 | POST* | `/leave/calculate` | `LeaveCalcRequestDto` | `LeaveCalcResponseDto` | `CALC_LEAV_DUR_PR` |
| 57 | POST* | `/leave/amend` | `AmendLeaveRequestDto` | `SubmitResultDto` | `HR_LEAV_AMEND_PR, RET_FRM_LEAV_PR` |
| 58 | POST* | `/leave/cancel` | `CancelLeaveRequestDto` | `SubmitResultDto` | `HR_LEAV_CANCEL_PR, RET_FRM_LEAV_PR` |
| 56 | POST* | `/leave/return` | `ReturnFromLeaveRequestDto` | `SubmitResultDto` | `RET_FRM_LEAV_PR` |
| 12 | GET | `/leave/lov/types?lang` | `LangQueryDto` | `LovResponseDto` | `ABSENCE_TYPE_V` |
| 13 | GET | `/leave/lov/reasons?lang` | `LangQueryDto` | `LovResponseDto` | `ABSENCE_REASON_V` |
| 14 | GET | `/leave/lov/classes?lang` | `LangQueryDto` | `LovResponseDto` | `LEAV_CLASS_V` |
| 45 | GET* | `/leave/lov/defaults?enum&lang` | `ProfileQueryDto` | `LeaveDefaultsResponseDto` | `EMPLOYMENT_DETAILS_V, ANNUAL_TICKT_LOV, LIBR_DFALT_LOV, ALSR_DFALT_LOV, CONTRACT_YEAR_V` |
| 46 | GET | `/leave/lov/request-lov?enum&lang` | `ProfileQueryDto` | `LeaveRequestLovResponseDto` | `NUM_OF_CHILD_V, LEAV_CLASS_V, EXAM_CENTRE_V, BEREAV_RELAT_V, CONTRACT_YEAR_V, ABSENCE_TYPE_V, ABSENCE_REASON_V, LEAVE_TYPE_V` |
| 55 | GET | `/leave/lov/return?username&lang` | `LovUserQueryDto` | `LovResponseDto` | `RFL_REL_LEAVE1_V, RFL_REL_LEAVE2_V, RFL_LEAVE_DET_V` |
| 61 | GET* | `/leave/lov/cancel?username&lang` | `LovUserQueryDto` | `LovResponseDto` | `LEAVE_CANCEL_V` |
| 62 | GET | `/leave/lov/amend?username&lang` | `LovUserQueryDto` | `LovResponseDto` | `LEAVE_AMEND_V` |

**Notes:** op 16-style fan-out; parallelize LOV reads. Empty balance (`ORA-01403`) → empty result, not error.

## Module: `letters` (ops 16, 17)
| Op | Method | Route | Req DTO | Resp DTO | Oracle |
|---|---|---|---|---|---|
| 16 | GET | `/letters/lov?enum&lang` | `ProfileQueryDto` | `LetterLovResponseDto` | `LETTER_MOBILE_NO_LOV, EMP_LTR_DEFAULT_COPY, LETTER_COUNTRY_LOV, LETTER_NAME_LOV, LETTER_LANGUAGE_LOV, EXIT_COPIES_LOV, DELIVERY_LOC_V` |
| 17 | POST* | `/letters/apply` | `LetterReqSubmitDto` | `SubmitResultDto` | `HR_EMPLYMNT_LTR_PR` |

## Module: `identity` (ops 18, 19, 53b, 54, 59, 60)
| Op | Method | Route | Req DTO | Resp DTO | Oracle |
|---|---|---|---|---|---|
| 18 | GET* | `/identity/qid?enum&lang` | `ProfileQueryDto` | `QidDetailResponseDto` | `QID_DET_V` |
| 19 | POST* | `/identity/qid/update` | `QidUpdateRequestDto` | `SubmitResultDto` | `QID_CHG_PR` |
| 54 | POST | `/identity/idcard/apply` | `CompanyIdRequestDto` | `SubmitResultDto` | `COID_REQ_PR` |
| 53b | GET | `/identity/lov/work-location?lang` | `LangQueryDto` | `LovResponseDto` | `SIT_WORK_LOC_V` |
| 59 | GET | `/identity/lov/delivery-location?lang` | `LangQueryDto` | `LovResponseDto` | `SIT_DELEV_LOC_V` |
| 60 | GET | `/identity/lov/reason?lang` | `LangQueryDto` | `LovResponseDto` | `SIT_REASON_V` |

**Roles:** QID/ID-card reads self-scoped; surfaced to approvers via `approvals`.

## Module: `contact` (ops 25, 27, 28, 29, 30, 32)
| Op | Method | Route | Req DTO | Resp DTO | Oracle |
|---|---|---|---|---|---|
| 27 | GET | `/contact/lov/phone-type?lang` | `LangQueryDto` | `LovResponseDto` | `PHONE_TYPE_V` |
| 28 | POST | `/contact/phone` | `UpdatePhoneRequestDto` | `SubmitResultDto` | `PHONE_PKG` |
| 32 | POST* | `/contact/phone/delete` | `DeletePhoneRequestDto` | `SubmitResultDto` | `DEL_PHONE_NUMBER_PR` |
| 29 | POST* | `/contact/address` | `CreateAddressRequestDto` | `SubmitResultDto` | `CREATE_ADDRESS_PR` |
| 25 | POST* | `/contact/address/update` | `UpdateAddressRequestDto` | `SubmitResultDto` | `UPD_ADDRESS_PR` |
| 30 | GET | `/contact/lov/country?lang` | `LangQueryDto` | `LovResponseDto` | `COUNTRY_LOV` |

## Module: `dependents` (ops 24, 31, 33, 34, 49, 64, 65)
| Op | Method | Route | Req DTO | Resp DTO | Oracle |
|---|---|---|---|---|---|
| 65 | POST* | `/dependents` | `AddDependentRequestDto` | `SubmitResultDto` | `ADD_DEPENDENT_PKG, ADD_DEPENDENT_PR, CREATE_ADDRESS_PR` |
| 24 | POST* | `/dependents/update` | `UpdateDependentRequestDto` | `SubmitResultDto` | `ADD_DEPENDENT_PKG, UPDATE_DEPENDENT_PR` |
| 31 | POST | `/dependents/delete` | `DeleteDependentRequestDto` | `SubmitResultDto` | `REMOVE_DEPENDENT_PR` |
| 64 | GET | `/dependents/lov?lang` | `LangQueryDto` | `LovResponseDto` | `DEP_LOOKUP_LOV` |
| 33 | GET | `/dependents/passport/types?lang` | `LangQueryDto` | `LovResponseDto` | `PASSPORT_TYPE` |
| 34 | POST* | `/dependents/passport/apply` | `PassportDetailRequestDto` | `SubmitResultDto` | `PASS_DTL_PR` |
| 49 | GET | `/dependents/passport/issue-place?lang` | `LangQueryDto` | `LovResponseDto` | `DEP_PLACE_LOV` |

## Module: `school-fees` (ops 37, 38, 39, 40, 50, 52, 53; 51 out of scope)
| Op | Method | Route | Req DTO | Resp DTO | Oracle |
|---|---|---|---|---|---|
| 39 | POST* | `/school-fees/apply` | `SchoolFeeRequestDto` | `SubmitResultDto` | `SCHOOL_FEE_PR` |
| 37 | GET | `/school-fees/lov/schools?username&lang` | `LovUserQueryDto` | `LovResponseDto` | `SCHOOL_NAME_LOV` |
| 38 | GET | `/school-fees/lov/terms?lang` | `LangQueryDto` | `LovResponseDto` | `SCHOOL_TERM_LOV` |
| 40 | GET | `/school-fees/lov/edu-stage?lang` | `LangQueryDto` | `LovResponseDto` | `EDU_STAGE_LOV` |
| 50 | GET | `/school-fees/lov/academic-year?lang` | `LangQueryDto` | `LovResponseDto` | `ACAD_YR_STRT_END_LOV` |
| 53 | GET | `/school-fees/lov/request-type?username&lang` | `LovUserQueryDto` | `LovResponseDto` | `REQUEST_TYPE_LOV` |
| 52 | GET | `/school-fees/children?enum&acadyrstrtdt&lang` | `SchoolChildrenQueryDto` | `ChildrenResponseDto` | `CHILD_DETS_VIEW` |
| 51 | — | _Not in scope_ | — | — | `CHILD_DETL` |

## Module: `appointments` (Cerner — ops 41, 42, 43, 44)
| Op | Method | Route | Req DTO | Resp DTO | Source |
|---|---|---|---|---|---|
| 41 | GET | `/appointments/upcoming?enum&lang` | `ProfileQueryDto` | `UpcomingApptsResponseDto` | Cerner |
| 42 | GET | `/appointments/masters?lang` | `LangQueryDto` | `ClinicMastersResponseDto` | `masterlookup=CernerClinics/CernerLocation/CernerMedicalServices` |
| 43 | GET* | `/appointments/booking-init?enum&lang` | `ProfileQueryDto` | `BookingInitResponseDto` | Cerner (aggregate) |
| 44 | POST* | `/appointments/book` | `BookAppointmentRequestDto` | `SubmitResultDto` | Cerner (validate+create) |

**Errors:** 502 on Cerner failure (ACL); no Oracle dependency.

## Module: `annual-ticket` (ops 66, 67, 72)
| Op | Method | Route | Req DTO | Resp DTO | Oracle |
|---|---|---|---|---|---|
| 66 | GET* | `/annual-ticket/master?lang&person_id` | `AnnualTicketMasterQueryDto` | `AnnualTicketMasterResponseDto` | `TICKET_MASTER, ANNUAL_TICKT_LOV` |
| 67 | POST* | `/annual-ticket/apply` | `SubmitTicketRequestDto` | `SubmitResultDto` | `TICKET_REQ_PR` |
| 72 | GET | `/annual-ticket/cancel-options?lang` | `TicketCancelOptionsQueryDto` | `TicketCancelOptionsResponseDto` | `CANCEL_TICKETS_V, CANCEL_TAKENAS_V, CANCEL_REPAYMENT_METHODS_V` |
| 72 | POST | `/annual-ticket/cancel` | `AnnualTicketCancelRequestDto` | `SubmitResultDto` | `CANCEL_TKT_PR` |

**master (op 66) is caller-scoped:** `XXHMC_SND_TICKET_MASTER` is read
`WHERE USER_NAME = :u` (JWT username; unfiltered it exceeded the request
timeout) and grouped by `TAG1` into one array per picker. How each group maps
to the `/annual-ticket/apply` body:

| Array | TAG1 | Item fields | → apply field |
|---|---|---|---|
| `requestFor` | `REQUEST FOR` | `value`/`label` = `NAME_EN`, `labelAr` = `NAME_AR` | `value` → `p_request_for` (`Self` / `Family` / `Self and Family`) |
| `passengers` | `PASSENGER` | `value` = `NAME_EN` (never localized), `contactId` = `CONTACT_ID`, `name`/`nameAr`, `type` (`Self`/`Family`), `contactType` (`EMP`/`S`/`C`), `currentEmployee`, `dateOfBirth` (`YYYY-MM-DD`), `sex`; `Self` first | `Self` `contactId` (= PERSON_ID) → `p_employee`; `Family` `value` (the English name — TICKET_REQ_PR stores passenger names, not ids) → `p_passenger1..4` |
| `contractualYears` | `CONTRACTUAL YEAR` | `value` = `CONTRACT_YEAR`, `label` = `CONTRACT_YEAR_DEF` (fallback `NAME_EN`), `labelAr` = `CONTRACT_YEAR_DEF_AR`, `fromYear`, `toYear`, `law`, `totalCount` | `value` → `p_contractual_year` |
| `destinations` | `DESTINATION` | `value`/`label` = `NAME_EN`, `labelAr` = `NAME_AR` | `value` → `p_traveling_dest` |
| `ticketClasses` | `TICKET CLASS` | `value`/`label` = `NAME_EN`, `labelAr` = `NAME_AR` | `value` → `p_travel_class` |
| `requestType` | — (constant) | `'Annual Ticket'` | → `p_request_type` (the only known value, AT-5 open) |
| `other` | anything else | `tag`, `recordType`, `value`, `label`, `labelAr` | nothing is dropped silently |

The `*Ar` twins (`labelAr`, `nameAr`, `eligibleAr`) are folded into their base
field per `lang` by the ResponseInterceptor (Arabic URL-decoded); `value` and
`contactId` are never localized, so they are always what Oracle expects. Rows
identical apart from `ROW_NUM` are de-duplicated. `eligible` is
`ANNUAL_TICKT_LOV.ANUAL_TKT_DEFAULT` (`Yes`/`No`; Arabic under `lang=ar`) — an
eligibility flag, not the form LOV; it is `null` (warning logged) when that read
fails, and never fails the call. `person_id` is optional; one that differs from
the caller's own PERSON_ID (the `Self` passenger, else `EMPLOYMENT_DETAILS_V`)
answers **403**.

```json
{
  "eligible": "Yes",
  "contractualYears": [{ "value": "01-SEP-2025 to 31-AUG-2026", "label": "01-SEP-2025 to 31-AUG-2026", "fromYear": 2025, "toYear": 2026, "law": "HMC LAW", "totalCount": 18 }],
  "destinations": [{ "value": "Cairo", "label": "Cairo" }],
  "passengers": [{ "value": "Mr. Amir Sami Samir Ibrahim", "contactId": "26023", "name": "Mr. Amir Sami Samir Ibrahim", "type": "Self", "contactType": "EMP", "currentEmployee": "Y", "dateOfBirth": "1984-05-15", "sex": "M" }],
  "requestFor": [{ "value": "Self", "label": "Self" }],
  "ticketClasses": [{ "value": "Economy", "label": "Economy" }],
  "requestType": "Annual Ticket",
  "other": []
}
```

**cancel-options (op 72) is caller-scoped and joined per ticket:** the three
views have no `USER_NAME` column, so the backend resolves the caller's
`PERSON_ID` from `EMPLOYMENT_DETAILS_V` by the JWT username. A `person_id` query
param is still accepted; one that differs from the caller's answers **403**; a
caller without an employment row gets empty lists. `ANALYSIS_CRITERIA_ID` is the
join key between the views (TAKENAS_V / REPAYMENT_METHODS_V carry one row per
historical ticket, so their flat lists were useless to a client):

```json
{
  "tickets": [{
    "analysisCriteriaId": "71794897",
    "value": "Self and Family |Amir |Caroline |Jerome Amir Sami |Jolie Amir Sami | |01-SEP-2025 to 31-AUG-2026 |Cash |20920",
    "requestFor": "Self and Family", "employeeName": "Amir",
    "passengers": ["Caroline", "Jerome Amir Sami", "Jolie Amir Sami"],
    "contractualYear": "01-SEP-2025 to 31-AUG-2026", "takenAs": "Cash", "amount": "20920",
    "repaymentMethods": [{ "value": "Payroll Deduction", "label": "Payroll Deduction", "appliesTo": "Cash" }]
  }],
  "takenAs": [{ "TAKES_AS": "Cash" }, { "TAKES_AS": "Voucher" }],
  "repaymentMethods": [{ "FLEX_VALUE": "Payroll Deduction", "DESCRIPTION": "Cash" }, { "FLEX_VALUE": "Cancel Voucher", "DESCRIPTION": "Voucher" }]
}
```

`value` is the composite `ANNUAL_LEAVE_PASS_TKT_VALUE`
(`requestFor |employeeName |passenger1..4 |contractYear |takenAs |amount`),
shown parsed; `takenAs` comes from TAKENAS_V for that id (fallback: segment 7).
The flat `takenAs` / `repaymentMethods` are deprecated, deduplicated legacy
fields.

**cancel (op 72) takes the ticket id, not the composite:**

```json
{ "analysis_criteria_id": "71794897", "p_reason": "Travel plans cancelled", "p_comments": "Cancelling the unused ticket." }
```

Required `analysis_criteria_id` (digits) and `p_reason`; optional `p_comments`,
`p_voucher_ref`, `p_repayment_method`, attachments. The backend re-reads the
caller's cancel options and fills `p_annual_tkt` (the ticket's
ANALYSIS_CRITERIA_ID — the procedure's segment1 is VARCHAR2(60) while the
composite reaches 109 chars; CANCEL_TKT_PR is being changed by the Oracle team
to resolve the ticket by id), `p_contractual_year` (segment 6), `p_ticket_as`
(the ticket's taken-as) and
`p_repayment_method` (the given one if it is one of the ticket's, else the
ticket's only one). **404** when the id is not one of the caller's tickets;
**400** when the ticket has several methods and none is given, or the given one
is not the ticket's. The old `p_annual_tkt` / `p_contractual_year` /
`p_ticket_as` keys are rejected (400 "should not exist"): the staging F5 WAF
blocked the response of every request carrying the pipe composite, and the
server-side lookup makes a wrong Cash/Voucher ↔ repayment pairing impossible.

## Module: `approvals` (ops 20, 21, 22, 23, 68, 69, 70, 71) — Roles: `APPROVER`/`SUPERVISOR`
| Op | Method | Route | Req DTO | Resp DTO | Oracle |
|---|---|---|---|---|---|
| 20 | GET* | `/approvals?enum&lang` | `ProfileQueryDto` | `ApprovalsSummaryResponseDto` | `APPROVE_SUMRY_V, PNDNG_QID_V` |
| 21 | GET* | `/approvals/:id/details?lang` | `ApprovalDetailQueryDto` | `ApprovalDetailResponseDto` | `NOTYFY_APPR_V, PNDNG_QID_V` |
| 22 | POST* | `/approvals/:id/decision` | `ApproveRejectRequestDto` | `SubmitResultDto` | `APPROVE_REJECT_PR` |
| 23 | GET | `/approvals/my-requests?enum&lang` | `ProfileQueryDto` | `MyRequestsResponseDto` | `MY_REQEST_SUMMARY_V, PNDNG_QID_V` |
| 68 | GET* | `/approvals/worklist?enum&lang` | `ProfileQueryDto` | `WorklistResponseDto` | `WORKLISTS_V` |
| 69 | GET* | `/approvals/worklist/summary?enum&lang` | `ProfileQueryDto` | `WorklistSummaryResponseDto` | `WORKLISTS_V` |
| 70 | GET* | `/approvals/worklist/:id/history?lang` | `ApprovalDetailQueryDto` | `ActionHistoryResponseDto` | `ACTION_HISTORY_V` |
| 71 | POST* | `/approvals/:id/reassign` | `ReassignApprovalRequestDto` | `SubmitResultDto` | `REASSIGN_PR` |

## Module: `otl` (OTL timecard — `XXHMC_SND_OTL_PKG`, not a legacy op)
Every route acts on the JWT caller (a `username` query value is accepted and ignored). Dates are `YYYY-MM-DD`; `period`/`startDate` is the TIME_PERIOD_V `START_DATE`. Objects exist on EBSDEV only (not yet on staging/EBSPRJ) — see AGENTS.md "OTL timecards".

| Method | Route | Req DTO | operationId | Oracle |
|---|---|---|---|---|
| GET | `/otl/timecard/periods?year&status&lang` | `OtlPeriodsQueryDto` | `otl_getPeriods` | `OTL_EMP_TIME_PERIOD_V` + `OTL_SUMMARY_V` (status derived) |
| GET | `/otl/timecard/summary?period&lang` | `OtlSummaryQueryDto` | `otl_getSummary` | `OTL_SUMMARY_V` (INVALID today → `available:false`) |
| GET | `/otl/timecard/summary/elements?period&lang` | `OtlPeriodQueryDto` | `otl_getSummaryByElement` | `OTL_SUMMARY_ELE_V` |
| GET | `/otl/timecard/details?period&lang` | `OtlPeriodQueryDto` | `otl_getDetails` | `OTL_TIMECARD_DEATIS_V` (template fallback) |
| GET | `/otl/template?startDate&endDate&lang` | `OtlDateRangeQueryDto` | `otl_getTemplate` | `OTL_PKG.get_template` + `get_absence_details` |
| GET | `/otl/absence-details?startDate&endDate&lang` | `OtlDateRangeQueryDto` | `otl_getAbsenceDetails` | `OTL_PKG.get_absence_details` |
| GET | `/otl/element-details?startDate&endDate&lang` | `OtlDateRangeQueryDto` | `otl_getElementDetails` | `OTL_PKG.get_element_name` (hour-type picker) |
| GET | `/otl/timecard/elements?lang` | `LangQueryDto` | `otl_getElements` | `OTL_ELEMENT_V` (display catalog only) |
| GET | `/otl/timecard/facilities?lang` | `LangQueryDto` | `otl_getFacilities` | `OTL_FACILITY_V` |
| GET | `/otl/timecard/cost-centers?facilityId&lang` | `OtlCostCenterQueryDto` | `otl_getCostCenters` | `OTL_COST_CENTER_V` |
| POST | `/otl/timecard/submit` (HTTP 200) | `SubmitTimecardRequestDto` | `otl_submitTimecard` | `OTL_PKG.XXHMC_SND_TIMECARD_SUBMIT_PR` (CLOB JSON) |
| GET | `/approvals/:id/timecard-details?requestor&lang` | `OtlTimecardNotificationQueryDto` | `approvals_getTimecardDetails` | `OTL_PKG.get_time_card_details` (caller must be the recipient; 403 otherwise) |

**Submit result:** action envelope with `result: { referenceNo, submittedDate, cardStatus, approvalChain }` — `referenceNo` is always `null` and `approvalChain` `[]` (Oracle bug B9). Oracle `E` → `successflag: N`. Invalid months (missing day, unknown element, > 24 h/day, label instead of code) answer `N` without calling Oracle.

## Module: `lookups` (shared — ops 15, 26 + generic)
| Op | Method | Route | Req DTO | Resp DTO | Oracle |
|---|---|---|---|---|---|
| 15 | GET | `/lookups/yes-no?lang` | `LangQueryDto` | `LovResponseDto` | `YES_NO_LOV` |
| 26 | GET* | `/lookups/rfmi-user?lang` | `LangQueryDto` | `LovResponseDto` | `RFMI_USER_LOV` |
| generic | GET | `/lookups/lov?lovname&lang[&username]` | `LovLookupQueryDto` | `LovResponseDto` | resolved via `LOV_OBJECT[lovname]` |
| generic | GET | `/lookups/master?lookupname&lang` | `MasterLookupQueryDto` | `LovResponseDto` | master registry (incl. Cerner*) |

## Traceability
Each row maps to a legacy operation in `Docs Project/Legacy APIs/README.md` and to Oracle objects in `Docs Project/Database/README.md`. DTO field-level detail and examples live in `Docs Project/Postman/`.
