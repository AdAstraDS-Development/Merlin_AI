# Infrastructure as Code — Terraform

This directory contains Terraform configurations for provisioning all Azure resources for the Merlin application (dev environment). Resources are deployed using [Azure Verified Modules (AVM)](https://azure.github.io/Azure-Verified-Modules/) from the Terraform Registry.

## Managed Resources

| Resource                      | Module / Resource                                | SKU / Tier             | Notes                                                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Resource Group (Frontend)** | `azurerm_resource_group`                         | —                      | `rg-frontend-${var.environment}-001`                                                                                                                                                                                      |
| **Resource Group (Backend)**  | `azurerm_resource_group`                         | —                      | `rg-backend-${var.environment}-001`                                                                                                                                                                                       |
| **App Service Plan**          | `Azure/avm-res-web-serverfarm/azurerm` v2.0.8    | B1 (Linux)             | One worker: sessions are file-based                                                                                                                                                                                       |
| **App Service (API + SPA)**   | `Azure/avm-res-web-site/azurerm` v0.24.1         | .NET 10                | `app-${var.project}-${var.environment}-001`, public, HTTPS only, system-assigned identity, no basic publishing auth                                                                                                       |
| **SQL Server + Database**     | `azurerm_mssql_server`, `azurerm_mssql_database` | Serverless GP_S_Gen5_1 | `sql-${var.project}-${var.environment}-001` / `sqldb-${var.project}` in the backend group, when `database = "azure-sql"`. Entra-only auth, the web app's identity is the Entra admin                                      |
| **Key Vault**                 | `azurerm_key_vault`, `azurerm_role_assignment`   | Standard               | `kv-${var.project}-${var.environment}-001` in the backend group. RBAC only, purge protection. Holds the Entra client secret and the GitHub App private key or token; the web app's identity is **Key Vault Secrets User** |
| **Static Web App**            | `Azure/avm-res-web-staticsite/azurerm` v0.6.2    | Standard               | React SPA frontend with private endpoint                                                                                                                                                                                  |
| **VNet Subnets**              | `azurerm_subnet`                                 | —                      | Auto-calculated via cidrsubnet()                                                                                                                                                                                          |

## Prerequisites

- [x] **Azure subscription** with Owner or Contributor role
- [x] **Azure CLI** ≥ 2.60 (`az --version`)
- [x] **Terraform** ≥ 1.14 (`terraform --version`)
- [x] **Remote state storage account** already provisioned (see below)
- [x] **Existing networking** — VNet named `vnet` in a separate resource group
- [ ] **Role assignment rights** — the Terraform identity (`ARM_CLIENT_ID`) needs **Role Based Access Control Administrator** on the backend resource group to grant the Key Vault roles (`key-vault.tf`). A subscription Owner grants it once; constrain it to the roles **Key Vault Secrets User** and **Key Vault Secrets Officer** where your policy allows.

### Required Existing Resources

Before running Terraform, the VNet must already exist in your subscription:

| Resource          | Purpose                                                         | How to find the ID                                                                                       |
| ----------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **VNet (`vnet`)** | Hosts subnets for private endpoints and App Service integration | Terraform reads it via `data "azurerm_virtual_network"` using `vnet_name` and `vnet_resource_group_name` |

**Subnets** are automatically created by Terraform inside the existing VNet using `cidrsubnet()` function to calculate address prefixes.

Update `vnet_name` and `vnet_resource_group_name` in `environments/dev.tfvars` before applying.

## Remote State Backend

State is stored in Azure Storage Account `<state_storage_account>` (resource group `<state_resource_group>`).

**First-time backend setup** (if the storage account doesn't exist yet):

```bash
az group create --name <state_resource_group> --location swedencentral
az storage account create --name <state_storage_account> --resource-group <state_resource_group> --sku Standard_LRS --location swedencentral
az storage container create --name terraform-state --account-name <state_storage_account>
```

## Provisioning Steps

### 1. Authenticate

```bash
az login
az account set --subscription <subscription_id>
```

### 2. Update VNet Configuration

Edit `environments/dev.tfvars` and set:

- `vnet_name` — name of the existing VNet
- `vnet_resource_group_name` — resource group containing the VNet
- `frontend_repository_url` — Git repository URL for Static Web App
- `frontend_repository_branch` — branch to deploy

### 3. Initialize Terraform

```bash
cd infrastructure
terraform init \
  -backend-config="resource_group_name=<state_resource_group>" \
  -backend-config="storage_account_name=<state_storage_account>" \
  -backend-config="container_name=terraform-state" \
  -backend-config="key=terraform.tfstate" \
  -backend-config="subscription_id=<subscription_id>"
```

### 4. Plan

```bash
terraform plan -var-file=environments/dev.tfvars -out=tf.plan
```

### 5. Apply

```bash
terraform apply tf.plan
```

### 6. Verify Resources

```bash
az sql server show -n sql-ai-merlin-dev-001 -g rg-backend-ai-merlin-dev-001 --query fullyQualifiedDomainName -o tsv
az staticwebapp show -n swa-ai-merlin-dev-001 -g rg-frontend-ai-merlin-dev-001 --query defaultHostname -o tsv
```

### 7. Database migrations

There is no manual step. With `database = "azure-sql"` the web app's managed identity is the Entra administrator of the SQL server, and the app applies pending EF Core migrations at startup (see [api/README.md](../api/README.md#factory-api-and-registry)). The database has `prevent_destroy`; switching `database` back to `none` fails the plan on purpose.

### 8. Destroy (when needed)

```bash
terraform destroy -var-file=environments/dev.tfvars
```

## Enable sign-in in Azure

The app signs users in with Entra ID once four `Auth__*` settings are present (see [api/README.md](../api/README.md#enable-sign-in)). Terraform writes them when `entra_client_id` is set; until then sign-in stays off and `/api/auth/login` returns 503. The client secret never passes through Terraform or GitHub: a person stores it in Key Vault and the app reads it through a Key Vault reference.

1. **Create the vault.** Apply Terraform with `entra_client_id = ""` and your object ID (or your team's group) in `key_vault_secret_officers`. Note the outputs:

   ```bash
   terraform output -raw entra_redirect_uri; echo
   terraform output -raw entra_sign_out_uri; echo
   terraform output -raw key_vault_name; echo
   ```

2. **Prepare the app registration** (the same one as for local development, or one per environment):
   - Add both output URIs as **Web** redirect URIs, next to the localhost ones.
   - Add the app role `Factory.Admin` (allowed member types: users/groups) and assign it to platform admins under **Enterprise applications → Users and groups**.
   - Optional: set **Assignment required** on the enterprise application so that only assigned users can sign in.

3. **Store the client secret.** Create a client secret in the app registration and note its expiry date. Store it without it ending up in your shell history:

   ```bash
   read -rs "secret?Client secret: "; printf %s "$secret" | az keyvault secret set --vault-name <key_vault_name> --name entra-client-secret --file /dev/stdin --expires <expiry, e.g. 2027-10-22T00:00:00Z> --output none; unset secret
   ```

   (In bash: `read -rsp "Client secret: " secret`.) This needs **Key Vault Secrets Officer**, which `key_vault_secret_officers` grants.

4. **Switch sign-in on.** Set `entra_client_id` in `environments/<env>.tfvars` (the client ID is not a secret) and merge; the pipeline applies it. Set it only after step 3, otherwise the reference does not resolve and sign-in fails.

5. **Check.** In the portal, the web app's **Environment variables** show `Auth__ClientSecret` with a green Key Vault reference. Select **Sign in** on the deployed app, then run the [acceptance checklist](../docs/operations/README.md#acceptance-checklist).

To rotate the secret, see [operations](../docs/operations/README.md#rotate-the-client-secret).

## Enable Factory runs in Azure

Factory runs (UC-08) create app repositories as Merlin's own GitHub App or, with `github_auth = "token"`, with a personal access token. The private key and the token never pass through Terraform or GitHub: a person stores them in Key Vault and the app reads them through Key Vault references.

| `github_auth`   | App settings Terraform writes                                                                                     | Secret in Key Vault      |
| --------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `app` (default) | `Factory__GitHub__Auth=App`, `Factory__GitHub__AppId`, `Factory__GitHub__PrivateKey`, when `github_app_id` is set | `github-app-private-key` |
| `token`         | `Factory__GitHub__Auth=Token`, `Factory__GitHub__Token`                                                           | `github-token`           |

### With the GitHub App

1. **Register and install the GitHub App** as described in [api/README.md](../api/README.md#set-up-the-github-app): permissions, installation on the owner and the App ID. Generate a private key; GitHub downloads it as a `.pem` file.
2. **Store the private key** in the vault (`terraform output -raw key_vault_name`), then delete the downloaded file:

   ```bash
   az keyvault secret set --vault-name <key_vault_name> --name github-app-private-key --file <app>.private-key.pem --content-type application/x-pem-file --output none
   ```

   This needs **Key Vault Secrets Officer** (`key_vault_secret_officers`).

3. **Switch Factory runs on.** Set `github_app_id` in `environments/<env>.tfvars` (the App ID is not a secret) and merge; the pipeline applies it. Set it only after step 2: a reference that does not resolve leaves the key empty, and the app refuses to start with only one of the two settings.
4. **Check.** In the portal, the web app's **Environment variables** show `Factory__GitHub__PrivateKey` with a green Key Vault reference. In Merlin, **Through the factory** is selectable on the review step.

To rotate the key, generate a new one in the GitHub App, store it as a new version of `github-app-private-key`, restart the web app (App Service caches Key Vault references for up to 24 hours), then delete the old key in the GitHub App.

### With a personal access token

1. **Create the token** for a service account, as described in [api/README.md](../api/README.md#use-a-personal-access-token), with an expiry date.
2. **Store it** without it ending up in your shell history:

   ```bash
   read -rs "token?GitHub token: "; printf %s "$token" | az keyvault secret set --vault-name <key_vault_name> --name github-token --file /dev/stdin --expires <token expiry, e.g. 2027-04-22T00:00:00Z> --output none; unset token
   ```

3. **Switch to the token.** Set `github_auth = "token"` in `environments/<env>.tfvars` and merge. `github_app_id` may stay; it is ignored. Switching back is `github_auth = "app"`.
4. **Check** as above, with `Factory__GitHub__Token`. A run that fails with "GitHub rejected Merlin's token" means the token expired, was revoked or the reference does not resolve.

To rotate the token, store the new one as a new version of `github-token`, restart the web app, then revoke the old token.

## CI/CD

Infrastructure changes are automated via `.github/workflows/infrastructure.yml`:

- **Pull requests / feature branches**: `terraform plan` (no apply)
- **Merge to main**: `terraform plan` + `terraform apply` (auto-apply if changes detected)

Authentication uses Workload Identity Federation (OIDC) — no secrets stored in GitHub.

The app is deployed to the App Service by `.github/workflows/app-dev.yml` (see [pipelines](../.github/workflows/README.md)). The deploy identity (`ARM_CLIENT_ID` in the `development` environment) needs **Website Contributor** on the web app or its resource group. Outside Development the app does not start without Azure SQL, so `database` is `azure-sql` in both environments; `database.tf` sets `Database__Kind` and a managed-identity connection string (no password) on the web app. The Terraform identity needs rights to create the SQL server in the backend resource group. The app is public because GitHub-hosted runners deploy it; set `app_service.public_network_access_enabled = false` only together with VNet integration, a private endpoint and self-hosted runners (`network.tf`, `ghrunner.tf`).

## File Structure

```
infrastructure/
├── README.md              # This file
├── terraform.tf           # Terraform and provider configuration
├── data.tf                # Data sources (client config, VNet, Entra ID user)
├── main.tf                # Shared locals (common_tags)
├── variables.tf           # Input variable definitions
├── output.tf              # App Service name, resource group and URL, sign-in redirect URIs, Key Vault name
├── backend.tf             # App Service plan and web app (API + SPA)
├── database.tf            # Azure SQL server + serverless database (var.database)
├── key-vault.tf           # Key Vault for the Entra client secret and GitHub key or token, sign-in and GitHub settings
├── frontend.tf            # Static Web App
├── network.tf             # VNet subnets (webapp, sql, private-endpoints)
└── environments/
    ├── dev.tfvars         # Development environment config
    └── prd.tfvars         # Production environment config (future)
```

## Security

- **SQL Server**: Entra ID authentication only (no SQL logins or passwords). Public endpoint restricted by the `AllowAzureServices` firewall rule, because the web app has no VNet integration or fixed outbound address yet; move to a private endpoint together with VNet integration (`network.tf`).
- **Key Vault**: RBAC only (no access policies), purge protection and 90-day soft delete. Terraform never writes secret values, so neither the Entra client secret nor the GitHub App private key or token is in the state. Public endpoint for the same reason as the SQL server; move it to a private endpoint together with VNet integration.
- **Static Web App**: Private endpoint configured for Standard tier
- **State file**: Stored remotely in Azure Storage — never committed to git

## Troubleshooting

| Problem                                          | Solution                                                                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `terraform init` fails                           | Verify storage account `<state_storage_account>` exists and you have Storage Blob Data Contributor                                                                                          |
| SQL connection timeout                           | The serverless database resumes after an idle pause; the app waits up to 60 s and retries. Check the `AllowAzureServices` firewall rule                                                     |
| State lock error                                 | `terraform force-unlock <lock-id>`                                                                                                                                                          |
| Role assignment fails with `AuthorizationFailed` | The Terraform identity lacks **Role Based Access Control Administrator** on the backend group (see Prerequisites)                                                                           |
| Key Vault name already in use                    | A deleted vault with that name is still soft-deleted: `az keyvault recover --name <name>`, or wait out the retention period                                                                 |
| Sign-in fails after setting `entra_client_id`    | `Auth__ClientSecret` shows a red Key Vault reference: the secret `entra-client-secret` is missing or the role assignment has not propagated yet. Store the secret, then restart the web app |
| App does not start after setting `github_app_id` | `Factory__GitHub__PrivateKey` shows a red Key Vault reference (secret `github-app-private-key` missing), or the secret is not the App's PEM key. Store it, then restart the web app         |

---

**Last Updated**: March 2026
**Terraform Version**: >= 1.14
**Azure Provider Version**: ~> 4.0
**AzureAD Provider Version**: ~> 3.0
**AVM Modules**: SQL Server 0.1.6, Static Site 0.6.2, Web Site 0.24.1, Server Farm 2.0.8
