output "app_service_name" {
  description = "Name of the web app; the deploy workflow targets it."
  value       = module.web_app.name
}

output "app_service_resource_group" {
  description = "Resource group of the web app."
  value       = azurerm_resource_group.backend.name
}

output "app_service_url" {
  description = "Public URL of the web app."
  value       = "https://${module.web_app.resource_uri}"
}

output "entra_redirect_uri" {
  description = "Redirect URI (sign-in) to add to the Entra app registration."
  value       = "${local.public_origin}/api/auth/callback"
}

output "entra_sign_out_uri" {
  description = "Redirect URI where users return after signing out; add it to the Entra app registration."
  value       = "${local.public_origin}/"
}

output "key_vault_name" {
  description = "Key Vault that holds the Entra client secret (entra-client-secret) and the GitHub App private key (github-app-private-key) or GitHub token (github-token)."
  value       = azurerm_key_vault.app.name
}

# Re-enable together with azapi_resource.github_network_settings in ghrunner.tf.
# output "github_id" {
#   value = azapi_resource.github_network_settings.output.tags.GitHubId
# }
