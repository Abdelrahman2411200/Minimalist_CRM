# CRM data contract

Phase 2 defines the persistence model and wire formats for the resource endpoints added in Phase 3. `/health` and `/ready` are implemented now.

## Identifiers and relationships

Contact, Lead, Opportunity, and User identifiers are PostgreSQL-generated UUID strings. A contact has zero or one lead, enforced by the unique `Lead.contactId` and its foreign key. A lead has zero or more opportunities, enforced by `Opportunity.leadId`. Foreign keys restrict deletion of referenced parents.

Required contact fields are `firstName`, `lastName`, `email`, `company`, and `leadSource`. PostgreSQL enforces non-null, nonblank values. `phone` and `notes` are nullable text fields. Email syntax validation will be implemented at the HTTP boundary in Phase 3.

`leadScore` is a JSON integer from 1 through 10, entered manually. The PostgreSQL integer column and a versioned CHECK constraint enforce its type and range. A new lead defaults to `Prospecting`.

Stage values in API payloads are `Prospecting`, `Qualification`, `Proposal`, `Negotiation`, `Closed Won`, and `Closed Lost`. They describe the whole lead. PostgreSQL stores those exact labels in an enum. Prisma uses `ClosedWon` and `ClosedLost` for the two labels containing spaces, so the Phase 3 HTTP layer must map those two names to and from the API labels.

## Money

`Opportunity.estimatedValue` is stored as PostgreSQL `numeric(14,2)`, with twelve integral digits and two fractional digits. Accepted values range from `0.00` through `999999999999.99`, inclusive. A CHECK constraint rejects negative values and PostgreSQL's special `NaN` numeric value. The display currency is EGP.

The API accepts a decimal string with one to twelve integral digits and optionally one or two fractional digits. Zero is allowed. Leading zeros, signs, separators, whitespace, exponent notation, and JSON numbers are rejected. The request format is `^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$`.

API responses always use a decimal string with exactly two fractional digits. For example, input `"30000.2"` becomes `"30000.20"`, and input `"0"` becomes `"0.00"`. Use Prisma Decimal values throughout persistence and serialize with `.toFixed(2)`. Keep the wire value as a string throughout edits and form submission.

PostgreSQL rounds excess fractional digits when assigning to `numeric(14,2)`. The Phase 3 API must reject excess fractional digits before persistence so client values round-trip according to this contract.

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

`User` has a generated UUID, a unique username, a password hash, and creation/update timestamps. Local CRM fixtures create contacts, leads, and opportunities. Staff provisioning and password hashing are implemented in Phase 3.

The initial migration includes the PostgreSQL `session` table for `express-session` with `connect-pg-simple`. It has `sid varchar` as the primary key, `sess json`, `expire timestamp(6)`, and an expiry index named `IDX_session_expire`. This matches the session store's published schema. Phase 3 should use this existing table with `createTableIfMissing: false`, configure expiry pruning, and put the authenticated user's UUID in the server-side session JSON. [Session table reference](https://github.com/voxpelli/node-connect-pg-simple/blob/HEAD/table.sql)

All staff will share the CRM records. Phase 3 will add authenticated resource access, session regeneration on login, session destruction on logout, and secure cookie settings.
