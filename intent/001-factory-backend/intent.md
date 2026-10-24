# Intent 001: factory backend

Author: Merlin team. Status: draft. Created: 2026-10-22.

## Problem

Merlin's web app (the project factory portal: request a new app, see what will be created and what it costs, watch the run, keep an inventory of apps) runs entirely against an in-browser simulation (`web/src/lib/factory-sim.ts`). Nothing is shared or kept: every person sees only the apps in their own browser tab, a reload in another browser loses them, and nobody is signed in when they make a request. The only working factory backend is the local, single-user portal in `ai-sw-template/factory/portal`, which runs on a developer's machine with a URL token instead of a sign-in and refuses to start in hosted mode.

## Proposed outcome

Merlin serves the factory API itself, behind Entra ID sign-in, so the web app calls the same-origin endpoints it already defines in `web/src/lib/factory-api.ts` instead of the simulation. For this first step everything stays a **dry run**: a signed-in person can fill in a request, get the derived names, steps and simulated cost, start a dry run and watch its events, and later find the app and its runs in a shared inventory, also from another browser. Nothing is created in GitHub or Azure. Observable when: two signed-in people see the same app list, and a dry run started by one is visible to the other after a reload.

## Affected users and systems

- Requesters (any employee with access to Merlin): describe an app, start dry runs, browse the inventory.
- Platform admins: may change where an app runs (tenant, subscription, region, owner, repository options) and start the sample simulation.
- Systems: Merlin API (`api/`), Merlin web app (`web/`), Azure SQL database for the registry, Entra ID app registration (app roles). The factory engine and workflow in `ai-sw-template/factory` are not called in this step.

## Use cases (draft)

- **UC-01** Requester: see the factory configuration (allowlists, tiers, defaults, available run modes) the request form is built from.
- **UC-02** Requester: validate a request and preview the derived names, steps and simulated monthly cost.
- **UC-03** Requester: start a dry run of a request and follow its events live.
- **UC-04** Requester: see the shared inventory of apps and the detail of one app with its runs.
- **UC-05** Requester: run a dry-run status check of an app.
- **UC-06** Requester: see the simulated feature board of an app and add a simulated feature or bug.
- **UC-07** Platform admin: start the sample simulation (a dry run of a sample app) and change where an app runs.

## Constraints

- Backend for frontend: the browser keeps only the session cookie; every factory endpoint needs sign-in, and every state change needs the CSRF token (`AGENTS.md`, `secure-endpoints`).
- Storage: Azure SQL with managed identity, no secrets (`data-access`).
- Single app instance, like the server-side sessions.
- Contract: the request, events and statuses follow `ai-sw-template/factory/PROTOCOL.md` and `web/src/lib/factory-types.ts`.
- Out of scope: `Local` and `Factory` run modes, `Live` status checks, any call to GitHub or Azure, real cost data, a connected feature board (tracker, agents, models), approval workflow, deleting apps.

## Open questions

- Who counts as a platform admin: an Entra app role (proposed `Factory.Admin`) or a configured list? — Product owner.
- Should every signed-in user see every app in the inventory, or only their own? — Product owner.
- How long are apps, runs and run events kept? — Product owner, data protection.
- How is the backend hosted: the Terraform for the App Service and the database is commented out, and the frontend is a separate Static Web App. — Tech lead.

## Source material (optional)

- `ai-sw-template/factory/portal/README.md` and `ai-sw-template/factory/PROTOCOL.md` (local portal and protocol, not copied).
- `web/src/lib/factory-api.ts`, `factory-types.ts`, `factory-sim.ts` in this repository.
