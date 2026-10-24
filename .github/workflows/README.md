# Pipelines

| Workflow                                       | Trigger                                 | What it does                                                                                                                                                  |
| ---------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pull request checks** (`ci.yml`)             | Pull request to `main`                  | Runs the app build (below) and checks Terraform formatting and validity                                                                                       |
| **Release** (`release.yml`)                    | Push to `main`; manual                  | Builds and tests once, deploys to development; a manual run with `production` ticked then promotes the same package to production                             |
| **Infrastructure** (`infrastructure.yml`)      | Manual, on `main`                       | Creates a Terraform plan; with `apply` ticked, applies exactly that plan after approval                                                                       |
| `_build.yml`                                   | Called by the others                    | Frozen installs, `pnpm validate`, packaging, a smoke test of the packaged app, upload of `app.zip` and its SHA-256 checksum (kept 14 days)                    |
| **Claude review** (`claude-review.yml`)        | Pull request, optional                  | When `CLAUDE_ENABLED` is `true`: reads the diff against `REVIEW.md`, the intent files and `AGENTS.md`, and posts one advisory comment. Never blocks a merge   |
| `triage` job in `ci.yml`                       | Failed PR checks, optional              | When `CLAUDE_ENABLED` is `true`: reads the end of the failed job logs and posts a three-line diagnosis (flaky or real, likely cause)                          |
| `_deploy.yml`                                  | Called by Release                       | Verifies the checksum, signs in to Azure with OIDC, deploys the zip, checks `/health/live` and the home page                                                  |
| **[DEV] Build and Deploy App** (`app-dev.yml`) | Push to `main` touching the app; manual | `pnpm validate`, packaging with `build-info.json`, a smoke test of the package, upload of `app.zip` and its checksum, then deploys to `app-ai-merlin-dev-001` |
| `_app-deploy.yml`                              | Called by `app-dev.yml`                 | Verifies the checksum, signs in to Azure with OIDC (`ARM_*` secrets of the environment), deploys the zip to the App Service, checks `/health/live` and `/`    |

Release deploys only when the repository variable `DEPLOY_ENABLED` is `true`. Until then it builds and tests, and skips the deployment jobs. Set it once Azure is ready (step 7).

Production always receives the package that was built and tested in the same run and already deployed to development. To roll back, revert the change on `main` and release again.

All actions are pinned to full commit SHAs (with the version in a comment) and updated by Dependabot. Jobs have read-only permissions except the Azure sign-in steps, which get `id-token: write`, and the Claude jobs, which also write pull request comments. No secrets are stored in GitHub: Azure access uses OIDC federation, and all settings below are plain variables.

## One-time setup

Someone with Owner or User Access Administrator rights on the subscription and admin rights on the repository does this once per project. The project factory that generated this repository does all of it automatically except the optional step 8 (state storage, resource groups, identities, environments and variables); follow the steps below only to set it up by hand or to check what exists.

### 1. Protect the repository

Protect `main`: require a pull request, the **Pull request checks** status checks and at least one review; block force pushes. More in [repository settings](../README.md).

### 2. Create Terraform state storage

Create a resource group, a storage account (no public blob access, versioning on) and a blob container for Terraform state. Do not manage these with this project's Terraform. Also create one resource group per environment, named `rg-<app slug>-dev-<suffix>` and `rg-<app slug>-prd-<suffix>`, with the suffix you will put in `name_suffix`. Terraform reads these resource groups and creates everything else inside them, in their region; it does not create them. This lets the identities below be limited to a single resource group. Each environment uses its own state file (`development.tfstate`, `production.tfstate`); use separate containers or accounts if different people may access development and production.

### 3. Register resource providers

Register `Microsoft.Web` in the subscription (and `Microsoft.KeyVault` when you enable sign-in). Terraform does not register providers.

### 4. Create Azure identities

Create three user-assigned managed identities (or app registrations), each with **federated credentials** for GitHub Actions:

| Identity       | Purpose           | Azure roles                                                                                                                                                                   | Federated credential subject                                             |
| -------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Plan           | `terraform plan`  | Reader on the environment's resource group; Storage Blob Data Contributor on the state container                                                                              | `repo:<org>/<repo>:environment:development-plan` and `…:production-plan` |
| Infrastructure | `terraform apply` | Web Plan Contributor and Website Contributor on the environment's resource group (Contributor is a simpler alternative); Storage Blob Data Contributor on the state container | `repo:<org>/<repo>:environment:development` and `…:production`           |
| Deploy         | Deploy the app    | Website Contributor on the web app (or the environment's resource group)                                                                                                      | `repo:<org>/<repo>:environment:development` and `…:production`           |

Terraform also creates a Key Vault for the Entra client secret and assigns Key Vault Secrets User to the web app and Key Vault Secrets Officer to `key_vault_secret_officers` on every apply (see [Enable sign-in in Azure](../../infrastructure/README.md#enable-sign-in-in-azure)). Those assignments need Role Based Access Control Administrator on the backend resource group, limited to those two roles. The factory does not grant it; add it by hand for the Infrastructure identity before the first apply.

For every federated credential, set the audience to `api://AzureADTokenExchange` and the issuer to your GitHub instance's token issuer:

- GitHub Enterprise Cloud with data residency (`<subdomain>.ghe.com`): `https://token.actions.<subdomain>.ghe.com`, for example `https://token.actions.acme.ghe.com`.
- github.com: `https://token.actions.githubusercontent.com`.

Check the exact value at `<issuer>/.well-known/openid-configuration` if your enterprise has customized it. Use separate identities, each scoped to its own resource group, for development and production if your organization requires it.

### 5. Create GitHub environments

Create four environments: `development-plan`, `production-plan`, `development` and `production`. Limit each to the `main` branch. For the optional [Claude review](#8-optional-turn-on-claude-review), also create `claude`, without a branch restriction because it runs on pull request branches. On `production`, add required reviewers and prevent self-review. Approval on `development`/`production` happens after the plan exists, so reviewers approve a concrete plan.

### 6. Set the variables

| Variable                                                                    | Set in                                | Value                                                                       |
| --------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`                                  | All four environments                 | Target tenant and subscription                                              |
| `AZURE_CLIENT_ID`                                                           | `development-plan`, `production-plan` | Client ID of the Plan identity                                              |
| `AZURE_CLIENT_ID`                                                           | `development`, `production`           | Client ID of the Deploy identity                                            |
| `AZURE_INFRA_CLIENT_ID`                                                     | `development`, `production`           | Client ID of the Infrastructure identity                                    |
| `TF_STATE_RESOURCE_GROUP`, `TF_STATE_STORAGE_ACCOUNT`, `TF_STATE_CONTAINER` | All four environments                 | The state storage from step 2                                               |
| `AZURE_WEBAPP_NAME`                                                         | `development`, `production`           | The `app_service_name` Terraform output (set after step 7)                  |
| `AZURE_RESOURCE_GROUP`                                                      | `development`, `production`           | The environment's resource group from step 2 (the factory sets it)          |
| `DEPLOY_ENABLED`                                                            | Repository variable                   | `true` once the infrastructure exists (step 7); the factory sets it for you |
| `CLAUDE_ENABLED`                                                            | Repository variable                   | `true` to turn on Claude review and triage (step 8)                         |
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`               | `claude` environment                  | The identity with Azure AI User on the Foundry resource (step 8)            |
| `FOUNDRY_RESOURCE`, `CLAUDE_MODEL`                                          | `claude` environment                  | Foundry resource name; name of the Claude deployment                        |

### 7. Create the infrastructure and deploy

1. Prepare the `.tfvars` files and run **Infrastructure** as described in the [infrastructure guide](../../infrastructure/README.md#set-up-an-environment). The resource groups from step 2 must exist.
2. Set `AZURE_WEBAPP_NAME` and `AZURE_RESOURCE_GROUP` in each environment and the repository variable `DEPLOY_ENABLED` to `true`.
3. Re-run the latest **Release** run, or push to `main`. Check the development URL.
4. When ready, [enable sign-in](../../api/README.md#enable-sign-in) and test sign-in and sign-out in development before the first production release.

### 8. Optional: turn on Claude review

The **Claude review** workflow and the `triage` job in `ci.yml` call the Claude Code CLI through Microsoft Foundry. They are advisory: findings are comments, never required checks.

1. Deploy a Claude model in a Microsoft Foundry resource and note the resource name and the deployment name.
2. Create a user-assigned managed identity (or app registration) with a federated credential for `repo:<org>/<repo>:environment:claude`, and give it the **Azure AI User** role on the Foundry resource.
3. In the `claude` environment set the variables `AZURE_CLIENT_ID` (that identity), `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `FOUNDRY_RESOURCE` (resource name) and `CLAUDE_MODEL` (deployment name).
4. Set the repository variable `CLAUDE_ENABLED` to `true`.

The jobs use read-only tools, deny reads outside the workspace, sanitize the output before posting it (no HTML, images, foreign links or mentions, capped length), skip draft pull requests and pull requests from forks, and treat pull request content as untrusted data. With no API key set, the CLI authenticates with the signed-in Entra identity.

## Good to know

- Terraform plans and state can contain sensitive values. Plan artifacts are kept for one day; restrict who can read workflow artifacts and the state storage.
- Only approve a plan that comes from the expected commit and is recent.
- Hosted runners can reach the public App Service. With private networking you need self-hosted runners inside that network.
- Never run untrusted pull-request code with Azure access (for example via `pull_request_target`).
- Not included yet: database migrations, automated sign-in tests, a coverage threshold, deployment slots and automatic rollback. Add them when the project needs them.
