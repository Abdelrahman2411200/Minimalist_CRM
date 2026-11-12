# REST API requests

Start PostgreSQL, apply migrations, configure the local session secret, provision a staff account, and start the API using the README instructions. The examples below use PowerShell from the repository root and fictional customer data.

## Endpoints and responses

| Route | Method | Result |
| --- | --- | --- |
| `/api/auth/login` | POST | 200 with `{ "data": { "id": "<uuid>", "username": "<username>" } }` and a session cookie |
| `/api/auth/logout` | POST | 204, stored session destroyed and cookie cleared |
| `/api/auth/me` | GET | 200 with the current public user fields, or 401 |
| `/api/contacts` | GET, POST | List matching contacts or create a contact |
| `/api/contacts/:id` | GET, PATCH | Contact detail with its lead and opportunities, or update contact fields |
| `/api/leads` | GET, POST | List leads with their contact and opportunities, or create a lead |
| `/api/leads/:id` | GET, PATCH | Read or update a lead |
| `/api/opportunities` | GET, POST | List opportunities or create an opportunity |
| `/api/opportunities/:id` | GET, PATCH | Read or update an opportunity |

Resource reads and writes require a valid staff session. All staff share records. POST resource requests return 201 and a `Location` header. Resource results use `{ "data": <object> }` and collections use `{ "data": [<objects>] }`. PATCH returns the updated object with HTTP 200. Collections return all matching records.

Contact lists include a lead summary or `null`. Contact detail includes `lead.opportunities` when a lead exists. Lead lists/details include `contact` and `opportunities`. Money is always a decimal string in responses and close dates use `YYYY-MM-DD`. Creation/update timestamps use ISO timestamps. See the [data contract](api-contract.md).

## Sign in

Set the API address and the exact browser origin configured by `APP_ORIGIN`. Development Vite runs at the origin below and proxies relative `/api` URLs. For a hosted CRM use `https://<crm-domain>` for both values.

```powershell
$baseUrl = 'http://127.0.0.1:3000'
$headers = @{ Origin = 'http://127.0.0.1:5173' }
```

`Get-Credential` reads the staff credentials interactively. `Invoke-RestMethod` signs in and keeps the cookie in the in-memory `$crmSession` variable. The password is obtained at runtime so its literal value stays out of command history.

```powershell
$credentials = Get-Credential -Message 'CRM staff sign-in'
$loginBody = @{
  username = $credentials.UserName
  password = $credentials.GetNetworkCredential().Password
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$baseUrl/api/auth/login" `
  -Headers $headers -ContentType 'application/json' -Body $loginBody `
  -SessionVariable crmSession
Remove-Variable loginBody, credentials
```

This GET request reads the current staff account using the saved session.

```powershell
Invoke-RestMethod -Uri "$baseUrl/api/auth/me" -WebSession $crmSession
```

Every POST and PATCH requires the configured `Origin`, including command-line requests. A missing or mismatched origin returns 403. Browser requests provide that header automatically. The API uses same-origin access and does not enable cross-origin credential sharing.

## Create and edit a contact

This request creates a fictional contact and stores its returned identifier in `$contact.data.id`.

```powershell
$contactBody = @{
  firstName = 'Sara'
  lastName = 'Example'
  email = 'sara@example.test'
  company = 'Synthetic Demo Company'
  leadSource = 'Website Form'
  notes = 'Synthetic sample inquiry'
} | ConvertTo-Json
$contact = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/contacts" `
  -Headers $headers -WebSession $crmSession -ContentType 'application/json' -Body $contactBody
```

This PATCH updates the company and clears notes while preserving omitted fields.

```powershell
$contactPatch = @{ company = 'Synthetic Updated Company'; notes = $null } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "$baseUrl/api/contacts/$($contact.data.id)" `
  -Headers $headers -WebSession $crmSession -ContentType 'application/json' -Body $contactPatch
```

Creation requires first name, last name, email, company, and lead source. Phone and notes are optional. PATCH accepts the same fields individually, requires at least one field, and rejects unknown fields. Use `null` to clear phone or notes. An empty phone string is normalized to `null`.

## Qualify a lead

This request links a manually scored lead to the contact. The initial stage defaults to Prospecting.

```powershell
$leadBody = @{ contactId = $contact.data.id; leadScore = 7 } | ConvertTo-Json
$lead = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/leads" `
  -Headers $headers -WebSession $crmSession -ContentType 'application/json' -Body $leadBody
```

This PATCH changes the stage to Qualification and preserves the score and contact link.

```powershell
$leadPatch = @{ stage = 'Qualification' } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "$baseUrl/api/leads/$($lead.data.id)" `
  -Headers $headers -WebSession $crmSession -ContentType 'application/json' -Body $leadPatch
```

Lead creation requires a contact UUID and an integer score from 1 through 10. Stage is optional. PATCH accepts `contactId`, `leadScore`, and `stage`. A second lead on the same contact returns 409. A missing contact returns 404. Stage labels are Prospecting, Qualification, Proposal, Negotiation, Closed Won, and Closed Lost.

## Create and edit an opportunity

This request adds an EGP opportunity with string money and a date-only close date.

```powershell
$opportunityBody = @{
  leadId = $lead.data.id
  opportunityName = 'Synthetic website project'
  estimatedValue = '30000.25'
  closeDate = '2027-01-15'
} | ConvertTo-Json
$opportunity = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/opportunities" `
  -Headers $headers -WebSession $crmSession -ContentType 'application/json' -Body $opportunityBody
```

This PATCH changes the estimate while preserving the name, lead link, and close date.

```powershell
$opportunityPatch = @{ estimatedValue = '35000.00' } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "$baseUrl/api/opportunities/$($opportunity.data.id)" `
  -Headers $headers -WebSession $crmSession -ContentType 'application/json' -Body $opportunityPatch
```

Opportunity creation requires all four fields shown above. PATCH accepts any subset. The maximum value is `"999999999999.99"`. JSON numbers, negative values, more than two fractional digits, invalid calendar dates, and timestamps in `closeDate` return 400. A missing lead returns 404.

## Search and follow the sales history

This request combines case-insensitive name search, source filtering, and a lead stage filter.

```powershell
Invoke-RestMethod -Uri "$baseUrl/api/contacts?search=Sara%20Example&source=Website%20Form&stage=Qualification" `
  -WebSession $crmSession
```

Contact search matches first name, last name, full-name parts, company, or email. `%`, `_`, and backslashes are treated literally. Source uses case-insensitive equality. Stage uses the exact labels above. Omitting stage includes contacts without a lead. Unknown parameters, repeated values, and invalid parameter types return 400.

This contact detail request reads the linked lead and all its opportunities.

```powershell
Invoke-RestMethod -Uri "$baseUrl/api/contacts/$($contact.data.id)" -WebSession $crmSession
```

These GET requests list the contact's lead, list its opportunities, and read one opportunity.

```powershell
Invoke-RestMethod -Uri "$baseUrl/api/leads?contactId=$($contact.data.id)" -WebSession $crmSession
Invoke-RestMethod -Uri "$baseUrl/api/opportunities?leadId=$($lead.data.id)" -WebSession $crmSession
Invoke-RestMethod -Uri "$baseUrl/api/opportunities/$($opportunity.data.id)" -WebSession $crmSession
```

Lead collections accept `contactId` and `stage`. Opportunity collections accept `leadId`. Detail and write routes accept no query parameters.

## Sign out and failures

This POST destroys the session and clears its cookie. Replaying the old cookie receives 401 on protected routes.

```powershell
Invoke-RestMethod -Method Post -Uri "$baseUrl/api/auth/logout" -Headers $headers -WebSession $crmSession
```

Errors use `{ "error": { "code": "<code>", "message": "<message>" } }`. Validation errors also include field paths and messages under `error.details`.

| Status | Meaning |
| --- | --- |
| 400 | Invalid body, JSON, UUID, or query parameters |
| 401 | Invalid credentials, missing session, or expired session |
| 403 | Missing or mismatched request origin |
| 404 | Missing route, resource, or parent contact/lead |
| 409 | A contact already has a lead |
| 413 | JSON body exceeds 100 KB |
| 429 | Ten failed login attempts per IP within 15 minutes, with `Retry-After` |
| 500 | Unexpected failure with a generic response |
| 503 | Database unavailable for readiness or a recognized database connection failure |

## Integration verification

`docker compose --profile test up -d --wait postgres-test` starts the isolated local test server.

```sh
docker compose --profile test up -d --wait postgres-test
```

`npm run test:integration --workspace backend` creates a disposable database, applies migrations, provisions synthetic accounts through the CLI, exercises the HTTP workflow, and removes its database during cleanup.

```sh
npm run test:integration --workspace backend
```

`npm test --workspace backend` runs both the database and HTTP suites using separate disposable databases.

```sh
npm test --workspace backend
```

`TEST_DATABASE_URL` is loaded from `backend/.env` and must identify a test server whose role can create databases. Tests cover every protected route, login/logout, session rotation and expiry, restart persistence, shared records, all resource create/edit flows, combined filtering, missing parents, duplicate lead races, body/query validation, and money/date serialization. Production-cookie tests simulate a trusted HTTPS proxy locally. Hosted TLS verification belongs to deployment verification.
