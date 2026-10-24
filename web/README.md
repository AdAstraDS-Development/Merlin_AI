# Frontend

React 19 with strict TypeScript 6, built by Vite 8. TanStack Query 5 handles server state; styling is plain CSS. Tests use Vitest 5 and Testing Library. The production build is served by the .NET backend from the same origin.

## Layout

The UI is the Merlin portal from the ai-sw-template factory (`factory/portal/wwwroot`), ported to React with the same markup classes and stylesheet.

| Path                     | Content                                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.tsx`           | Entry point: Query client, error boundary                                                                                           |
| `src/app/app.tsx`        | Shell: top bar, theme toggle, hash routes (`#/`, `#/apps`, `#/app/{slug}`, `#/board/{slug}`, `#/run/{id}`, `#/new`, `#/how`), toast |
| `src/app/*-view.tsx`     | One file per page, with their tests                                                                                                 |
| `src/components/`        | Icons, status badges, the development loop and architecture figures, the error boundary                                             |
| `src/lib/api-client.ts`  | `getJson` and `postJson` for calls to `/api/*`                                                                                      |
| `src/lib/factory-api.ts` | Typed factory client (`/api/info`, `/api/apps`, `/api/runs`, ...) and the TanStack Query keys                                       |
| `src/lib/factory-sim.ts` | In-browser simulation of the factory backend, used until the backend serves those endpoints                                         |
| `src/lib/wizard.ts`      | Draft, derivation and validation rules of the New app wizard                                                                        |
| `src/styles.css`         | Global styles (portal stylesheet); fonts in `public/fonts/` (Geist, SIL OFL)                                                        |
| `src/test/setup.ts`      | Vitest setup                                                                                                                        |

Add a folder per feature (for example `src/features/trips/`) when you build one, and shared components only once two features need them. Use kebab-case file names and explicit types.

### Simulation

The .NET host serves the factory endpoints (see `intent/001-factory-backend/spec.md`). The root `pnpm build` (and so `pnpm start` and `pnpm package:app`) builds the web app with `--mode server`, which calls them. Builds without a backend, such as the Static Web App deployment and plain `pnpm --dir web dev`, run against `src/lib/factory-sim.ts` instead: the example configuration, dry runs with their event stream, simulated costs and checks, and the feature board, with state in `sessionStorage`. Use `pnpm --dir web dev --mode server` to develop against the running backend.

## Calling the API

- Use `getJson<T>(path)` and `postJson<T>(path, body?)` from `src/lib/api-client.ts`. They send the session cookie; there is no token handling in the browser.
- `postJson` first fetches a CSRF token from `/api/auth/csrf` and sends it as `X-CSRF-TOKEN`. If it cannot get a token, the request is not sent.
- Failed requests throw `ApiError` with the HTTP status and the problem details; `describeError` turns one into a sentence. Treat 401 as "session expired" and offer sign-in.
- Sign-in and sign-out are full page navigations (`/api/auth/login`, then the URL returned by `/api/auth/logout`), so no protected data stays in memory.
- The client is deliberately small. Add other HTTP methods, cancellation or handling for empty responses when a feature needs them.

Everything in `VITE_*` environment variables ends up in the public bundle; never put secrets there.

## Develop

From the project root:

```powershell
pnpm start             # build and serve through the .NET host on https://localhost:7243
pnpm --dir web dev     # Vite dev server with hot reload; proxies /api and /health to the running backend
pnpm lint
pnpm typecheck
pnpm test
```

Sign-in only works through the .NET host's HTTPS address, not through the Vite dev server.

When you change the UI, update the [user guide](../docs/user-guide/README.md). Browser end-to-end tests (for example Playwright) are not set up yet; add them together with the first real user journey.
