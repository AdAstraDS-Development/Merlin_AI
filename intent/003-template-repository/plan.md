# Plan 003: Create the app repository from the template

Status: agreed 2026-10-22 (status `requested` after the run, no approval step, Terraform in a separate pull request). Built; departures noted under "Changes during the build". Spec: `spec.md` (UC-08).

## Approach

- **GitHub access behind an interface.** `IGitHub` with the six calls the run needs; `GitHubAppClient` implements it with a typed `HttpClient` (`IHttpClientFactory`, built in) and signs the app JWT with `RSA.ImportFromPem` (no new packages). Tests replace `IGitHub` with an in-memory fake that records calls, so no test reaches GitHub.
- **One run engine, two scripts.** `RunService.StartDryRunAsync` becomes `StartRunAsync(mode, …)`; `PlayAsync` calls `DryRun.RunAsync` or the new `FactoryRun.RunAsync`. Both use the same `emit` and the same failure handling. At the end, `FinishRunAsync` also gets the app status to set (`simulated` dry runs unchanged; Factory: `requested` or `failed`).
- **Availability in one place.** `GitHubOptions.Configured` drives `Mode("Factory")` in `/api/info`, `/api/modes/Factory/check` and the mode check in `POST /api/runs`.
- **Errors without secrets.** `GitHubException(status, message)` carries only GitHub's status code and `message` field; the client never logs headers or bodies.

## Files that change

| File                                                        | Change                                                                                                                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/src/Merlin.Api/Features/Factory/GitHubOptions.cs`      | New. `Factory:GitHub` (`AppId`, `PrivateKey`, `TemplateRepository`, `ApiUrl`), all-or-nothing validation, `Configured`, API base derived from `GithubHost`. |
| `api/src/Merlin.Api/Features/Factory/GitHubAppClient.cs`    | New. `IGitHub`, `GitHubException`, `GitHubAppClient` (JWT, installation token, repo exists, generate, topics, set visibility).                              |
| `api/src/Merlin.Api/Features/Factory/FactoryRun.cs`         | New. The Factory script: plan, validate, prerequisites, export skipped, repository, resources, the rest skipped, result.                                    |
| `api/src/Merlin.Api/Features/Factory/RunService.cs`         | Mode parameter, dispatch, app status at the end.                                                                                                            |
| `api/src/Merlin.Api/Features/Factory/FactoryEndpoints.cs`   | Register options and client; `Factory` availability; confirmation check; pass the mode.                                                                     |
| `api/src/Merlin.Api/Features/Factory/Preview.cs`            | `Commands("repository")` lists the generate and topics calls instead of `gh repo create` / `git push`.                                                      |
| `api/src/Merlin.Api/Data/*Registry.cs`, `IAppRegistry.cs`   | `FinishRunAsync(…, appStatus)`; `StartRunAsync` lets a Factory run set `provisioning` on a simulated or new app.                                            |
| `api/src/Merlin.Api/appsettings.json`                       | `Factory:GitHub` with `TemplateRepository` and empty `AppId`/`PrivateKey`.                                                                                  |
| `api/tests/Merlin.Api.Tests/Integration/FactoryHost.cs`     | `GitHubFactoryHost` with the fake `IGitHub` and a test key; `StartRun(mode, confirmation)` helper.                                                          |
| `api/tests/Merlin.Api.Tests/Integration/FactoryRunTests.cs` | New. `UC08_*` tests, one or more per acceptance criterion.                                                                                                  |
| `api/tests/Merlin.Api.Tests/Unit/GitHubAppClientTests.cs`   | New. JWT claims and signature, API base for `ghe.com`/`github.com`, request bodies, error mapping, against a stub `HttpMessageHandler`.                     |
| `web/src/app/new-app-view.tsx`                              | Factory card text, typed confirmation for `Factory` too, button **Create repository**.                                                                      |
| `web/src/app/app.test.tsx` (or a new test)                  | `UC08` test: Factory needs the typed slug and posts `mode: Factory`.                                                                                        |
| `web/src/lib/factory-sim.ts`                                | Unchanged (simulation keeps Factory unavailable).                                                                                                           |
| `api/README.md`, `docs/user-guide/README.md`                | Run modes and the `Factory:GitHub` settings; "Set up the GitHub App" (permissions, install, user secrets).                                                  |
| `spec.md`                                                   | Status.                                                                                                                                                     |

Not in this change: Terraform (`backend.tf`, `key-vault.tf`) for the app settings. That is a separate infrastructure pull request, after the GitHub App exists (flagged concern).

## Order of work

1. `GitHubOptions`, `IGitHub`, `GitHubAppClient` and unit tests.
2. Registry status change, `RunService` mode dispatch, `FactoryRun` with the fake; integration tests UC08 AC 1–9.
3. Endpoints (availability, confirmation).
4. Web review step and its test.
5. Docs, spec status, `pnpm validate`, verifier.

## Proof

| AC  | Test                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------- |
| 1   | `UC08_FactoryModeAvailableOnlyWhenGitHubAppConfigured` (both hosts)                                       |
| 2   | `UC08_FactoryRunNeedsSlugConfirmation`                                                                    |
| 3   | `UC08_FactoryRunGeneratesRepositoryFromTemplate` (fake records calls)                                     |
| 4   | `UC08_FactoryRunEventsSkipStepsNotAutomated`                                                              |
| 5   | `UC08_FactoryRunLeavesAppRequestedWithRepository`                                                         |
| 6   | `UC08_FactoryRunStopsWhenRepositoryExists`                                                                |
| 7   | `UC08_FactoryRunFailsWhenGitHubRejectsGenerate`                                                           |
| 8   | `UC08_FactoryRunEventsNeverContainToken` (fake returns a marker token; events and captured logs searched) |
| 9   | `UC08_InternalVisibilityIsSetAfterGenerate`                                                               |

## Risks

- **GHE.com API differences.** Template generation and topics exist on GitHub Enterprise Cloud; the API base for data residency is `https://api.<subdomain>.ghe.com`. Mitigation: `ApiUrl` override; a manual check against `acme.ghe.com` once the App exists.
- **Generate is not idempotent.** A timeout after GitHub accepted the call leaves a repository; the next run then stops at the collision check. Accepted and documented.
- **Real repositories from tests.** Prevented: tests always replace `IGitHub`, and `Testing` without a configured App leaves the mode unavailable.

## Changes during the build

- The registry got `SetAppStatusAsync(slug, status, at)` instead of an extra parameter on `FinishRunAsync`; `StartRunAsync` now also sets the status of a simulated app, so a Factory run moves it to `provisioning`. A restart sets the app of an interrupted Factory run to `failed` (`UC08_RestartFailsAppOfInterruptedFactoryRun`).
- `GitHubOptions` is nested in `FactoryOptions` (`Factory:GitHub`), so `Preview.Commands` can name the template and one options validation covers both.
- The web test is `web/src/app/review-pane.test.tsx`; `ReviewPane` is exported for it. The fingerprint line for approvers is removed from the Factory card, since there is no approval yet.
- Extra tests: `UC08_FactoryRunFailsWhenAppNotInstalled`, `UC08_NonAdminCannotRequestInternalVisibility`, and unit tests for the client (`GitHubAppClientTests`).
- Personal access token as an alternative (AC 10, flagged concern in `spec.md`): `Factory:GitHub:Auth` (`App` or `Token`) and `Factory:GitHub:Token`; `IGitHub.InstallationTokenAsync` became `AccessTokenAsync`, which returns the installation token or the checked token; `GitHubAppClient` became `GitHubClient`. Terraform `github_auth` writes the token settings with a Key Vault reference to `github-token`. Tests: `TokenRunTests` and the token tests in `GitHubClientTests`.
