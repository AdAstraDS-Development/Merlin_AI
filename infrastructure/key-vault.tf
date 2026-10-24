# Entra ID sign-in (api/README.md, "Enable sign-in") and Merlin's GitHub access (api/README.md, "Set up the GitHub App"
# and "Use a personal access token"). The app registration, the GitHub App or token and their secrets are created by hand;
# Terraform never sees a secret.
# A person stores each secret in this vault and the web app reads it through a Key Vault reference with its
# system-assigned managed identity.
# The app settings use the vault's predictable name: the role assignment depends on the web app's identity,
# so referencing the vault's attributes from the web app would be a cycle.
locals {
  key_vault_name    = "kv-${var.project}-${var.environment}-001"
  entra_secret_name = "entra-client-secret"
  public_origin     = "https://${local.web_app_name}.azurewebsites.net"
  sign_in_enabled   = var.entra_client_id != ""
  # All four or none: the app refuses to start with a partial Auth configuration (api/src/Merlin.Api/Program.cs).
  auth_settings = local.sign_in_enabled ? {
    Auth__TenantId     = data.azurerm_client_config.this.tenant_id
    Auth__ClientId     = var.entra_client_id
    Auth__ClientSecret = "@Microsoft.KeyVault(VaultName=${local.key_vault_name};SecretName=${local.entra_secret_name})"
    Auth__PublicOrigin = local.public_origin
  } : {}

  github_app_key_name = "github-app-private-key"
  github_token_name   = "github-token"
  # github_auth chooses the credential (api/src/Merlin.Api/Features/Factory/GitHubOptions.cs). App: App ID and key, both or none
  # (the app refuses to start with only one). Token: a personal access token. Without them the Factory run mode stays unavailable (UC-08).
  github_app_settings = var.github_auth == "token" ? {
    Factory__GitHub__Auth  = "Token"
    Factory__GitHub__Token = "@Microsoft.KeyVault(VaultName=${local.key_vault_name};SecretName=${local.github_token_name})"
    } : var.github_app_id != "" ? {
    Factory__GitHub__Auth       = "App"
    Factory__GitHub__AppId      = var.github_app_id
    Factory__GitHub__PrivateKey = "@Microsoft.KeyVault(VaultName=${local.key_vault_name};SecretName=${local.github_app_key_name})"
  } : {}
}

# ---------------------------------------------------------------- Key Vault (RBAC only)
# Public endpoint because the web app has no VNet integration yet; move to a private endpoint with it (network.tf).
resource "azurerm_key_vault" "app" {
  name                          = local.key_vault_name
  resource_group_name           = azurerm_resource_group.backend.name
  location                      = azurerm_resource_group.backend.location
  tenant_id                     = data.azurerm_client_config.this.tenant_id
  sku_name                      = "standard"
  rbac_authorization_enabled    = true
  purge_protection_enabled      = true
  soft_delete_retention_days    = 90
  public_network_access_enabled = true
  tags                          = local.common_tags
}

# Creating these needs Role Based Access Control Administrator for the Terraform identity (infrastructure/README.md).
resource "azurerm_role_assignment" "web_app_secrets_user" {
  scope                = azurerm_key_vault.app.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = module.web_app.system_assigned_mi_principal_id
  principal_type       = "ServicePrincipal"
}

resource "azurerm_role_assignment" "secret_officers" {
  for_each             = toset(var.key_vault_secret_officers)
  scope                = azurerm_key_vault.app.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = each.value
}
