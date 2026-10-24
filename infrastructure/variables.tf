# Merlin — Terraform Variables
#
# Define all input variables here. Values are provided via environment-specific
# .tfvars files (dev.tfvars, prd.tfvars).

variable "environment" {
  description = "Environment name (dev, prd)"
  type        = string
  validation {
    condition     = contains(["dev", "prd"], var.environment)
    error_message = "Environment must be either 'dev' or 'prd'."
  }
}

variable "location" {
  description = "Azure region for all resources"
  type        = string
  default     = "swedencentral"
}

variable "project" {
  description = "Project name (e.g., ai-merlin)"
  type        = string
  default     = "ai-merlin"
}

# -----------------------------------------------------------------------------
# NETWORKING (existing resources)
# -----------------------------------------------------------------------------
variable "vnet_name" {
  description = "Name of the existing VNet"
  type        = string
}

variable "vnet_resource_group_name" {
  description = "Name of the resource group containing the existing VNet"
  type        = string
}

variable "subnet_address_prefixes" {
  description = "Environment-specific address prefixes for the webapp, private endpoint, and GitHub runner subnets."
  type = object({
    webapp            = optional(list(string))
    private_endpoints = optional(list(string))
    runner            = optional(list(string))
  })
}

# -----------------------------------------------------------------------------
# TAGS
# -----------------------------------------------------------------------------
variable "tags" {
  description = "Additional tags to apply to all resources"
  type        = map(string)
  default     = {}
}

# -----------------------------------------------------------------------------
# FRONTEND
# -----------------------------------------------------------------------------
variable "location_swa" {
  type        = string
  description = "The Azure region for the Static Web App."
  nullable    = false
}

variable "frontend_repository_url" {
  type        = string
  description = "The URL of the repository containing the frontend code."
  nullable    = false
}

variable "frontend_repository_branch" {
  type        = string
  description = "The branch of the repository containing the frontend code."
  nullable    = false
}

# -----------------------------------------------------------------------------
# BACKEND
# -----------------------------------------------------------------------------
variable "location_backend" {
  type        = string
  description = "The Azure region for the backend resources."
  nullable    = false
}

variable "app_service" {
  type = object({
    sku_name                      = optional(string, "B1")
    public_network_access_enabled = optional(bool, true)
  })
  default     = {}
  description = <<DESCRIPTION
App Service settings:
- `sku_name`: plan SKU, B1 or larger (always on).
- `public_network_access_enabled`: whether the app is publicly reachable; GitHub-hosted runners need this to deploy.
DESCRIPTION
  nullable    = false
}

# -----------------------------------------------------------------------------
# DATABASE
# -----------------------------------------------------------------------------
variable "database" {
  type        = string
  default     = "azure-sql"
  description = "Registry database: `azure-sql` (serverless, Entra-only, see database.tf) or `none`. Outside Development the app does not start with `none`."
  nullable    = false
  validation {
    condition     = contains(["none", "azure-sql"], var.database)
    error_message = "database must be none or azure-sql."
  }
}

# -----------------------------------------------------------------------------
# SIGN-IN (key-vault.tf)
# -----------------------------------------------------------------------------
variable "entra_client_id" {
  type        = string
  default     = ""
  description = "Client ID of the Entra app registration. Empty leaves sign-in off. Store the client secret in Key Vault before setting it (infrastructure/README.md)."
  nullable    = false
  validation {
    condition     = var.entra_client_id == "" || can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", var.entra_client_id))
    error_message = "entra_client_id must be empty or a GUID."
  }
}

variable "key_vault_secret_officers" {
  type        = list(string)
  default     = []
  description = "Entra object IDs of the people or groups who may set and rotate the client secret (Key Vault Secrets Officer)."
  nullable    = false
}

# -----------------------------------------------------------------------------
# GITHUB ACCESS FOR FACTORY RUNS (key-vault.tf)
# -----------------------------------------------------------------------------
variable "github_auth" {
  type        = string
  default     = "app"
  description = "How Merlin acts in GitHub: app (Merlin's GitHub App, github_app_id) or token (a personal access token in Key Vault as github-token). Store the secret before switching (infrastructure/README.md)."
  nullable    = false
  validation {
    condition     = contains(["app", "token"], var.github_auth)
    error_message = "github_auth must be app or token."
  }
}

variable "github_app_id" {
  type        = string
  default     = ""
  description = "App ID of Merlin's GitHub App, which creates app repositories (UC-08), used when github_auth is app. Empty leaves the Factory run mode off. Store the private key in Key Vault before setting it (infrastructure/README.md)."
  nullable    = false
  validation {
    condition     = var.github_app_id == "" || can(regex("^[1-9][0-9]{0,18}$", var.github_app_id))
    error_message = "github_app_id must be empty or the numeric App ID."
  }
}

# -----------------------------------------------------------------------------
# MONITORING & OBSERVABILITY
# -----------------------------------------------------------------------------
variable "ops_alert_email" {
  type        = string
  description = "Email address for ops team alert notifications."
  default     = ""
}

# -----------------------------------------------------------------------------
# GITHUB RUNNER
# -----------------------------------------------------------------------------
variable "github_business_id" {
  type        = string
  description = "The GitHub Business ID for the organization using the GitHub Runner."
  nullable    = false
}
