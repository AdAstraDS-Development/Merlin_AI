# Development Environment Configuration
#
# This file contains variable values for the development environment.
# Resources are optimized for cost and experimentation.

environment = "dev"
location    = "swedencentral"

# -----------------------------------------------------------------------------
# NETWORKING (existing resources)
# -----------------------------------------------------------------------------

vnet_name                = "vnet"
vnet_resource_group_name = "rg-spoke-dev"
subnet_address_prefixes = {
  webapp            = ["10.10.1.0/29"]
  private_endpoints = ["10.10.1.8/29"]
  runner            = ["10.10.1.16/28"]
}

# -----------------------------------------------------------------------------
# TAGS
# -----------------------------------------------------------------------------
tags = {
  owner = "ai-merlin-team"
}

# -----------------------------------------------------------------------------
# FRONTEND
# -----------------------------------------------------------------------------
location_swa               = "westeurope"
frontend_repository_url    = "https://acme.ghe.com/acme-factory/ai-merlin"
frontend_repository_branch = "main"

# -----------------------------------------------------------------------------
# BACKEND
# -----------------------------------------------------------------------------
location_backend = "westeurope"

# -----------------------------------------------------------------------------
# DATABASE
# -----------------------------------------------------------------------------
database = "azure-sql"

# -----------------------------------------------------------------------------
# SIGN-IN (see README, "Enable sign-in in Azure")
# -----------------------------------------------------------------------------
# Client ID of the Entra app registration (not a secret). Set it only after the client secret is in Key Vault.
entra_client_id = ""
# Object IDs of the people or groups who store and rotate the client secret.
key_vault_secret_officers = []

# -----------------------------------------------------------------------------
# GITHUB ACCESS FOR FACTORY RUNS (see README, "Enable Factory runs in Azure")
# -----------------------------------------------------------------------------
# app: Merlin's GitHub App (github_app_id below). token: a personal access token stored in Key Vault as github-token.
github_auth = "token"
# App ID of Merlin's GitHub App (not a secret). Set it only after the private key is in Key Vault.
github_app_id = ""

# -----------------------------------------------------------------------------
# GITHUB RUNNER
# -----------------------------------------------------------------------------
github_business_id = ""
