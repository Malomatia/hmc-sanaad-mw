/**
 * Swagger/Postman examples for the OTL timecard. Shapes follow OtlService;
 * values are modelled on the EBSDEV objects (2026-09-29) — the endpoints have
 * not run against a database with OTL deployed yet (EBSPRJ has none), so these
 * are illustrative, not captures. Source columns are noted per field.
 */

const JULY_2026 = Array.from({ length: 31 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`);
const isWeekend = (iso: string) => [5, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay());

/** POST /otl/timecard/submit — a complete July 2026 (every day has an entry) plus one cross-charged OT entry. */
export const OTL_SUBMIT_BODY = {
  periodStart: '2026-07-01',
  p_confirmation_flag: 'Y',
  p_employee_notes: 'July 2026 timecard',
  p_entries: [
    ...JULY_2026.map((date) => ({
      p_hour_type_id: 'Regular Hours',
      p_entry_date: date,
      p_value: isWeekend(date) ? 0 : 8,
      p_cross_dept_flag: 'N',
    })),
    {
      p_hour_type_id: 'Regular OT',
      p_entry_date: '2026-07-09',
      p_value: 2,
      p_cross_dept_flag: 'Y',
      p_dept_id: '09',
      p_cost_center: '4471',
      p_comments: 'Corporate event support',
    },
  ],
};

/** Submit result (action envelope). p_reference_no / p_approval_chain are never set by Oracle (B9). */
export const OTL_SUBMIT_EXAMPLE = {
  status: 'success',
  successflag: 'S',
  message: 'Success',
  httpStatusCode: 200,
  result: {
    referenceNo: null,
    submittedDate: '2026-08-02T06:15:00.000Z',
    cardStatus: 'Submitted',
    approvalChain: [],
  },
};

/** GET /otl/timecard/periods — EMP_TIME_PERIOD_V joined with SUMMARY_V on the month. */
export const OTL_PERIODS_EXAMPLE = {
  summaryAvailable: true,
  items: [
    {
      timePeriodId: 176543,
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      label: 'August 01, 2026 - August 31, 2026',
      status: 'OPEN',
      recordedHours: null,
      absenceDays: null,
      timecardId: null,
    },
    {
      timePeriodId: 176542,
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      label: 'July 01, 2026 - July 31, 2026',
      status: 'SUBMITTED',
      recordedHours: 186,
      absenceDays: 0,
      timecardId: 9812345,
    },
  ],
};

/** GET /otl/timecard/summary?period=2026-07-01 — SUMMARY_V (available=false while the view is INVALID, B4). */
export const OTL_SUMMARY_EXAMPLE = {
  available: true,
  items: [
    {
      period: 'Jul 2026',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      recordedHours: 186,
      absenceDays: 0,
      status: 'SUBMITTED',
      timecardId: 9812345,
      comment: 'July 2026 timecard',
    },
  ],
};

/** GET /otl/timecard/summary/elements?period=2026-07-01 — SUMMARY_ELE_V summed per ELEMENT_NAME. */
export const OTL_SUMMARY_ELEMENTS_EXAMPLE = {
  period: { startDate: '2026-07-01', label: 'Jul 2026' },
  status: 'SUBMITTED',
  recordedHours: 186,
  totalHours: 186,
  overtimeHours: 2,
  byElement: [
    { elementName: 'Regular Hours', hours: 184 },
    { elementName: 'Regular OT', hours: 2 },
  ],
  rows: [
    { elementName: 'Regular Hours', facility: '09', costCenter: '4410', hours: 184 },
    { elementName: 'Regular OT', facility: '09', costCenter: '4471', hours: 2 },
  ],
};

/** GET /otl/timecard/details?period=2026-07-01 — TIMECARD_DEATIS_V grouped into grid rows (abridged). */
export const OTL_DETAILS_EXAMPLE = {
  source: 'timecard',
  period: { startDate: '2026-07-01', endDate: '2026-07-31', label: 'Jul 2026' },
  header: {
    timecardId: 9812345,
    status: 'SUBMITTED',
    submittedBy: 'Amir Sami Ibrahim (037400)',
    submissionDate: '2026-08-02',
    approvedBy: 'Usama Mahmoud Abdelsamad (037915)',
    approvalDate: '2026-08-02',
  },
  rows: [
    {
      hourType: 'Regular Hours',
      facility: '09',
      costCenter: '4410',
      totalHours: 16,
      entries: [
        { entryDate: '2026-07-01', value: 8, locked: false },
        { entryDate: '2026-07-02', value: 8, locked: false },
        { entryDate: '2026-07-03', value: 0, locked: true },
      ],
    },
  ],
};

/** GET /approvals/:id/timecard-details?requestor= — get_time_card_details, same grid shape. */
export const OTL_TIMECARD_NOTIFICATION_EXAMPLE = {
  header: {
    fullName: 'Mr. Amir Sami Samir Ibrahim',
    employeeNumber: '037400',
    period: 'Jul 2026',
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    timecardId: 9812345,
    status: 'SUBMITTED',
    submittedBy: 'Amir Sami Ibrahim (037400)',
    submissionDate: '2026-08-02',
    comments: 'July 2026 timecard',
  },
  rows: OTL_DETAILS_EXAMPLE.rows,
};

/** GET /otl/template?startDate=2026-07-01&endDate=2026-07-31 — get_template + absence overlay (abridged). */
export const OTL_TEMPLATE_EXAMPLE = {
  startDate: '2026-07-01',
  endDate: '2026-07-31',
  days: [
    { date: '2026-07-01', elementName: 'Regular Hours', hours: 8, locked: false, absent: false },
    { date: '2026-07-02', elementName: 'Regular Hours', hours: 8, locked: false, absent: true },
    { date: '2026-07-03', elementName: 'Regular Hours', hours: 0, locked: true, absent: false },
  ],
};

/** GET /otl/absence-details — get_absence_details (no absence type is returned). */
export const OTL_ABSENCE_EXAMPLE = {
  items: [
    { employeeNumber: '037400', dateStart: '2026-07-02', dateEnd: '2026-07-02', absenceDays: 1 },
  ],
};

/** GET /otl/element-details — get_element_name (facility 09: four elements, otherwise two). */
export const OTL_ELEMENT_DETAILS_EXAMPLE = {
  items: [
    { elementTypeId: 154, elementName: 'Regular Hours' },
    { elementTypeId: 152, elementName: 'Ramadan Regular OT' },
    { elementTypeId: 155, elementName: 'Regular OT' },
    { elementTypeId: 163, elementName: 'Absent Hours Deduction' },
  ],
};

/** GET /otl/timecard/elements — ELEMENT_V catalog (display only, not the picker). */
export const OTL_ELEMENTS_EXAMPLE = OTL_ELEMENT_DETAILS_EXAMPLE;

/** GET /otl/timecard/facilities — FACILITY_V. Submit sends facilityCode, never the label. */
export const OTL_FACILITIES_EXAMPLE = {
  items: [
    {
      facilityCode: '09',
      facilityName: '09-Hamad General Hospital',
      description: 'Hamad General Hospital',
    },
  ],
};

/** GET /otl/timecard/cost-centers?facilityId=09 — COST_CENTER_V. Submit sends costCenterCode. */
export const OTL_COST_CENTERS_EXAMPLE = {
  items: [
    {
      facilityCode: '09',
      costCenterCode: '4471',
      costCenterName: '4471-Corporate Events',
      description: 'Corporate Events',
    },
  ],
};
