# Operations

How to check, run and recover `Merlin`. Setup is described in [pipelines](../../.github/workflows/README.md) and [infrastructure](../../infrastructure/README.md).

## Acceptance checklist

Run through this in development before the first production release, and again after changes to sign-in, infrastructure or session handling.

**Without sign-in configured**

- [ ] `/` shows the app name, **API online** and that sign-in is not configured.
- [ ] `/build-info.json` returns the commit and run ID of the deployed package (it contains no secrets). It is public by design: anyone can read the commit SHA and run ID.
- [ ] `/health/live` returns 200. `/api/config` contains only the app name and `loginEnabled`.
- [ ] `/api/me`, `/api/auth/csrf` and `POST /api/private/ping` return 401. `/api/unknown` returns 404, not HTML.
- [ ] `/app` redirects to `/`; `/api/auth/login` returns 503.

**With sign-in configured**

- [ ] Sign-in works and the workspace shows your name. Cancelling sign-in returns to `/`.
- [ ] Browser developer tools show no OAuth tokens in storage; the `__Host-` cookies are `Secure` and `HttpOnly`.
- [ ] A `POST` without a valid `X-CSRF-TOKEN` header returns 400.
- [ ] Sign-out ends the session: the browser's back button does not restore access.
- [ ] After restarting the App Service, an existing session still works.
- [ ] A user who is not allowed by the Entra app registration cannot sign in. Any user the registration accepts can sign in unless **Assignment required** is set on the enterprise application; set it and assign the intended users or groups.

The automated tests and the smoke test in CI cover the routes and the security behavior, but not real Entra sign-in, Azure restarts or Key Vault access. Those need this manual check.

## Rotate the client secret

The Entra client secret expires (its date is set on the Key Vault secret, see [infrastructure](../../infrastructure/README.md#enable-sign-in-in-azure)). Before it does:

1. Create a new client secret in the app registration.
2. Store it as a new version of `entra-client-secret` with `az keyvault secret set` (same command as in the infrastructure guide).
3. Restart the web app. App Service caches Key Vault references for up to 24 hours; a restart picks up the new version immediately. Existing sessions stay valid.
4. Check sign-in, then delete the old client secret in the app registration.

## State and scaling

The app keeps two kinds of state on disk, under the state directory (on Azure `/home/merlin/state`):

- `tickets/`: encrypted sessions. Deleting them signs the affected users out.
- `keys/`: ASP.NET Data Protection keys that encrypt sessions and cookies. Deleting them signs everyone out.

The keys are protected by file permissions and Azure storage encryption, not by Key Vault. Never copy this folder between environments, and never serve it as static content.

The factory registry (apps, runs, run events, checks) lives in Azure SQL when `Database:Kind` is `azure-sql` (provisioned by `infrastructure/database.tf`). The app applies pending migrations at startup, so a failed migration shows up as an app that does not start. Dry runs run inside the app process; a restart marks the runs in progress as failed.

**One instance only.** The file-based session store and the in-process runs work within one process. Before you scale out to several instances or use deployment slots, replace it with a shared store (for example Azure Cache for Redis or a database table) and protect the keys with Key Vault, then add tests for expiry and sign-out across instances.

## When something goes wrong

| Symptom                                   | Check                                                                                                                                                                                                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App does not start                        | App Service log stream: incomplete or invalid `Auth__*` settings stop startup on purpose; also check that the Key Vault reference resolves, the state directory is writable and the database migration succeeded (`Database:Kind is none` means `database` is not `azure-sql` in the tfvars). |
| Deployment fails the health check         | Promotion stops automatically. Look at the commit and the App Service logs before trying again.                                                                                                                                                                                               |
| Sign-in fails                             | Redirect URIs in Entra must match exactly (`/api/auth/callback` and `/`). Check that the client secret has not expired.                                                                                                                                                                       |
| Everyone is signed out after a deployment | The `keys/` folder was lost or replaced.                                                                                                                                                                                                                                                      |

Do not paste cookies, tokens or secrets into tickets or logs.

**Rolling back:** revert the faulty change on `main` and let Release deploy it through development to production. Release packages are kept for 14 days, but there is no workflow to redeploy an older package; an authorized operator can do that manually after checking the commit and checksum.

**Infrastructure:** fix forward with a new reviewed plan. Never apply a plan from another environment or destroy state to recover.

## Before real production use

Add monitoring (Application Insights, alerts with a named owner), decide log retention and privacy rules, name an incident contact, and review networking. When the first use case stores data, add backups, restore tests and controlled database migrations.
