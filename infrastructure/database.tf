# Optional registry database (var.database). No passwords or keys: the web app reaches the database with its
# system-assigned managed identity, and SQL authentication is switched off.
# The app settings use the predictable host names: the database resources depend on the web app's identity,
# so referencing their attributes from the web app would be a cycle.
locals {
  sql             = var.database == "azure-sql"
  sql_server_name = "sql-${var.project}-${var.environment}-001"
  sql_database    = "sqldb-${var.project}"
  database_settings = merge(
    { Database__Kind = var.database },
    local.sql ? {
      Database__ConnectionString = "Server=tcp:${local.sql_server_name}.database.windows.net,1433;Database=${local.sql_database};Authentication=Active Directory Managed Identity;Encrypt=True;"
    } : {},
  )
}

# ---------------------------------------------------------------- Azure SQL (serverless, Entra-only)
resource "azurerm_mssql_server" "app" {
  count                         = local.sql ? 1 : 0
  name                          = local.sql_server_name
  resource_group_name           = azurerm_resource_group.backend.name
  location                      = azurerm_resource_group.backend.location
  version                       = "12.0"
  minimum_tls_version           = "1.2"
  public_network_access_enabled = true
  # The web app's identity is the Entra administrator, so it can apply its own migrations at startup.
  # Replace it with an Entra group of the team when people need direct access.
  azuread_administrator {
    login_username              = local.web_app_name
    object_id                   = module.web_app.system_assigned_mi_principal_id
    azuread_authentication_only = true
  }
  tags = local.common_tags
}

# App Service has no fixed outbound address on the basic plan; this rule allows Azure services only.
resource "azurerm_mssql_firewall_rule" "azure_services" {
  count            = local.sql ? 1 : 0
  name             = "AllowAzureServices"
  server_id        = azurerm_mssql_server.app[0].id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

resource "azurerm_mssql_database" "app" {
  count                       = local.sql ? 1 : 0
  name                        = local.sql_database
  server_id                   = azurerm_mssql_server.app[0].id
  sku_name                    = "GP_S_Gen5_1"
  min_capacity                = 0.5
  auto_pause_delay_in_minutes = 60
  max_size_gb                 = 32
  zone_redundant              = false
  storage_account_type        = "Local"
  tags                        = local.common_tags
  # Switching database to "none" must not silently delete data: remove this guard deliberately first.
  lifecycle { prevent_destroy = true }
}
