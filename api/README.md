# Backend

One ASP.NET Core (.NET 10) project, `Merlin.Api`. It serves the built React app and the API, signs users in with Microsoft Entra ID (OpenID Connect) and keeps sessions on the server. The browser only ever holds an opaque session cookie.

## Enable sign-in

Without configuration, the public page works, `/api/auth/login` returns 503 and private endpoints return 401. To enable real sign-in:

1. In the Entra admin center, create an app registration of type **Web** (not SPA), single tenant.
2. Add these redirect URIs:
   - `https://localhost:7243/api/auth/callback` (sign-in, local)
   - `https://localhost:7243/` (where users return after sign-out, local)
   - In Azure: the Terraform outputs `entra_redirect_uri` and `entra_sign_out_uri`.
3. Leave implicit grant (access and ID tokens) switched off. Create a client secret.
4. Store the four settings locally with user secrets (run from the project root):

   ```powershell
   dotnet user-secrets set "Auth:TenantId" "<tenant GUID>" --project api/src/Merlin.Api
   dotnet user-secrets set "Auth:ClientId" "<client GUID>" --project api/src/Merlin.Api
   dotnet user-secrets set "Auth:PublicOrigin" "https://localhost:7243" --project api/src/Merlin.Api
   $secret = Read-Host 'Client secret' -AsSecureString
   dotnet user-secrets set "Auth:ClientSecret" ([System.Net.NetworkCredential]::new('', $secret).Password) --project api/src/Merlin.Api
   ```

   Reading the secret with `Read-Host` keeps it out of your shell history. User secrets are stored unencrypted in your user profile and are meant for development only.

5. Restart the app and select **Sign in**.

All four values must be set together. If only some are set, or a value is invalid, the app refuses to start rather than running with weakened sign-in. `PublicOrigin` must be an HTTPS origin without a path.

In Azure, Terraform sets the same values once `entra_client_id` is set; the client secret comes from Key Vault through a Key Vault reference (see [infrastructure](../infrastructure/README.md#enable-sign-in-in-azure)). In Entra you can restrict access with user assignment and Conditional Access. Every user the registration accepts can open the workspace until you add roles.

## Endpoints

| Endpoint                                | Access                          | Behavior                                                                                                                                                                           |
| --------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                                 | Public                          | React home page                                                                                                                                                                    |
| `GET /app`                              | Signed in                       | Protected workspace; anonymous users are sent to sign-in (or home if sign-in is off)                                                                                               |
| `GET /api/config`                       | Public                          | App name and whether sign-in is enabled                                                                                                                                            |
| `GET /api/auth/login`                   | Public                          | Starts sign-in; always returns to `/app`; 503 if sign-in is off                                                                                                                    |
| `/api/auth/callback`                    | Public                          | Sign-in callback, handled by the OpenID Connect middleware                                                                                                                         |
| `GET /api/me`                           | Signed in                       | Display name of the current user                                                                                                                                                   |
| `GET /api/auth/csrf`                    | Signed in                       | CSRF request token for state-changing calls                                                                                                                                        |
| `POST /api/auth/logout`                 | Signed in + CSRF                | Ends the server session and returns the Entra sign-out URL                                                                                                                         |
| `POST /api/private/ping`                | Signed in + CSRF                | Example of a protected state-changing endpoint                                                                                                                                     |
| `GET /health/live`                      | Public                          | Liveness check for App Service                                                                                                                                                     |
| `GET /api/info`                         | Signed in                       | Factory configuration: allowlists, tiers, defaults, run modes, `isAdmin` (UC-01)                                                                                                   |
| `GET /api/modes/{mode}/check`           | Signed in                       | Whether a run mode is available: `DryRun` always, `Factory` once the GitHub App is configured (UC-01, UC-08)                                                                       |
| `POST /api/requests/preview`            | Signed in + CSRF                | Validates a request; returns names, steps, fingerprint and simulated cost (UC-02)                                                                                                  |
| `POST /api/runs`                        | Signed in + CSRF                | Starts a dry run, or a Factory run with `confirmation` = slug that creates the repository from the template; `202 {runId}`, 409 while the app has a run in progress (UC-03, UC-08) |
| `GET /api/runs/{id}`                    | Signed in                       | Run summary (UC-03)                                                                                                                                                                |
| `GET /api/runs/{id}/events?from=n`      | Signed in                       | Run events as server-sent events from `n`: stored ones, then live ones, then `end` (UC-03)                                                                                         |
| `GET /api/apps`, `GET /api/apps/{slug}` | Signed in                       | Shared app inventory and app detail with runs and the last check (UC-04)                                                                                                           |
| `POST /api/apps/{slug}/check`           | Signed in + CSRF                | Dry-run status check (`{mode: "DryRun"}`); `Live` is refused (UC-05)                                                                                                               |
| `GET`, `POST /api/apps/{slug}/features` | Signed in (+ CSRF for POST)     | Simulated feature board; added requests are kept in memory (UC-06)                                                                                                                 |
| `POST /api/demo`                        | `Factory.Admin` app role + CSRF | Starts a dry run of a sample app; `202 {runId, slug}` (UC-07)                                                                                                                      |
| `GET /build-info.json`                  | Public                          | Commit and run that built the deployed package (static file written by the build; used by the project factory inventory). Absent when running locally                              |

Unknown `/api/*` paths return 404 as problem details, never the React page. Unauthenticated API calls get 401, not a redirect. Failed sign-ins return to `/?login=failed`.

## Adding an endpoint

```csharp
var trips = app.MapGroup("/api/trips").RequireAuthorization();
trips.MapGet("/", (...) => ...);
trips.MapPost("/", (CreateTrip request, ...) => ...).RequireCsrf();
```

- Every private endpoint needs `RequireAuthorization()`; every state-changing endpoint also needs `RequireCsrf()`.
- Validate requests on the server and return `Results.ValidationProblem(...)` or `Results.Problem(...)` for errors.
- Map endpoints before the `MapFallback` lines at the end of `Program.cs`. Once a feature grows, move it to its own file (for example `Features/Trips/TripEndpoints.cs`) as an extension method on `WebApplication`.
- Add integration tests next to the existing ones in `tests/Merlin.Api.Tests/Integration` and update the endpoint table above.

See [AGENTS.md](../AGENTS.md) for the complete workflow.

## Factory API and registry

The factory endpoints (`Features/Factory/`) follow `intent/001-factory-backend/spec.md` and `intent/003-template-repository/spec.md`. Dry runs are computed in the API (the template engine needs PowerShell) and create nothing. Factory runs create the app's GitHub repository from the template repository and report the later steps as skipped (see "Set up the GitHub App"). The `Factory` settings hold the allowlists, billing and the admin role (`Factory:AdminRole`, default `Factory.Admin`; add it as an app role to the Entra app registration and assign it to platform admins). People without the role always get the first tenant, subscription, region and GitHub owner.

The registry (`Data/`) stores apps, runs, run events and checks:

| `Database:Kind` | Registry                                                                                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`          | In memory, lost on restart. Allowed only in the Development and Testing environments; elsewhere the app refuses to start.                                                        |
| `azure-sql`     | Azure SQL through EF Core. `Database:ConnectionString` uses `Authentication=Active Directory Managed Identity` (Azure) or `Active Directory Default` (locally), never a password |

Migrations live in `Data/Migrations` and are named after the use case. The app applies pending migrations at startup whenever `Database:Kind` is `azure-sql`; in Azure its managed identity is the database's Entra administrator (`infrastructure/database.tf`). A failed migration stops startup, so the deploy health check fails and the release stops. Review the SQL of a migration with `dotnet ef migrations script --idempotent --project api/src/Merlin.Api`. Add one with `dotnet ef migrations add <UseCase_Name> --project api/src/Merlin.Api --output-dir Data/Migrations`.

Runs execute in the app process. A restart marks running runs as failed (and the app of an interrupted Factory run as `failed`).

### Set up the GitHub App

Factory runs (UC-08) act as Merlin's own GitHub App (`Factory:GitHub:Auth` = `App`, the default) or with a personal access token (`Token`, see "Use a personal access token" below). In App mode, without `Factory:GitHub:AppId` and `Factory:GitHub:PrivateKey` the `Factory` mode is unavailable ("The GitHub App is not configured."); setting only one of them stops startup.

1. A platform admin registers a GitHub App on the organization in `acme.ghe.com` (no webhook, no callback URL) with the repository permissions **Administration: read and write**, **Contents: read** and **Metadata: read**, and installs it on the allowed owner (`Factory:AllowedOwners`), with access to all repositories (it creates new ones and reads the template).
2. Generate a private key and note the App ID.
3. Locally: `dotnet user-secrets set Factory:GitHub:AppId <id> --project api/src/Merlin.Api` and `dotnet user-secrets set Factory:GitHub:PrivateKey "$(cat key.pem)" --project api/src/Merlin.Api` (piped input must be JSON, so pass the key as the value), then delete the downloaded file.
4. In Azure: `Factory__GitHub__AppId` as an app setting and `Factory__GitHub__PrivateKey` as a Key Vault reference ([infrastructure/README.md](../infrastructure/README.md#enable-factory-runs-in-azure)).

| Setting                             | Default                           | Meaning                                                                                  |
| ----------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------- |
| `Factory:GitHub:Auth`               | `App`                             | `App` (GitHub App) or `Token` (personal access token)                                    |
| `Factory:GitHub:AppId`              | empty                             | Numeric GitHub App ID (App mode)                                                         |
| `Factory:GitHub:PrivateKey`         | empty                             | The App's RSA private key (PEM, App mode). Secret                                        |
| `Factory:GitHub:Token`              | empty                             | Personal access token (Token mode). Secret                                               |
| `Factory:GitHub:TemplateRepository` | `acme-factory/ai-template-dotnet` | Template repository new apps are generated from                                          |
| `Factory:GitHub:ApiUrl`             | empty                             | REST API base; derived from `Factory:GithubHost` (`https://api.acme.ghe.com`) when empty |

### Use a personal access token

With `Factory:GitHub:Auth` = `Token`, Merlin uses `Factory:GitHub:Token` for every call instead of App installation tokens; `AppId` and `PrivateKey` are ignored. Without a token the `Factory` mode is unavailable ("The GitHub token is not configured."). The token belongs to a person, so new repositories show that account as their creator and the token's rights are that account's rights: use a dedicated service account, not a personal one, and give the token an expiry date.

- **Fine-grained token** (preferred): resource owner `acme-factory`, **All repositories** (the collision check must see every repository), repository permissions **Administration: read and write**, **Contents: read**, **Metadata: read**. The organization may have to approve it.
- **Classic token**: scope `repo`; the account must be allowed to create repositories in the organization.

Locally: `dotnet user-secrets set Factory:GitHub:Auth Token --project api/src/Merlin.Api` and `dotnet user-secrets set Factory:GitHub:Token "<token>" --project api/src/Merlin.Api` (paste it from your password manager; it ends up in your shell history otherwise, so prefer `read -rs "token?Token: "` and `"$token"`). In Azure: `github_auth = "token"` in Terraform and the secret `github-token` in Key Vault ([infrastructure/README.md](../infrastructure/README.md#enable-factory-runs-in-azure)).

A Factory run checks the credential (App mode: the App is installed on the owner; Token mode: GitHub accepts the token, `GET /user`) and that the repository does not exist, generates it from the template (private), adds the topic `project-factory` and, for `internal`, changes the visibility. The app's status is `provisioning` during the run, then `requested` (the later steps are not automated yet) or `failed`. A repository that exists stops the run; there is no resume.

## Sessions

- After sign-in, the session (user claims, no OAuth tokens) is encrypted and stored as a file in the `tickets` folder of the state directory. The cookie only contains a random reference to it.
- Cookies are `Secure`, `HttpOnly` and use the `__Host-` prefix. The session cookie is `SameSite=Lax`, the CSRF cookie `SameSite=Strict`.
- Sessions end after eight hours, without sliding renewal. Sign-out deletes the session file and also signs the user out of Entra.
- The state directory also holds the ASP.NET Data Protection keys. Locally it defaults to `%LOCALAPPDATA%\merlin\state` on Windows and `~/.merlin/state` on macOS and Linux; on Azure, Terraform sets the `StateDirectory` setting to `/home/merlin/state`. Deleting the keys signs everyone out.

This design supports **one app instance**. See [operations](../docs/operations/README.md#state-and-scaling) before scaling out.

## Tests

Run `pnpm test:api` from the project root. The tests use xUnit v3 on Microsoft Testing Platform and `WebApplicationFactory`. The factory tests (`FactoryTests`, `RunServiceTests`) are named after the use cases of intent 001 and use the in-memory registry; `testdata/names` holds name vectors from the template engine. The other tests cover public and protected routes, configuration validation, the sign-in redirect (code flow with PKCE and a fixed callback), cookies, CSRF, session expiry and sign-out. They cannot replace a real sign-in test against your tenant.
