# Plan 001: Factory backend (dry-run slice)

Status: implemented. Spec: `spec.md` in the same folder. Agreed 2026-10-22 with the proposals in the spec's flagged concerns; see Departures from the plan.

## Approach

Port the dry-run parts of `ai-sw-template/factory/portal` into `Merlin.Api` as one feature folder, replace its token/loopback security with the existing BFF pipeline (session cookie, `RequireAuthorization`, `RequireCsrf`), replace SQLite with EF Core on Azure SQL, and replace the PowerShell engine call with a C# dry run. Then build the web app against the server API.

## Files that change

| File                                                                                                                                                     | Change                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/src/Merlin.Api/Features/Factory/FactoryEndpoints.cs`                                                                                                | New. `MapFactory()` extension: one `/api` group with `RequireAuthorization()`, CSRF on the POSTs, admin policy on `/demo`                           |
| `api/src/Merlin.Api/Features/Factory/FactoryOptions.cs`                                                                                                  | New. Typed `Factory` settings (allowlists, billing, admin role), `ValidateOnStart`; example values from `factory.config.example.json`               |
| `api/src/Merlin.Api/Features/Factory/RequestValidator.cs`                                                                                                | Port of the template validator with typed records instead of `JsonNode` where it stays readable; admin target lock                                  |
| `api/src/Merlin.Api/Features/Factory/Preview.cs`, `Costs.cs`, `FeatureBoard.cs`                                                                          | Ports of the template files (names, steps, fingerprint, simulated cost, simulated board)                                                            |
| `api/src/Merlin.Api/Features/Factory/DryRun.cs`                                                                                                          | New. Emits `plan`, step, log and `result` events with the commands each step would run (from the engine's `Invoke-Tool` calls and `factory-sim.ts`) |
| `api/src/Merlin.Api/Features/Factory/RunService.cs`                                                                                                      | New. Starts runs (one per slug), runs them on a background `Channel` worker, stores events, notifies SSE readers; fails `running` runs at startup   |
| `api/src/Merlin.Api/Data/MerlinDbContext.cs`, `Data/DatabaseOptions.cs`, `Data/IAppRegistry.cs`, `Data/SqlAppRegistry.cs`, `Data/InMemoryAppRegistry.cs` | New data layer per `data-access`; in-memory registry only in Development with `Database:Kind` `none`                                                |
| `api/src/Merlin.Api/Data/Migrations/*_UC03_FactoryRegistry.cs`                                                                                           | First migration: `Apps`, `Runs`, `RunEvents`, `Checks` in schema `factory`                                                                          |
| `api/src/Merlin.Api/Program.cs`                                                                                                                          | Register options, data layer, run service, `Factory.Admin` policy; call `app.MapFactory()` before the fallbacks; 64 KB request limit on `/api`      |
| `api/src/Merlin.Api/Merlin.Api.csproj`, `packages.lock.json` (both projects)                                                                             | Add `Microsoft.EntityFrameworkCore.SqlServer` and `.Design` with exact versions; restore with `--force-evaluate`                                    |
| `api/src/Merlin.Api/appsettings.json`, `appsettings.Development.json`                                                                                    | `Factory` section (example configuration), `Database:Kind` `none` for development                                                                   |
| `api/tests/Merlin.Api.Tests/Integration/Factory*Tests.cs`                                                                                                | Integration tests per acceptance criterion with a test auth handler registered only in the test host and the in-memory registry                     |
| `api/tests/Merlin.Api.Tests/Unit/PreviewTests.cs`, `testdata/names/*.json`                                                                               | Name derivation against vectors produced by the engine's `-ValidateOnly`                                                                            |
| `web/package.json` / `web/vite.config.ts`                                                                                                                | Build with `VITE_FACTORY_API=server` by default; keep the simulation for `pnpm --dir web dev` without a backend                                     |
| `web/src/app/load-error.tsx`, `web/src/app/app.tsx`                                                                                                      | 401 shows "Sign in to use Merlin" with a **Sign in** button (`/api/auth/login`)                                                                     |
| `web/src/app/app.test.tsx`                                                                                                                               | Test for the 401 state                                                                                                                              |
| `api/README.md`, `docs/user-guide/README.md`, `spec.md`                                                                                                  | Routes table, user guide, spec status                                                                                                               |

Not changed here: `infrastructure/` (hosting and database are a separate, reviewed change; see the spec's first concern), `.github/workflows/`, authentication setup in `Program.cs` beyond adding the policy.

## Order of work

Each step ends with `pnpm validate` green and its own commit referencing the use case.

1. **Settings and info (UC-01).** `FactoryOptions`, `/info`, `/modes/{mode}/check`, admin policy, endpoint group. Tests for 401, modes, `isAdmin`.
2. **Validation and preview (UC-02).** Port validator, names, steps, fingerprint, costs; target lock. Engine test vectors.
3. **Data layer.** DbContext, migration, both registries, `DatabaseOptions` with `ValidateOnStart`; startup refuses the in-memory registry outside Development.
4. **Dry runs (UC-03).** `DryRun`, `RunService`, `/runs`, `/runs/{id}`, SSE `/runs/{id}/events`, restart handling.
5. **Inventory and checks (UC-04, UC-05).** `/apps`, `/apps/{slug}`, `/apps/{slug}/check` DryRun.
6. **Feature board and demo (UC-06, UC-07).**
7. **Web app.** Server API by default, 401 state, run the whole flow in `pnpm start` with a configured Entra registration.
8. **Docs.** Routes table, user guide, spec status `implemented`.

## Departures from the plan

- **Web build mode instead of a new default.** The Static Web App deployment builds `web/` without a backend, so switching the default would break it. The root `pnpm build` builds with `--mode server` instead (`package.json`, `factory-api.ts`); plain web builds keep the simulation.
- **In-memory registry also in Testing.** The integration tests run in the `Testing` environment; both Development and Testing may use it.
- **Request kept as JSON.** The validator, names and costs work on the normalized request as `JsonObject`, as in the template, so the contract stays identical.
- **Security pin.** `System.Security.Cryptography.Pkcs` 10.0.13 is referenced directly because `Microsoft.Data.SqlClient` pulls in 9.0.11 (GHSA-846f-f764-76mx), which fails restore.
- **Commits.** The backend landed as one commit for UC-01 to UC-07 rather than one per step, followed by the web app and the docs.
- **Known limits after review:** the SQL registry has no automated test (all tests use the in-memory one); the 5,000-events-per-run cap is not enforced (a dry run writes about 40); nothing limits how many dry runs a person starts; one malformed stored request would make `GET /api/apps` fail.
- **Not done:** step 7's end-to-end run with a configured Entra registration. Checked only that the server build shows the sign-in prompt without a session.

## Risks

| Risk                                                                       | Mitigation                                                                                                            |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| C# dry run drifts from the engine                                          | Test vectors from `New-AppProject.ps1 -ValidateOnly`; note the template commit they came from                         |
| Background runs and SSE on a single instance                               | Same constraint as the file ticket store, documented in `docs/operations`; restart fails running runs                 |
| Test auth handler leaking into production                                  | Registered only by `WebApplicationFactory` in the test project; a test asserts the production host has no such scheme |
| In-memory registry used in Azure by mistake                                | Startup fails outside Development when `Database:Kind` is `none`                                                      |
| Local SDK mismatch: `global.json` pins 10.0.402; this machine has 10.0.401 | Install 10.0.402 before step 1, or validate in CI                                                                     |
| Large SSE fan-out or long-lived connections                                | Keep-alive every 15 s; streams end after `result`; 5,000 events per run cap                                           |

## How each acceptance criterion is proven

| Criterion     | Test                                                                                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UC-01 AC 1–4  | `UC01_InfoListsAllowlistsAndModes`, `UC01_InfoMarksAdmin`, `UC01_InfoRequiresSignIn`, `UC01_UnknownModeIsNotFound`                                                                                                          |
| UC-02 AC 1–7  | `UC02_PreviewMatchesEngineNames`, `UC02_RejectsInvalidSlug`, `UC02_ProductionNeedsReviewer`, `UC02_TierWithoutProductionRejected`, `UC02_NonAdminCannotChangeRegion`, `UC02_RealAppSlugIsTaken`, `UC02_PreviewRequiresCsrf` |
| UC-03 AC 1–6  | `UC03_StartsDryRun`, `UC03_EventsReplayInOrder`, `UC03_FactoryModeRejected`, `UC03_OneRunPerSlug`, `UC03_DryRunKeepsRealAppStatus`, `UC03_RestartFailsRunningRuns`                                                          |
| UC-04 AC 1–3  | `UC04_InventoryIsShared`, `UC04_UnknownAppIsNotFound`, `UC04_DetailListsRunsNewestFirst`                                                                                                                                    |
| UC-05 AC 1–2  | `UC05_DryRunCheckStoresResult`, `UC05_LiveCheckRejected`                                                                                                                                                                    |
| UC-06 AC 1–3  | `UC06_BoardHasStages`, `UC06_AddsFeature`, `UC06_RejectsShortTitle`                                                                                                                                                         |
| UC-07 AC 1–2  | `UC07_AdminStartsDemo`, `UC07_NonAdminDemoForbidden`                                                                                                                                                                        |
| Web 401 state | `app.test.tsx`: "shows sign-in prompt when the factory API returns 401"                                                                                                                                                     |
