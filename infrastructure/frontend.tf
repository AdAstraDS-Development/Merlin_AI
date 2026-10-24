resource "azurerm_resource_group" "frontend" {
  name     = "rg-frontend-${var.project}-${var.environment}-001"
  location = var.location
}

module "swa-tbm" {
  source                       = "Azure/avm-res-web-staticsite/azurerm"
  version                      = "0.6.2"
  location                     = var.location_swa
  name                         = "swa-${var.project}-${var.environment}-001"
  resource_group_name          = azurerm_resource_group.frontend.name
  enable_telemetry             = false
  preview_environments_enabled = false
  sku_size                     = "Standard"
  sku_tier                     = "Standard"
  repository_url               = var.frontend_repository_url
  branch                       = var.frontend_repository_branch

  public_network_access_enabled           = true
  private_endpoints_manage_dns_zone_group = false
}
