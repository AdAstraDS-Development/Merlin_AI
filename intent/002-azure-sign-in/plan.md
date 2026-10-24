# Plan 002: Sign-in in Azure

Status: agreed 2026-10-22 (RBAC, see risks). Infrastructure-only change with no new use case, so there is no `intent.md` or `spec.md`; the behaviour it enables is the existing sign-in (`api/README.md`, "Enable sign-in").

## Problem

The API signs users in once the four `Auth` settings are present (`Program.cs`). Locally they come from user secrets. In Azure nothing sets them: `infrastructure/backend.tf` has no `Auth__*` app settings, there is no Key Vault, and `api/README.md` links to an "Enable sign-in in Azure" section that does not exist. The deployed app therefore runs with sign-in switched off (`/api/auth/login` returns 503, the workspace is unusable).

## Approach

- **App registration stays manual.** A person creates the Entra app registration (Web, single tenant) and the client secret, as for local development. Terraform takes only the client ID as a variable. Managing the registration with the `azuread` provider would need Microsoft Graph permissions (`Application.ReadWrite.OwnedBy`) for the CI identity and would put the client secret in the Terraform state; both are worse than one manual step.
- **Client secret lives only in Key Vault.** Terraform creates the vault and the access, never the secret value, so the secret is not in the state or in GitHub. A person sets it once with `az keyvault secret set`. The web app reads it through an App Service Key Vault reference, `@Microsoft.KeyVault(VaultName=…;SecretName=entra-client-secret)`, using its system-assigned managed identity.
- **Predictable names, no cycle.** As in `database.tf`, the app setting is built from the vault's name, not its resource attributes, because the vault's role assignment depends on the web app's identity.
- **Sign-in is opt-in per environment.** With `entra_client_id = ""` (the default) no `Auth__*` settings are written and the app behaves as today. With a client ID, all four are written together, so the app's "all or nothing" check (`Program.cs`) holds.
- **Plain `azurerm` resources**, no new AVM module, to avoid adding a dependency (as `database.tf` does).

## Files that change

| File                                     | Change                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `infrastructure/key-vault.tf`            | New. `azurerm_key_vault` `kv-${project}-${environment}-001` in the backend resource group: RBAC authorization, purge protection, 90-day soft delete, public network access (the app has no VNet integration yet). Role assignment **Key Vault Secrets User** for the web app's identity. Locals for `Auth__*`.                                    |
| `infrastructure/variables.tf`            | `entra_client_id` (string, default `""`, validated as empty or GUID). `key_vault_secret_officers` (list of Entra object IDs, default `[]`): people or groups who get **Key Vault Secrets Officer** to set and rotate the secret.                                                                                                                  |
| `infrastructure/backend.tf`              | Merge the `Auth__*` locals into `app_settings`: `Auth__TenantId` from `data.azurerm_client_config.this.tenant_id`, `Auth__ClientId`, `Auth__ClientSecret` as the Key Vault reference, `Auth__PublicOrigin` `https://<app>.azurewebsites.net`. Set `key_vault_reference_identity_id` only if the module needs it (system identity is the default). |
| `infrastructure/output.tf`               | Add `entra_redirect_uri` (`…/api/auth/callback`), `entra_sign_out_uri` (`…/`) and `key_vault_name`.                                                                                                                                                                                                                                               |
| `infrastructure/environments/dev.tfvars` | `entra_client_id = ""` and `key_vault_secret_officers = []` with a comment; filled in once the registration exists (the client ID is not a secret).                                                                                                                                                                                               |
| `infrastructure/README.md`               | New section **Enable sign-in in Azure** (steps below), Key Vault row in "Managed resources", Key Vault in "Security", troubleshooting rows, file structure.                                                                                                                                                                                       |
| `api/README.md`                          | Fix the redirect URI sentence to name the new outputs; keep the link to the new section.                                                                                                                                                                                                                                                          |
| `docs/operations/README.md`              | Secret rotation: add a new version in Key Vault, then restart the app (App Service caches Key Vault references for up to 24 hours).                                                                                                                                                                                                               |

Not changed: `Program.cs` and the rest of the API, workflows, `prd.tfvars` (see risks).

## README section: Enable sign-in in Azure (outline)

1. Apply Terraform once with `entra_client_id = ""`; it creates the Key Vault. Note the outputs `entra_redirect_uri`, `entra_sign_out_uri` and `key_vault_name`.
2. In the app registration, add both URIs (next to the localhost ones), and add the app role `Factory.Admin` and assign it to platform admins. Optionally set **Assignment required** on the enterprise application.
3. Create a client secret and store it: `az keyvault secret set --vault-name <key_vault_name> --name entra-client-secret --file <(…)` (read from a prompt so it is not in shell history). Requires **Key Vault Secrets Officer** (`key_vault_secret_officers`).
4. Set `entra_client_id` in `environments/dev.tfvars`, merge; the pipeline applies it.
5. Check: **Sign in** on the deployed app works; in the portal the `Auth__ClientSecret` setting shows a green Key Vault reference.

## Order of work

1. Terraform: variables, `key-vault.tf`, app settings, outputs. Run `terraform fmt -check` and `terraform validate` (`init -backend=false`) locally.
2. Docs: infrastructure README section, `api/README.md`, operations runbook.
3. `pnpm validate` (formatting of the Markdown files; it does not cover Terraform). Commit as `feat(infra): sign in with Entra ID in Azure`. Pull request with the `terraform plan` from CI.

## How it is proven

There are no acceptance criteria with use-case IDs. Proof:

- `terraform validate` and the CI `terraform plan` show the vault, the web app's role assignment (plus one per entry in `key_vault_secret_officers`) and no `Auth__*` settings while `entra_client_id` is empty.
- With a client ID in a local plan, the plan shows all four `Auth__*` settings and no secret value anywhere in the plan output.
- Manual check after apply (operations checklist): sign-in and sign-out in dev, a user without the role does not see **Simulate**, a user with `Factory.Admin` does. Not automatable in CI.

## Risks and open questions

| Risk / question                                                                                                                                                                                                                  | Proposal                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Role assignments need more rights.** The Terraform identity must be allowed to create role assignments (Owner, User Access Administrator, or RBAC Administrator scoped to the backend group). Today it only needs Contributor. | Decided 2026-10-22: RBAC. A subscription Owner grants the Terraform identity **Role Based Access Control Administrator** on the backend resource group, ideally constrained to the two Key Vault roles. Manual prerequisite, documented in the infrastructure README. |
| Client ID set before the secret exists: the reference does not resolve, the app starts with the literal reference as secret and sign-in fails at the token exchange.                                                             | Order in the README (secret first, then client ID); troubleshooting row.                                                                                                                                                                                              |
| Key Vault names are global and soft-deleted vaults block reuse for 90 days.                                                                                                                                                      | Fixed name per environment; note `az keyvault recover` in troubleshooting.                                                                                                                                                                                            |
| Secret expiry silently breaks sign-in.                                                                                                                                                                                           | Rotation runbook; expiry date of the secret noted in the README step. Alerting is out of scope.                                                                                                                                                                       |
| `prd.tfvars` already sets variables that do not exist (`communication_data_location`, `ai_capacity`, `ai_foundry_project_managers`), so a prd plan fails today.                                                                  | Out of scope; separate fix.                                                                                                                                                                                                                                           |
| Public Key Vault endpoint.                                                                                                                                                                                                       | RBAC only, no access keys; move to a private endpoint together with VNet integration (`network.tf`), like the SQL server.                                                                                                                                             |

## Departures from the plan

- The secret is piped into `az keyvault secret set --file /dev/stdin` instead of a process substitution; same effect, works in zsh and bash.
- `.github/workflows/README.md` also changed: its note on the Infrastructure identity's roles contradicted the vault being created on every apply and the Secrets Officer assignment.
