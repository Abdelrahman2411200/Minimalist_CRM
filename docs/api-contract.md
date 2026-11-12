# CRM data contract

Phase 3 implements staff authentication and the contacts, leads, and opportunities API. The request walkthrough and endpoint reference are in [API requests](api-requests.md).

## Identifiers and relationships

Contact, Lead, Opportunity, and User identifiers are PostgreSQL-generated UUID strings. A contact has zero or one lead, enforced by the unique `Lead.contactId` and its foreign key. A lead has zero or more opportunities, enforced by `Opportunity.leadId`. Foreign keys restrict deletion of referenced parents.

Required contact fields are `firstName`, `lastName`, `email`, `company`, and `leadSource`. PostgreSQL enforces non-null, nonblank values. `phone` and `notes` are nullable text fields. The API validates email syntax and trims required text. Names, company, and source have a 200-character limit, email has a 254-character limit, and phone has a 50-character limit. Notes preserve free text within the 100 KB request-body limit.

`leadScore` is a JSON integer from 1 through 10, entered manually. The PostgreSQL integer column and a versioned CHECK constraint enforce its type and range. A new lead defaults to `Prospecting`.

Stage values in API payloads are `Prospecting`, `Qualification`, `Proposal`, `Negotiation`, `Closed Won`, and `Closed Lost`. They describe the whole lead. PostgreSQL stores those exact labels in an enum. Prisma uses `ClosedWon` and `ClosedLost` internally, and the HTTP layer maps them to and from the labels containing spaces.

## Money

`Opportunity.estimatedValue` is stored as PostgreSQL `numeric(14,2)`, with twelve integral digits and two fractional digits. Accepted values range from `0.00` through `999999999999.99`, inclusive. A CHECK constraint rejects negative values and PostgreSQL's special `NaN` numeric value. The display currency is EGP.

The API accepts a decimal string with one to twelve integral digits and optionally one or two fractional digits. Zero is allowed. Leading zeros, signs, separators, whitespace, exponent notation, and JSON numbers are rejected. The request format is `^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$`.

API responses always use a decimal string with exactly two fractional digits. For example, input `"30000.2"` becomes `"30000.20"`, and input `"0"` becomes `"0.00"`. Use Prisma Decimal values throughout persistence and serialize with `.toFixed(2)`. Keep the wire value as a string throughout edits and form submission.

PostgreSQL rounds excess fractional digits when assigning to `numeric(14,2)`. The API rejects excess fractional digits before persistence so client values round-trip according to this contract.

## Expected close date

`Opportunity.closeDate` is stored as PostgreSQL `date`. Both API requests and responses use a real calendar date in `YYYY-MM-DD` format, with years from `0001` through `9999`. Leap-day validity must be checked. Timestamps, time offsets, and locale-dependent date formats are rejected at the HTTP boundary.

At the Prisma boundary, construct the date using UTC midnight, such as `new Date('2028-02-29T00:00:00.000Z')`, and serialize with `.toISOString().slice(0, 10)`. Avoid local-time getters and locale formatting when producing API values. The database verification suite exercises the leap-day round trip with a non-UTC PostgreSQL session timezone.

An opportunity payload will contain fields such as the following.

```json
{
  "leadId": "20000000-0000-4000-8000-000000000001",
  "opportunityName": "Synthetic website project",
  "estimatedValue": "30000.25",
  "closeDate": "2027-01-15"
}
```

## Health and readiness

`GET /health` returns HTTP 200 with `{"status":"ok"}` while the API process is responding.

`GET /ready` executes `SELECT 1` through the application's Prisma connection. It returns HTTP 200 with `{"status":"ready"}` when the query succeeds, or HTTP 503 with `{"status":"unavailable"}` when it fails. Responses include `Cache-Control: no-store`. Connection, query, and statement timeouts are each configured to two seconds. Responses expose only the status. Readiness currently verifies database connectivity.

## Staff accounts and session storage

`User` has a generated UUID, a unique username, a password hash, and creation/update timestamps. Local CRM fixtures create contacts, leads, and opportunities. Staff accounts are provisioned explicitly through `npm run staff:create --workspace backend -- --username <username>`. Usernames use 3–64 letters, digits, dots, underscores, or hyphens, starting with a letter or digit. Provisioning and sign-in normalize usernames to lowercase. New passwords have 12–128 characters and are read through a hidden prompt or stdin.

The initial migration includes the PostgreSQL `session` table used by `express-session` with `connect-pg-simple`. It has `sid varchar` as the primary key, `sess json`, `expire timestamp(6)`, and an expiry index named `IDX_session_expire`. The store uses `createTableIfMissing: false`, prunes expired sessions at a randomized 15-minute interval, and stores the authenticated user's UUID in session JSON. [Session table reference](https://github.com/voxpelli/node-connect-pg-simple/blob/HEAD/table.sql)

Passwords use Node.js scrypt with a random 16-byte salt, a 64-byte derived key, and parameters `N=65536`, `r=8`, `p=2`. Comparison uses `timingSafeEqual`. Unknown users incur the same scrypt work and receive the same 401 response as an incorrect password. [Password storage reference](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

All staff share the CRM records. Resource routes and `/api/auth/me` verify the session and that the staff account still exists. Login regenerates the session identifier and saves it before responding. Logout destroys the stored session and clears the cookie. Sessions have an eight-hour sliding expiry.

The `crm.sid` cookie has `HttpOnly`, `SameSite=Lax`, and `Path=/`. Production enables `Secure` and requires an HTTPS `APP_ORIGIN`. Every unsafe `/api` request, including login and logout, must provide an `Origin` exactly matching `APP_ORIGIN`. Origin checks use configured values. They are independent of the request's Host header. API responses use `Cache-Control: no-store`.

Login allows ten failed requests per IP in a 15-minute window and returns HTTP 429 with `Retry-After` after the limit is reached. Successful logins do not consume that allowance. The rate counter is in process memory and resets on restart. A deployment with multiple application instances needs a shared rate-limit store. Sessions themselves are stored in PostgreSQL and survive application restart when the session secret is retained.

`TRUST_PROXY_HOPS` defaults to zero. Use one only when the application is reachable exclusively through one trusted reverse proxy that supplies the client IP and HTTPS forwarding headers. Credentials, cookies, session identifiers, request bodies, and raw exception objects are excluded from application error logs.
