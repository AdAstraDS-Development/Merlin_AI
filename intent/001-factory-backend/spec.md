# Spec 001: Factory backend (dry-run slice)

Status: implemented (dry-run slice); hosting and retention open
Intent: `intent.md` in the same folder

The API serves the contract the web app already uses (`web/src/lib/factory-api.ts`, `factory-types.ts`), which follows `ai-sw-template/factory/PROTOCOL.md`. In this slice only `DryRun` runs and `DryRun` checks exist; the other modes are reported as unavailable. The dry run is computed in the API (names, steps, commands it would run, events) and does not call the PowerShell engine.

## Use cases

### UC-01 See the factory configuration

- **Actor:** signed-in user
- **Goal:** load the allowlists, tiers, defaults and run modes the request form is built from.
- **Main flow:** 1. The web app calls `GET /api/info`. 2. The API returns the configuration from the `Factory` settings section, a fresh 4-character name suffix in `defaults`, `isAdmin` for the caller, and the modes `DryRun` (available), `Local` and `Factory` (unavailable, with a reason). 3. `GET /api/modes/{mode}/check` returns the same availability for one mode.
- **Alternative and error flows:** not signed in → 401. Unknown mode → 404.

**Acceptance criteria**

1. Given a signed-in user, When they call `GET /api/info`, Then the response lists the configured owners, tenants, subscriptions, regions, databases and billing tiers, and `modes` contains `DryRun` available and `Local` and `Factory` unavailable with a non-empty reason.
2. Given a signed-in user without the admin role, When they call `GET /api/info`, Then `isAdmin` is false and `demo` is false; with the admin role both are true.
3. Given no session, When `GET /api/info` is called, Then the response is 401.
4. Given a signed-in user, When they call `GET /api/modes/Bogus/check`, Then the response is 404; for `Factory` it is 200 with `available: false`.

### UC-02 Validate and preview a request

- **Actor:** signed-in user
- **Goal:** see whether a request is valid and what a run would create and cost.
- **Main flow:** 1. The user completes the wizard. 2. The web app posts the request to `POST /api/requests/preview`. 3. The API validates it, applies the admin lock and returns the normalized request, its SHA-256 fingerprint, the derived names (repository, resource groups, state storage, identities, federated subjects, web apps, databases, GitHub environments), the step list and the simulated monthly cost.
- **Alternative and error flows:** invalid field → 400 validation problem keyed by field path (`azure.region`, `github.productionReviewers`, …). A non-admin changes a locked target → 400 with "Only platform admins can change where an app runs." on that field. Missing CSRF token → 400. Body over 64 KB or not JSON → 400.

**Acceptance criteria**

1. Given a valid request, When it is previewed, Then the response is 200 with `fingerprint`, `names`, `steps` and `cost`, and the names equal those of the template portal for the same request (shared test vectors).
2. Given a request whose `appSlug` is `A`, When it is previewed, Then the response is 400 with an error on `appSlug`.
3. Given a request with the production environment and no production reviewer, When it is previewed, Then the response is 400 with an error on `github.productionReviewers`.
4. Given a request with a tier without production and the production environment, When it is previewed, Then the response is 400 with an error on `azure.environments`.
5. Given a non-admin and a region other than the first allowed region, When they preview, Then the response is 400 with an error on `azure.region`; given an admin, Then it is 200.
6. Given a request for a slug that belongs to an app with a status other than `simulated`, When it is previewed, Then the response is 400 with an error on `appSlug`.
7. Given no CSRF token, When the request is posted, Then the response is 400 and nothing is stored.

### UC-03 Start a dry run and follow it

- **Actor:** signed-in user
- **Goal:** start a dry run and watch its steps.
- **Main flow:** 1. The web app posts `{request, mode: "DryRun", confirmation}` to `POST /api/runs`. 2. The API validates as in UC-02, records the run and the app (status `simulated`, unless the app exists with another status) and returns `202 {runId}`. 3. In the background the run emits `plan`, then per step `running` and `succeeded` (with the commands it would run), logs, and finally `result` `succeeded`, each stored. 4. `GET /api/runs/{id}/events?from=n` streams stored events from `n` as server-sent events and then live ones, and ends with an `end` event. `GET /api/runs/{id}` returns the summary.
- **Alternative and error flows:** mode `Local` or `Factory` → 400 on `mode`. A run for the same slug is still running → 409. Unknown run → 404. The app restarts during a run → the run is marked `failed` with a `result` event.

**Acceptance criteria**

1. Given a valid request, When a dry run is started, Then the response is 202 with a `runId`, and `GET /api/runs/{runId}` returns `mode: DryRun` and status `running` or `succeeded`.
2. Given a started dry run, When its events are read from 0 until `end`, Then the first is `plan`, every planned step has a `succeeded` event, and the last is `result` with status `succeeded`; a second read from 0 returns the same events in the same order.
3. Given mode `Factory`, When a run is started, Then the response is 400 with an error on `mode` and no run is stored.
4. Given a running run for slug `s`, When another run for `s` is started, Then the response is 409.
5. Given an app with status other than `simulated`, When a dry run for its slug finishes, Then the app's status is unchanged.
6. Given a run that was `running` when the app stopped, When the app starts, Then the run is `failed` and its last event is a failed `result`.

### UC-04 Browse the inventory

- **Actor:** signed-in user
- **Goal:** see all apps and the detail of one.
- **Main flow:** `GET /api/apps` returns the apps, newest first, each with status, requester's display name, resources derived from the last request, environments, simulated cost and last check. `GET /api/apps/{slug}` adds the last check result and the runs.
- **Alternative and error flows:** unknown slug → 404.

**Acceptance criteria**

1. Given two users A and B, When A finishes a dry run and B lists apps, Then B sees the app with `requestedBy` equal to A's display name and status `simulated`.
2. Given an unknown slug, When its detail is requested, Then the response is 404 problem details.
3. Given an app with two runs, When its detail is requested, Then `runs` lists both, newest first.

### UC-05 Dry-run status check

- **Actor:** signed-in user
- **Goal:** see which connections of an app would be checked.
- **Main flow:** `POST /api/apps/{slug}/check` with `{mode: "DryRun"}` stores and returns a check result (`overall` and one check per connection: a simulated `pass` for simulated apps, `unknown` "(dry run)" otherwise, as the template's `Get-AppStatus.ps1 -Mode DryRun` does) on the app detail. The app status does not change.
- **Alternative and error flows:** mode `Live` → 400 on `mode` ("Live checks are not available yet."). Unknown slug → 404.

**Acceptance criteria**

1. Given an app, When a DryRun check is posted, Then the response is the app detail with `check.checks` non-empty and `lastCheck.at` set, and the status is unchanged.
2. Given an app, When a Live check is posted with `confirm: true`, Then the response is 400 with an error on `mode`.

### UC-06 Simulated feature board

- **Actor:** signed-in user
- **Goal:** see how features would move through the AI-native loop and add one.
- **Main flow:** as in the template portal: `GET /api/apps/{slug}/features` returns stages and features computed from elapsed time (`simulated: true`); `POST` with `{title, kind, source}` adds one that runs once through all stages. Added features are kept in memory and lost on restart.
- **Alternative and error flows:** unknown slug → 404; title not 3 to 120 characters, `kind` not `feature`/`bug`, `source` not `jira`/`servicenow`/`teams` → 400; the 11th added feature of an app → 400 on `title`.

**Acceptance criteria**

1. Given an app, When its board is requested, Then the response has the eight stages and `simulated: true`.
2. Given a valid feature, When it is posted, Then the response is 201 and the board contains it.
3. Given a title of 2 characters, When it is posted, Then the response is 400 with an error on `title`.

### UC-07 Admin: sample simulation and target changes

- **Actor:** platform admin
- **Goal:** demonstrate the flow with a sample app; place an app outside the defaults.
- **Main flow:** `POST /api/demo` picks the first sample name not yet in the inventory, starts a dry run and returns `202 {runId, slug}`. The admin lock in UC-02 and UC-03 does not apply to admins.
- **Alternative and error flows:** non-admin → 403. All sample apps exist → 409.

**Acceptance criteria**

1. Given an admin, When they post `/api/demo`, Then the response is 202 with a run for a sample slug.
2. Given a non-admin, When they post `/api/demo`, Then the response is 403.

## API

All routes are under `/api`, return JSON, and errors are problem details. Request bodies are limited to 64 KB.

| Method and route                   | Use case | Authorization        | CSRF     | Request                         | Success                               | Errors        |
| ---------------------------------- | -------- | -------------------- | -------- | ------------------------------- | ------------------------------------- | ------------- |
| `GET /api/info`                    | UC-01    | signed in            | –        | –                               | 200 `FactoryInfo`                     | 401           |
| `GET /api/modes/{mode}/check`      | UC-01    | signed in            | –        | –                               | 200 `{available, reason}`             | 401, 404      |
| `POST /api/requests/preview`       | UC-02    | signed in            | required | `FactoryRequest`                | 200 `PreviewResult`                   | 400, 401      |
| `POST /api/runs`                   | UC-03    | signed in            | required | `{request, mode, confirmation}` | 202 `{runId}`                         | 400, 401, 409 |
| `GET /api/runs/{id}`               | UC-03    | signed in            | –        | –                               | 200 `RunSummary`                      | 401, 404      |
| `GET /api/runs/{id}/events?from=n` | UC-03    | signed in            | –        | –                               | 200 `text/event-stream` of `RunEvent` | 401, 404      |
| `GET /api/apps`                    | UC-04    | signed in            | –        | –                               | 200 `AppSummary[]`                    | 401           |
| `GET /api/apps/{slug}`             | UC-04    | signed in            | –        | –                               | 200 `AppDetail`                       | 401, 404      |
| `POST /api/apps/{slug}/check`      | UC-05    | signed in            | required | `{mode}`                        | 200 `AppDetail`                       | 400, 401, 404 |
| `GET /api/apps/{slug}/features`    | UC-06    | signed in            | –        | –                               | 200 `BoardData`                       | 401, 404      |
| `POST /api/apps/{slug}/features`   | UC-06    | signed in            | required | `NewFeature`                    | 201 `BoardData`                       | 400, 401, 404 |
| `POST /api/demo`                   | UC-07    | `Factory.Admin` role | required | `{}`                            | 202 `{runId, slug}`                   | 401, 403, 409 |

Validation follows `ai-sw-template/factory/request.schema.json` and the allowlists in the `Factory` settings: `appName` `^[A-Z][A-Za-z0-9]{1,39}$`, `appSlug` `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` with 3 to 25 characters, no control characters in any string except line breaks and tabs in `description` (≤ 16,000), `problem` and `outcome` (≤ 2,000 each); `documentLinks` `^https://\S+$`; tenant, subscription, region, owner and database on their allowlists; `github.repoName` `^[A-Za-z0-9][A-Za-z0-9._-]*$`, not ending in `.git`, not `.github`/`.github-private`; `billing.tier` on the tier list and `billing.costCenter` `^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$`. `author` is ignored and replaced with the caller's display name.

## UI states

The views exist already; this slice switches the build to `VITE_FACTORY_API=server`.

| View             | Loading              | Empty                                   | Error                                                                                      | Success                |
| ---------------- | -------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------- |
| Any factory view | existing skeletons   | existing empty states                   | 401: "Sign in to use Merlin" with a **Sign in** button; other errors: existing `LoadError` | existing               |
| New app (wizard) | existing             | –                                       | field messages from the validation problem                                                 | preview, then run page |
| Run              | "Waiting for events" | –                                       | "The run events could not be loaded." after the stream fails                               | live steps and result  |
| Apps             | existing             | "No apps yet" with **Create a new app** | existing                                                                                   | shared list            |

## Data

Stored in Azure SQL (`data-access`), schema `factory`. Personal data: the requester's display name and Entra object ID only.

| Table / field                                                                                | Type                    | Rules                                           |
| -------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------- |
| `Apps.Slug`                                                                                  | nvarchar(25), key       | as `appSlug`                                    |
| `Apps.Name`, `Status`, `CreatedAt`, `UpdatedAt`                                              | text, text, UTC, UTC    | status from the `AppStatus` list                |
| `Apps.RequestedByOid`, `RequestedByName`                                                     | guid, nvarchar(200)     | from the session claims, never from the request |
| `Apps.Request`                                                                               | nvarchar(max) JSON      | the normalized request (≤ 64 KB)                |
| `Runs.Id`, `AppSlug`, `Mode`, `Status`, `StartedAt`, `FinishedAt`, `StartedByOid`, `Message` | text, FK, …             | one running run per slug                        |
| `RunEvents.RunId`, `Seq`, `Json`                                                             | FK, int, nvarchar(4000) | key (`RunId`, `Seq`); at most 5,000 per run     |
| `Checks.AppSlug`, `At`, `Overall`, `Json`                                                    | FK, UTC, text, JSON     | last result shown; history kept                 |

Feature-board additions stay in memory (as in the template). Configuration (allowlists, billing) lives in the `Factory` section of `appsettings.json`, defaulting to the template's example configuration.

## Authorization

- Signed-in users (any account the Entra app registration accepts) may use every endpoint except `/api/demo`, see every app and run, and start dry runs with the default targets.
- Users with the Entra app role `Factory.Admin` may also start the sample simulation and preview or run requests with other allowed targets.
- Nothing else exists in this slice: no approval, no deletion, no Live checks.

## Non-functional

- Single instance; runs execute in-process. A restart fails running runs (UC-03 AC 6).
- Audit: each run stores who started it and when; logs carry run IDs and slugs, never request contents.
- Events stream within one second of being stored; keep-alive comment every 15 s.
- The serverless database may resume slowly; connect timeout ≥ 60 s and retries on transient errors.

## Flagged concerns

- [ ] **No backend hosting or database in Terraform.** `infrastructure/backend.tf` and `database.tf` are commented out; the frontend is deployed as a Static Web App. The BFF needs the SPA and `/api` on one origin with the session cookie, so either the App Service serves the SPA (as `api/` already does) or the Static Web App links the backend. Until hosting is decided and applied, this slice can only run locally. Infrastructure change, separate review. — Tech lead.
- [x] **Admin role.** Decided 2026-10-22: Entra app role `Factory.Admin` (`Factory:AdminRole`). Proposed Entra app role `Factory.Admin` instead of the template's OS user list. Needs adding to the app registration. — Product owner, tech lead.
- [x] **Inventory visibility.** Decided 2026-10-22: every signed-in user sees every app. Spec lets every signed-in user see every app and the requester's display name, as the template does. — Product owner.
- [ ] **Retention.** No retention rule for apps, runs and events yet; proposal: simulated apps and their runs deleted after 90 days. — Product owner, data protection.
- [x] **Dry run without the engine.** Decided 2026-10-22: C# dry run; vectors in `api/tests/Merlin.Api.Tests/testdata/names`. The dry run is reimplemented in C# instead of calling `New-AppProject.ps1` (no PowerShell on Linux App Service). Names and steps can drift from the engine; mitigated by test vectors generated from the engine's `-ValidateOnly` output. — Tech lead.
- [x] **New dependencies.** Decided 2026-10-22, with `System.Security.Cryptography.Pkcs` 10.0.13 pinned because SqlClient brings a vulnerable 9.0.11 (GHSA-846f-f764-76mx). `Microsoft.EntityFrameworkCore.SqlServer` and `Microsoft.EntityFrameworkCore.Design` (exact versions, lock files updated). — Tech lead.
- [x] **Anonymous home page.** Decided 2026-10-22: sign-in prompt. The Static Web App build, which has no backend, keeps the simulation. The SPA's home page is public, but every factory call now needs sign-in; anonymous visitors see the sign-in prompt instead of the simulated data. Keeping the in-browser simulation for anonymous visitors would need a decision. — Product owner.
- [x] **Local development database.** Decided 2026-10-22. With no database configured (`Database:Kind` `none`) the API uses an in-memory registry so `pnpm start` keeps working without Azure; the in-memory registry must never be used in production (startup fails outside the Development and Testing environments). — Tech lead.
