# Intent 003: create the app repository from the template

Author: Merlin team. Status: draft. Created: 2026-10-22.

## Problem

Merlin only runs dry runs (intent 001): a requester sees what would be created, but nothing is. The first real thing every new app needs is its GitHub repository, started from the platform's template. Today a platform engineer creates it by hand (or runs the template's PowerShell engine locally with their own `gh` sign-in), so requests wait and repositories drift from the template.

## Proposed outcome

A signed-in requester can start a **Factory** run. Merlin creates the app's repository in the allowed GitHub organization from the template repository `acme-factory/ai-template-dotnet` ("Use this template", `POST /repos/{template}/generate`), with Merlin's own GitHub App, and reports it in the run. The later steps (Azure resources, GitHub environments, workflows) are reported as not automated yet. Observable when: after a Factory run for `fleet-portal`, `https://acme.ghe.com/acme-factory/fleet-portal` exists with the template's files and the topic `project-factory`, and the app in the inventory links to it.

## Affected users and systems

- Requesters: start a Factory run instead of only a dry run.
- Platform admins: install and own the GitHub App; may still place apps outside the defaults (intent 001 admin lock).
- Systems: Merlin API and web app; GitHub Enterprise Cloud `acme.ghe.com` (organization `acme-factory`, template `ai-template-dotnet`); a new GitHub App; Key Vault for its private key.

## Use cases (draft)

- **UC-08** Requester: start a Factory run that creates the app's repository from the template and follow it.

## Constraints

- Backend for frontend and `secure-endpoints`: the GitHub App's key and tokens stay on the server, never reach the browser, the run events or the logs.
- GitHub App, not a personal token: short-lived installation tokens, rights limited to the installed organization.
- Factory only creates: an existing repository stops the run (PROTOCOL.md collision rule); no overwrite, no delete.
- No new NuGet or npm dependencies (JWT signed with `System.Security.Cryptography`).
- Out of scope: `intent/001-initial` and `.tfvars` in the new repository, Azure steps, GitHub environments and branch protection, the approval workflow, `-Resume`, `Local` mode.

## Open questions

- Which app status does an app have after a successful Factory run whose later steps are not automated yet? — Product owner.
- Should any signed-in user be able to create repositories, or is an approval needed before this goes beyond development? — Product owner, security.
- Who registers and installs the GitHub App on `acme-factory`, and with which permissions? — Platform admins.
