# Spec 003: Create the app repository from the template

Status: implemented (UC-08); GitHub App registration and Terraform open
Intent: `intent.md` in the same folder

Adds the `Factory` run mode to the API of spec 001. In this slice a Factory run performs `validate`, `prerequisites` and `repository` for real and reports every other step as `skipped`. Events, statuses and the collision rule follow `ai-sw-template/factory/PROTOCOL.md`.

## Use cases

### UC-08 Create the repository from the template

- **Actor:** signed-in user
- **Goal:** get the app's GitHub repository, created from the template, without waiting for a platform engineer.
- **Preconditions:** the GitHub App is configured (`Factory:GitHub`) and installed on the request's owner.
- **Main flow:**
  1. On the review step the user picks **Through the factory**; the web app calls `GET /api/modes/Factory/check`, which reports it available.
  2. The user types the app slug to confirm and starts the run: `POST /api/runs` with `{request, mode: "Factory", confirmation: "<slug>"}`.
  3. The API validates as for a dry run (UC-02, UC-03), records the run (`mode: Factory`) and the app with status `provisioning`, and returns `202 {runId}`.
  4. In the background the run emits `plan` with the full step list, then:
     - `validate` succeeded, with the derived names;
     - `prerequisites`: gets an installation token for the owner and checks that `{owner}/{repoName}` does not exist (404); succeeded;
     - `export` skipped ("The template repository is used instead.");
     - `repository`: `POST /repos/{template}/generate` with `owner`, `name`, `private: true`, `description` (the request's `problem`, ≤ 350 characters), `include_all_branches: false`; then sets the topic `project-factory`; for `internal` visibility, `PATCH` the repository to `internal`; succeeded with `url` = the repository's `html_url`;
     - a `resources` event with the `github` block;
     - every later step `skipped` ("Not automated in Merlin yet.");
     - `result` succeeded with `repoUrl` and the message "Repository created. The remaining steps are not automated yet."
  5. The app's status becomes `requested` (see flagged concerns) and its resources link to the repository.
- **Alternative and error flows:**
  - GitHub App not configured → `Factory` is unavailable in `GET /api/info` and `/api/modes/Factory/check` with the reason "The GitHub App is not configured."; `POST /api/runs` → 400 on `mode`.
  - Confirmation is not the slug → 400 on `confirmation`, nothing stored.
  - App not installed on the owner, or the token cannot be obtained → `prerequisites` failed ("Merlin's GitHub App is not installed on <owner>."), `result` failed, app status `failed`.
  - Repository exists (any answer other than 404) → `prerequisites` failed ("The repository <owner>/<repo> exists already. Choose another repository name."), nothing created.
  - Generate fails → `repository` failed with GitHub's status and message (no token, no headers), `result` failed, app status `failed`.
  - Topic or visibility fails after the repository was created → `repository` failed naming the created repository so it can be fixed by hand; app status `failed`.
  - An app with the slug exists with a status other than `simulated` → 400 on `request.appSlug` (as UC-02 AC 6).
  - Run for the slug in progress → 409. Merlin restarts during the run → run failed (UC-03 AC 6).

**Acceptance criteria**

1. Given the GitHub App is configured, When a signed-in user calls `GET /api/info` or `GET /api/modes/Factory/check`, Then `Factory` is available; given it is not configured, Then it is unavailable with the reason "The GitHub App is not configured." and `POST /api/runs` with mode `Factory` is 400 on `mode`.
2. Given a valid request, When a Factory run is started with a confirmation other than the slug, Then the response is 400 on `confirmation` and no run is stored.
3. Given a valid request and a repository that does not exist, When a Factory run finishes, Then GitHub received one generate call for `acme-factory/ai-template-dotnet` with the request's owner and repository name and `private: true`, and one topics call with `project-factory`.
4. Given that run, When its events are read, Then `validate`, `prerequisites` and `repository` succeeded, `repository` has the repository URL, every other planned step is `skipped`, and the last event is `result` succeeded with `repoUrl`; `GET /api/runs/{id}` has `mode: Factory`.
5. Given that run, When the app is listed, Then its status is `requested` and `resources.github.url` is the repository URL.
6. Given the repository exists already, When a Factory run runs, Then `prerequisites` failed with a message naming the repository, no generate call was made, the result is failed and the app status is `failed`.
7. Given GitHub rejects the generate call, When the run runs, Then `repository` failed with GitHub's message, the result is failed and the app status is `failed`.
8. Given any Factory run, When its events and logs are inspected, Then neither contains the installation token or the private key.
9. Given an admin request with visibility `internal`, When the run finishes, Then the repository was changed to `internal` after generation.
10. Given `Factory:GitHub:Auth` is `Token` with a token, When a Factory run runs, Then it checks the token (`GET /user`) instead of the App installation and creates the repository as in AC 3–5; without a token the mode is unavailable with "The GitHub token is not configured."; when GitHub rejects the token (401), `prerequisites` fails with "GitHub rejected Merlin's token…" and nothing is created; the token never appears in events or logs.

## API

No new routes. Changes to spec 001:

| Method and route              | Change                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /api/info`               | `modes`: `Factory` available when `Factory:GitHub` is configured, otherwise unavailable with reason                  |
| `GET /api/modes/{mode}/check` | same availability for `Factory`                                                                                      |
| `POST /api/runs`              | accepts `mode: "Factory"`; `confirmation` must equal `request.appSlug` (400 on `confirmation`); 202 `{runId}` as now |

Authorization, CSRF, body limit and validation as in spec 001: signed in, CSRF required, 64 KB, admin lock on targets.

Outbound calls (GitHub REST, API base `https://api.<host>` for `*.ghe.com`, `https://api.github.com` for `github.com`, overridable by `Factory:GitHub:ApiUrl`):

| Call                                          | Token                  | Step          |
| --------------------------------------------- | ---------------------- | ------------- |
| `GET /orgs/{owner}/installation`              | app JWT (RS256, 9 min) | prerequisites |
| `POST /app/installations/{id}/access_tokens`  | app JWT                | prerequisites |
| `GET /repos/{owner}/{repo}`                   | installation token     | prerequisites |
| `POST /repos/{template}/generate`             | installation token     | repository    |
| `PUT /repos/{owner}/{repo}/topics`            | installation token     | repository    |
| `PATCH /repos/{owner}/{repo}` (internal only) | installation token     | repository    |

Timeouts 30 s per call; no retries for `generate` (not idempotent).

## UI states

| View             | Change                                                                                                                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New app, review  | **Through the factory** card: "Creates the GitHub repository from the template. Azure follows later." Enabled when available; disabled with the reason otherwise. Needs the slug typed (as `Local`). Button **Create repository**. |
| Run              | Existing view; `skipped` steps shown as "Skipped" with the detail; result links the repository.                                                                                                                                    |
| Apps, app detail | Existing; status `requested` and the repository link.                                                                                                                                                                              |

## Data

No schema change. `Runs.Mode` stores `Factory`; `Apps.Status` uses `provisioning`, `requested` and `failed` from the existing status list. The registry gets an operation to set an app's status at the end of a run. The `resources` event is stored like every other event; app resources keep coming from the request (`Preview.Resources`), whose `github.url` equals the created repository's URL.

Configuration (`Factory:GitHub`):

| Setting              | Example                           | Secret | Where                                              |
| -------------------- | --------------------------------- | ------ | -------------------------------------------------- |
| `Auth`               | `App` (default) or `Token`        | no     | `appsettings`, Terraform `github_auth`             |
| `AppId`              | `123456`                          | no     | `appsettings`, Terraform app setting               |
| `PrivateKey`         | PEM                               | yes    | user secrets locally; Key Vault reference in Azure |
| `Token`              | personal access token             | yes    | user secrets locally; Key Vault reference in Azure |
| `TemplateRepository` | `acme-factory/ai-template-dotnet` | no     | `appsettings`                                      |
| `ApiUrl`             | empty (derived from `GithubHost`) | no     | `appsettings`                                      |

In App mode the section is all-or-nothing: `AppId` and `PrivateKey` both set (and the key parses as RSA) or both empty; anything else fails at startup. In Token mode only `Token` counts; a token with whitespace fails at startup. `Auth` other than `App` or `Token` fails at startup.

## Authorization

- Any signed-in user may start a Factory run with the default targets; admins may use other allowed targets (admin lock from spec 001).
- The GitHub App needs, on the installed organization: **Administration: write** (create repositories, topics, visibility), **Contents: read** and **Metadata: read**; and **Contents: read** on the template repository (same organization).
- The app's installation is limited to the allowed owners; owners outside `AllowedOwners` are already rejected by validation.

## Non-functional

- Audit: the run stores who started it; logs carry run ID, slug and repository full name, never tokens or the request contents. The GitHub repository records the App as creator.
- Installation tokens are fetched per run and not stored; the private key is read once at startup and kept in memory only.
- A run takes a few seconds; GitHub copies the template contents asynchronously, so the first push of files may appear a few seconds after the run ends.

## Flagged concerns

- [x] **Status after a partial run.** Decided 2026-10-22: `requested`. PROTOCOL's `live` means the whole run worked, which is not true here. Proposal: `requested` (saved, later steps not started) until the Azure steps exist. — Product owner.
- [x] **No approval.** Decided 2026-10-22: no approval step in this slice. PROTOCOL's Factory mode waits for a `factory` environment approval; here any employee with Merlin access can create a repository in `acme-factory`. Mitigations: default owner only, typed confirmation, one run per slug, audit. An approval step is a later use case. — Product owner, security.
- [ ] **GitHub App registration and installation** on `acme.ghe.com` is a manual admin step with the permissions above; Merlin cannot work without it. — Platform admins.
- [x] **Infrastructure change.** Done 2026-10-22: `github_app_id` in Terraform sets both settings, the key is a Key Vault reference (`infrastructure/README.md`, "Enable Factory runs in Azure"). `Factory__GitHub__AppId` and a Key Vault reference for `Factory__GitHub__PrivateKey` in `infrastructure/backend.tf` / `key-vault.tf`. Needs approval as an infrastructure change. — Tech lead.
- [x] **Personal access token as an alternative.** Decided 2026-10-22 (product owner): `Factory:GitHub:Auth` = `Token` uses a personal access token instead of the GitHub App; the App stays the default. This departs from the intent's constraint "GitHub App, not a personal token": the token is long-lived, tied to an account and has that account's rights, and repositories show the account as creator. Mitigations: a dedicated service account, a fine-grained token limited to `acme-factory` with an expiry date, kept in Key Vault. — Product owner, security.
- [ ] **Template content.** The repository is an unchanged copy of `ai-template-dotnet`: no `intent/001-initial/intent.md`, no `.tfvars` with the app's names. A later step commits them. — Tech lead.
- [ ] **Orphans.** If topic or visibility fails after generation, the repository exists without the `project-factory` topic and must be fixed by hand (PROTOCOL recovery rule). — Platform admins.
