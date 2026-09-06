# Letter request — mobile guide

`POST /letters/apply` with everything it needs, where each value comes from,
and the two things that make an otherwise correct request fail.

Every response below was captured from staging.

---

## Contents

1. [The whole flow](#the-whole-flow)
2. [Step 1 — load the lists](#step-1--load-the-lists)
3. [Step 2 — the language is not a choice](#step-2--the-language-is-not-a-choice)
4. [Step 3 — the remaining fields](#step-3--the-remaining-fields)
5. [Step 4 — submit](#step-4--submit)
6. [Every shape of request](#every-shape-of-request)
7. [Field reference](#field-reference)
8. [The 22 letters and their languages](#the-22-letters-and-their-languages)
9. [Errors, and what each one means](#errors-and-what-each-one-means)

---

## The whole flow

```
GET /letters/lov?enum=<employeeNumber>&lang=en
        │
        ├── name[]         → the letter AND its language (same row)
        ├── mobileNo[]     → p_mobile_number
        ├── deliveryLoc[]  → p_letter_delivery_loc
        ├── exitCopies[]   → p_no_of_copies
        └── country[]      → only for one letter
        │
POST /letters/apply?lang=en
        │
        └── { "successflag": "S", "message": "Success" }
```

One read, one write. Nothing else.

---

## Step 1 — load the lists

```http
GET /api/v1/letters/lov?enum=037400&lang=en
Authorization: Bearer <token>
```

```json
{
  "result": {
    "name": [
      { "code": "Service Certificate",      "meaning": "Service Certificate",      "used_value": "Service Certificate",      "description": "English" },
      { "code": "Basic Salary Certificate", "meaning": "Basic Salary Certificate", "used_value": "Basic Salary Certificate", "description": "Arabic" }
    ],
    "mobileNo":    [ { "used_value": "55112233" } ],
    "deliveryLoc": [ { "used_value": "Al Khor Hospital" }, { "used_value": "Al Wakra Hospital" }, { "used_value": "Main Office - Doha" } ],
    "exitCopies":  [ { "used_value": "1" }, { "used_value": "2" }, { "used_value": "3" }, { "used_value": "4" }, { "used_value": "5" } ],
    "defaultCopy": [ { "used_value": "1" } ],
    "language":    [ { "used_value": "Arabic" }, { "used_value": "English" } ],
    "country":     [ { "used_value": "Bahrain" }, { "used_value": "Egypt" }, { "used_value": "Jordan" } ]
  },
  "opstatus": 0,
  "status": "success",
  "httpStatusCode": 200
}
```

Counts on staging today: **22** letters, **9** delivery locations, **5** copy
options, **11** countries.

Always send `used_value` back, never `meaning`. On `lang=ar` the `meaning`
becomes the Arabic label for display, while `used_value` stays the value the
server expects.

---

## Step 2 — the language is not a choice

**This is the one rule that breaks most first attempts.**

Every letter exists in exactly ONE language, and the server looks it up by name
**and** language together:

```sql
flex_value_meaning = p_letter_name AND UPPER(description) = UPPER(p_letter_language)
```

Get the pair wrong and there is no such row, so the request is rejected.

Take both from the **same row**:

```dart
final letter = lovs.name[selectedIndex];

body['p_letter_name']     = letter.usedValue;    // "Service Certificate"
body['p_letter_language'] = letter.description;  // "English"
```

### Do not use `language[]` for this

`language[]` contains exactly two entries — `Arabic` and `English`. It is the
list of languages that exist in the system, **not** a choice for the current
letter. Pairing a name from `name[]` with a language from `language[]` is what
produces a valid-looking request that the server refuses.

### What the screen should look like

Do **not** show a language dropdown. Show the language as read-only text beside
the letter:

```
┌─────────────────────────────────────────────┐
│ Letter    [ Service Certificate         ▾ ] │
│ Language    English            (read-only)  │
└─────────────────────────────────────────────┘
```

Choosing "Basic Salary Certificate" changes that text to `Arabic` on its own.
Any letter marked Arabic is **issued in Arabic** — the user cannot request an
English copy of it, because none exists.

`?lang=` on the URL is unrelated: it controls the language of *labels and error
messages*, not the language the letter is printed in.

---

## Step 3 — the remaining fields

```dart
body['p_mobile_number']       = lovs.mobileNo[0].usedValue;
body['p_letter_delivery_loc'] = lovs.deliveryLoc[i].usedValue;
body['p_no_of_copies']        = lovs.exitCopies[i].usedValue;
body['p_purpose_comments']    = commentsController.text;
```

| Field | Rule |
|---|---|
| `p_mobile_number` | Must be a number already on the employee's HR record — take it from `mobileNo[]`. A typed number is rejected, and so is one carrying a country code (`+974…`). |
| `p_letter_delivery_loc` | From `deliveryLoc[]`. Nine values today, e.g. `Al Wakra Hospital`, `Main Office - Doha`. |
| `p_no_of_copies` | From `exitCopies[]` — `"1"` to `"5"`. `"0"` is rejected. `defaultCopy[]` gives the value to preselect. |
| `p_purpose_comments` | Free text from the user. **Required** — an empty string fails validation. |
| `p_country` | Only for **one** letter — see below. |

### `p_country` — exactly one letter needs it

**`Passing through Saudi Arabia` requires it.** Omitting it is a business
rejection, with the server saying so plainly:

```json
{ "successflag": "N", "message": "Validate Please enter the Country if the Letter selected is ..." }
```

**Every other letter must not send it.** The country lookup is guarded by the
letter name, so with any other letter it cannot match and the request is
rejected.

Note the letters that sound like they should need it and do not — `Hajj to
Saudi Arabia Letter` and `Umrah to Saudi Arabia Letter` both succeed without a
country. Only the passage letter asks for the destination, because that is the
country being travelled through.

So the rule is:

```dart
if (letter.usedValue == 'Passing through Saudi Arabia') {
  body['p_country'] = lovs.country[i].usedValue;   // show the field
}
// otherwise do not include the key at all
```

---

## Step 4 — submit

```http
POST /api/v1/letters/apply?lang=en
Authorization: Bearer <token>
Content-Type: application/json

{
  "p_letter_name": "Bank letter with details with effective date",
  "p_letter_language": "English",
  "p_no_of_copies": "1",
  "p_mobile_number": "55112233",
  "p_letter_delivery_loc": "Al Wakra Hospital",
  "p_purpose_comments": "test comments"
}
```

```json
{
  "result": { "successflag": "S", "message": "Success" },
  "opstatus": 0,
  "status": "success",
  "httpStatusCode": 200
}
```

**Always branch on `successflag`, not on the HTTP status** — this endpoint
returns 200 for a business rejection too.

| `successflag` | Meaning |
|---|---|
| `S` | Submitted for approval |
| `N` | Rejected — show `message`, which is already localized |

---

## Every shape of request

There are only three. All were run against staging and returned `S`.

### 1. An English letter — the ordinary case

```json
{
  "p_letter_name": "Bank letter with details with effective date",
  "p_letter_language": "English",
  "p_no_of_copies": "1",
  "p_mobile_number": "55112233",
  "p_letter_delivery_loc": "Al Wakra Hospital",
  "p_purpose_comments": "test"
}
```

### 2. An Arabic letter — identical, only the pair changes

```json
{
  "p_letter_name": "Basic Salary Certificate",
  "p_letter_language": "Arabic",
  "p_no_of_copies": "1",
  "p_mobile_number": "55112233",
  "p_letter_delivery_loc": "Al Wakra Hospital",
  "p_purpose_comments": "test"
}
```

Nothing about the request is "Arabic" except the value read from that letter's
own row. There is no separate endpoint and no different body shape.

### 3. `Passing through Saudi Arabia` — the only one with a country

```json
{
  "p_letter_name": "Passing through Saudi Arabia",
  "p_letter_language": "Arabic",
  "p_no_of_copies": "1",
  "p_mobile_number": "55112233",
  "p_letter_delivery_loc": "Al Wakra Hospital",
  "p_purpose_comments": "test",
  "p_country": "Egypt"
}
```

Without `p_country` this one returns:

```json
{ "successflag": "N", "message": "Validate Please enter the Country if the Letter selected is ..." }
```

The Hajj and Umrah letters take the shape in example 2, not this one.

---

## Field reference

| Body field | Source | Required |
|---|---|---|
| `p_letter_name` | `name[i].used_value` | yes |
| `p_letter_language` | `name[i].description` — **same row** | yes |
| `p_no_of_copies` | `exitCopies[i].used_value` | yes |
| `p_mobile_number` | `mobileNo[i].used_value` | yes |
| `p_letter_delivery_loc` | `deliveryLoc[i].used_value` | yes |
| `p_purpose_comments` | user input | yes |
| `p_country` | `country[i].used_value` | only for the Saudi passage letter |

---

## The 22 letters and their languages

Read this from `name[].description` at runtime — it is data and can change.
The current state, for reference:

| Letter | Issued in | Needs `p_country` |
|---|---|---|
| Bank letter with details with effective date | English | |
| Bank letter with details without effective date | English | |
| Bank letter with housing allowance details | English | |
| Basic Salary Certificate | **Arabic** | |
| Completion of Probation Period Certificate | **Arabic** | |
| Completion of Probation Period without salary | **Arabic** | |
| Hajj to Saudi Arabia Letter | **Arabic** | no |
| No Objection of Marriage Certificate (non Qatari) | English | |
| **Passing through Saudi Arabia** | **Arabic** | **yes** |
| Salary Certificate with salary details | English | |
| Salary Certificate with salary details (Arabic) | **Arabic** | |
| Service Certificate | English | |
| Service Certificate with basic salary only | English | |
| Service Certificate with official language of HMC | English | |
| Service Certificate with school assistance | English | |
| Service Certificate with total salary | English | |
| Service Certificate with total salary with accommodation and tickets | English | |
| Service Certificate: employee has no loans | English | |
| Service certificate without salary (Arabic) | **Arabic** | |
| Services/Salary Certificate including deductions | English | |
| Total Salary Certificate | **Arabic** | |
| Umrah to Saudi Arabia Letter | **Arabic** | no |

Note the pairs that look alike: *Salary Certificate with salary details* is
English, and *Salary Certificate with salary details (Arabic)* is a separate,
Arabic letter. The user picks the language by picking the letter.

---

## Errors, and what each one means

### 422 — a value was not recognised

```json
{
  "success": false,
  "message": "One of the values sent was not recognised. Please re-check the values chosen from the lookup lists.",
  "status": "error",
  "httpStatusCode": 422
}
```

Almost always one of:

1. the name/language pair does not exist together;
2. a mobile number that is not on the employee's record;
3. a delivery location that is not in the list;
4. `p_country` sent with a letter other than the Saudi passage one.

This used to be a **404**, which read like a broken endpoint. It is not — it is
a rejected value.

### 400 — a field is missing or malformed

```json
{
  "success": false,
  "message": "Validation failed.",
  "status": "error",
  "httpStatusCode": 400,
  "errors": { "details": ["p_purpose_comments should not be empty"] }
}
```

`errors.details` names the field. Please surface it during development rather
than a generic message — it identifies the problem immediately.

### An HTML page instead of JSON

```html
<html><head><title>Request Rejected</title></head>
<body>The requested URL was rejected. Please consult with your administrator.
<br><br>Your support ID is: 15468526370066589295</body></html>
```

**This is the WAF in front of the API, not the API.** The request never
arrived.

The usual cause is content in the body that looks like markup or an injection
attempt. A confirmed example: leaving a placeholder such as

```json
"p_mobile_number": "<selected LOV used_value>"
```

in the request. The angle brackets trip the filter. Replacing it with a real
value from `mobileNo[]` makes the same request succeed.

Detect it by checking whether the response body starts with `<html` — no valid
API response ever does — and treat it as "request blocked", not as a server
error. Rapid repeated POSTs can also trigger it briefly; retrying after a few
seconds succeeds.

---

## Checklist

- [ ] `p_letter_name` and `p_letter_language` come from the **same** `name[]` row
- [ ] No language dropdown; the language is displayed read-only
- [ ] `p_mobile_number` from `mobileNo[]`, never typed
- [ ] `p_letter_delivery_loc` from `deliveryLoc[]`
- [ ] `p_no_of_copies` between 1 and 5
- [ ] `p_purpose_comments` not empty
- [ ] `p_country` sent **only** for `Passing through Saudi Arabia`, and always for it
- [ ] No placeholder text left in the body
- [ ] Branch on `successflag`, not the HTTP status
