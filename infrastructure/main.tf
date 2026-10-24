# Merlin — Main Terraform Configuration
#
# This file defines shared locals used across all resource files.
# Resources are provisioned based on environment-specific variables (dev.tfvars, prd.tfvars).
# Uses Azure Verified Modules (AVM) from the Terraform Registry where available.

# -----------------------------------------------------------------------------
# LOCALS
# -----------------------------------------------------------------------------

locals {
  common_tags = merge(var.tags, {
    environment = var.environment
    managed-by  = "terraform"
    project     = var.project
  })

  web_app_name = "app-${var.project}-${var.environment}-001"
}

