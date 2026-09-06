# Letter request & Return from leave — mobile guide

For the Flutter app. Two endpoints that were failing until the 2026-09-01
release, and exactly how to call them now.

Both had the same underlying problem: a value they require had no reachable
source, so the only payload that worked was one copied from someone else. That
is fixed — everything you need now comes from the LOV endpoints.

---

## 1. Letter request — `POST /letters/apply`

### Step 1 — load the lists (one call)

```
GET /letters/lov?enum={employeeNumber}&lang=en
```

```json
{
  "name": [
    { "used_value": "Service Certificate",      "description": "English" },
    { "used_value": "Basic Salary Certificate", "description": "Arabic"  }
  ],
  "mobileNo":    [ { "used_value": "55112233" } ],
  "deliveryLoc": [ { "used_value": "Al Wakra Hospital" } ],
  "exitCopies":  [ { "used_value": "1" }, { "used_value": "2" } ],
  "language":    [ { "used_value": "English" }, { "used_value": "Arabic" } ],
  "country":     [ { "used_value": "Egypt" } ]
}
```

### Step 2 — take the name AND the language from the same row

Every letter exists in exactly **one** language, and the server looks the
letter up by name *and* language together. The language is not a user choice.

```dart
final letter = lovs.name[selectedIndex];

body['p_letter_name']     = letter.usedValue;    // "Service Certificate"
body['p_letter_language'] = letter.description;  // "English"
```

Show `letter.description` as read-only text next to the letter name.

> **Do not build the language from `language[]`.** That array is only the list
> of the two languages that exist in the system; it does not say which one a
> given letter uses. Pairing a name from `name[]` with a language from
> `language[]` is what made requests fail.

### Step 3 — fill the rest from their own lists

```dart
body['p_mobile_number']       = lovs.mobileNo[0].usedValue;
body['p_letter_delivery_loc'] = lovs.deliveryLoc[i].usedValue;
body['p_no_of_copies']        = lovs.exitCopies[i].usedValue;  // "1".."5"
body['p_purpose_comments']    = commentsController.text;        // required
```

| Field | Rule |
|---|---|
| `p_mobile_number` | Must already be on the employee's HR record. A typed number is rejected, and so is one with a country code (`+974…`). |
| `p_no_of_copies` | 1–5. `"0"` is rejected. |
| `p_purpose_comments` | Required — an empty string fails validation. |
| `p_country` | **Omit it.** Only "Passing through Saudi Arabia" accepts it; with any other letter it always fails. |

### Step 4 — send

```json
POST /letters/apply?lang=en

{
  "p_letter_name": "Service Certificate",
  "p_letter_language": "English",
  "p_no_of_copies": "1",
  "p_mobile_number": "55112233",
  "p_letter_delivery_loc": "Al Wakra Hospital",
  "p_purpose_comments": "test"
}
```

```json
{ "successflag": "S", "message": "Success" }
```

---

## 2. Return from leave — `POST /leave/return`

### Step 1 — load the leaves the user can return from

```
GET /leave/lov/return?username={username}&lang=en
```

```json
{
  "items": [
    {
      "meaning":    "Casual Leave|Leave Start Date : 19-APR-2026 and Leave End Date : 19-APR-2026",
      "used_value": "Casual Leave|Leave Start Date : 19-APR-2026 and Leave End Date : 19-APR-2026",
      "id":         "56949953"
    }
  ]
}
```

### Step 2 — display `meaning`, send `id`

```dart
final leave = items[selectedIndex];

Text(leave.meaning);                   // what the user reads
body['p_leave_details'] = leave.id;    // "56949953" — what you send
```

> **This is the one exception to "send `used_value`".** Everywhere else in the
> API you send `used_value`. Here the server needs the leave's record id, and
> the text form is rejected.
>
> `id` is a new field added in this release.

### Step 3 — add the return date

```dart
body['p_return_date'] = '20-Apr-2026';   // dd-MMM-yyyy or yyyy-MM-dd
body['p_comments']    = commentsController.text;  // optional
```

### Step 4 — send

```json
POST /leave/return?lang=en

{
  "p_leave_details": "56949953",
  "p_return_date": "20-Apr-2026",
  "p_comments": "Returned early."
}
```

```json
{ "successflag": "S", "message": "Success" }
```

---

## Reading the response

Both endpoints return **HTTP 200 even when the operation fails.** Always branch
on `successflag`, never on the status code alone.

```dart
if (response.successflag == 'S') {
  showSuccess('Submitted for approval');
} else {
  showError(response.message);   // already safe to display, in the request's language
}
```

| Status | Meaning | What to do |
|---|---|---|
| 200 + `successflag: S` | Submitted for approval | Success |
| 200 + `successflag: N` | Business rejection | Show `message` |
| 400 | A field is missing or malformed | `errors.details` names the field |
| 409 | *"A Request is pending for approval"* | Normal — the user has an open request of this kind. Do not retry; tell them to wait for the approver. |
| 422 | A value you sent was not recognised | Re-check each value against its LOV. Usually a name/language pair, or a mobile/location not on record. |

`message` is already localized — send `?lang=ar` and it comes back in Arabic.
Display it as-is; never build your own text from the status code.

---

## What changed in this release

Two additive fields. Nothing existing moved, so you can adopt them when ready.

| Field | Where | Why |
|---|---|---|
| `description` | `/letters/lov` → `name[]` | The language that letter exists in. Previously dropped, so the pairing had to be guessed. |
| `id` | `/leave/lov/return` → `items[]` | The leave's record id. Previously unreachable, which made `/leave/return` impossible to call. |

Also fixed:

- `/letters/lov` → `mobileNo` was always empty. It is keyed by username while
  the endpoint is documented with `?enum=`; the server now matches on both, so
  you keep calling it exactly as before and the list is populated.
- A rejected value used to answer **404 "The requested resource was not found"**,
  which read like a broken endpoint. It is **422** now, with a message telling
  you to re-check the values.

`code`, `meaning` and `used_value` are unchanged on every LOV.

---

## Quick reference

| | Rule |
|---|---|
| Letters | Name and language come from the **same row** of `name[]` |
| Letters | Mobile and delivery location come from their lists, never typed |
| Letters | Never send `p_country` (except the Saudi passage letter) |
| Leave return | Send `id`, display `meaning` |
| Both | Branch on `successflag`, not the HTTP status |
| Everywhere else | Send `used_value` |
