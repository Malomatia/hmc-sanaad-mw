/**
 * Real successful `result`/action-envelope payloads captured from
 * api_test_work.json, used as Swagger examples. Read-endpoint constants are the
 * inner `result` value (the ResponseInterceptor wraps them in the Sanaad
 * success envelope); action-endpoint constants are the full envelope.
 */

/** op 18 — GET /identity/qid?enum=&lang= (enum is actually a username here). */
export const IDENTITY_QID_EXAMPLE = {
  USER_NAME: 'AIBRAHIM39',
  QID_NUMBER: '28481809470',
};

/** op 53b — GET /identity/lov/work-location?lang= */
export const IDENTITY_WORK_LOCATION_LOV_EXAMPLE = {
  items: [
    { code: 'WWRC, ACC, QRI', meaning: 'WWRC, ACC, QRI' },
    { code: 'Others', meaning: 'Others' },
  ],
};

/** op 59 — GET /identity/lov/delivery-location?lang= */
export const IDENTITY_DELIVERY_LOCATION_LOV_EXAMPLE = {
  items: [
    { code: 'Al Khor Hospital', meaning: 'Al Khor Hospital' },
    { code: 'Al Wakra Hospital', meaning: 'Al Wakra Hospital' },
    { code: 'Cuban Hospital', meaning: 'Cuban Hospital' },
    { code: 'Main Customer Service - Doha', meaning: 'Main Customer Service - Doha' },
  ],
};

/** op 60 — GET /identity/lov/reason?lang= */
export const IDENTITY_REASON_LOV_EXAMPLE = {
  items: [
    { code: 'Damaged', meaning: 'Damaged' },
    { code: 'Lost', meaning: 'Lost' },
    { code: 'Change Department/Location', meaning: 'Change Department/Location' },
    { code: 'Name Change', meaning: 'Name Change' },
    { code: 'Position Change', meaning: 'Position Change' },
  ],
};

/** op 54 — POST /identity/idcard/apply response (action envelope). */
export const IDENTITY_IDCARD_APPLY_EXAMPLE = {
  status: 'success',
  successflag: 'S',
  message: 'Success',
  httpStatusCode: 200,
};

/** op 19 — POST /identity/qid/update response (action envelope). */
export const IDENTITY_QID_UPDATE_EXAMPLE = {
  status: 'success',
  successflag: 'S',
  message: 'Success',
  httpStatusCode: 200,
};
