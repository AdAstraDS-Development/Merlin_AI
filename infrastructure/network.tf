# resource "azurerm_subnet" "webapp" {
#   name                              = "snet-webapp-${var.environment}-001"
#   resource_group_name               = data.azurerm_virtual_network.vnet.resource_group_name
#   virtual_network_name              = data.azurerm_virtual_network.vnet.name
#   address_prefixes                  = var.subnet_address_prefixes.webapp
#   default_outbound_access_enabled   = false
#   private_endpoint_network_policies = "RouteTableEnabled"

#   delegation {
#     name = "app-service"
#     service_delegation {
#       name    = "Microsoft.Web/serverFarms"
#       actions = ["Microsoft.Network/virtualNetworks/subnets/action"]
#     }
#   }
# }

# resource "azurerm_subnet" "private-endpoints" {
#   name                              = "snet-peps-${var.environment}-001"
#   resource_group_name               = data.azurerm_virtual_network.vnet.resource_group_name
#   virtual_network_name              = data.azurerm_virtual_network.vnet.name
#   address_prefixes                  = var.subnet_address_prefixes.private_endpoints
#   default_outbound_access_enabled   = false
#   private_endpoint_network_policies = "RouteTableEnabled"
# }

# resource "azurerm_subnet" "runner_subnet" {
#   name                              = "snet-runner-${var.environment}-001"
#   resource_group_name               = data.azurerm_virtual_network.vnet.resource_group_name
#   virtual_network_name              = data.azurerm_virtual_network.vnet.name
#   address_prefixes                  = var.subnet_address_prefixes.runner
#   private_endpoint_network_policies = "RouteTableEnabled"

#   delegation {
#     name = "delegation"

#     service_delegation {
#       name    = "GitHub.Network/networkSettings"
#       actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
#     }
#   }
# }
