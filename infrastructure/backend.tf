# Linux App Service that hosts the ASP.NET Core API and the built SPA (one instance; see docs/operations).
# VNet integration and a private endpoint are left out until self-hosted runners exist (ghrunner.tf),
# because GitHub-hosted runners can only deploy to a publicly reachable app.

resource "azurerm_resource_group" "backend" {
  name     = "rg-backend-${var.project}-${var.environment}-001"
  location = var.location_backend
  tags     = local.common_tags
}

module "app_service_plan" {
  source  = "Azure/avm-res-web-serverfarm/azurerm"
  version = "2.0.8"

  location  = azurerm_resource_group.backend.location
  name      = "asp-${var.project}-${var.environment}-001"
  parent_id = azurerm_resource_group.backend.id
  os_type   = "Linux"
  sku_name  = var.app_service.sku_name

  # Sessions live on the file system, so the app must run on exactly one instance.
  worker_count           = 1
  zone_balancing_enabled = false

  enable_telemetry = false
  tags             = local.common_tags
}

module "web_app" {
  source  = "Azure/avm-res-web-site/azurerm"
  version = "0.24.1"

  location  = azurerm_resource_group.backend.location
  name      = local.web_app_name
  parent_id = azurerm_resource_group.backend.id
  # Lowercase "serverFarms" to match Azure's GET response casing; avoids perpetual azapi diff (AVM issue #281)
  service_plan_resource_id = replace(module.app_service_plan.resource_id, "serverFarms", "serverfarms")

  kind    = "webapp"
  os_type = "Linux"

  https_only                               = true
  public_network_access_enabled            = var.app_service.public_network_access_enabled
  client_affinity_enabled                  = false
  ftp_publish_basic_authentication_enabled = false
  # Deployments sign in with Entra ID (OIDC), never with publishing credentials.
  scm_publish_basic_authentication_enabled = false

  managed_identities = {
    system_assigned = true
  }

  site_config = {
    always_on           = true
    ftps_state          = "Disabled"
    health_check_path   = "/health/live"
    http2_enabled       = true
    minimum_tls_version = "1.2"

    application_stack = {
      dotnet = {
        dotnet_version = "10.0"
      }
    }
  }

  # Outside Development the app refuses to start without Azure SQL (database.tf, api/src/Merlin.Api/Data/DataServices.cs).
  # Sign-in settings are empty until entra_client_id is set, GitHub App settings until github_app_id is set (key-vault.tf).
  app_settings = merge(local.database_settings, local.auth_settings, local.github_app_settings, {
    AllowedHosts                        = "${local.web_app_name}.azurewebsites.net"
    ASPNETCORE_FORWARDEDHEADERS_ENABLED = "true"
    SCM_DO_BUILD_DURING_DEPLOYMENT      = "false"
    # /home is persistent shared storage on Linux App Service; sessions and Data Protection keys live here.
    StateDirectory = "/home/merlin/state"
  })

  enable_telemetry = false
  tags             = local.common_tags
}
