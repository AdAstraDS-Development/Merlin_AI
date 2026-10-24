import { getJson, postJson } from './api-client';
import { simulatedApi } from './factory-sim';
import type {
  AppDetail,
  AppSummary,
  BoardData,
  CheckMode,
  FactoryInfo,
  FactoryRequest,
  NewFeature,
  PreviewResult,
  RunEvent,
  RunMode,
  RunSummary,
} from './factory-types';

export interface FactoryApi {
  info(): Promise<FactoryInfo>;
  apps(): Promise<AppSummary[]>;
  app(slug: string): Promise<AppDetail>;
  check(slug: string, mode: CheckMode): Promise<AppDetail>;
  features(slug: string): Promise<BoardData>;
  addFeature(slug: string, feature: NewFeature): Promise<BoardData>;
  modeCheck(
    mode: RunMode,
  ): Promise<{ available: boolean; reason: string | null }>;
  preview(request: FactoryRequest): Promise<PreviewResult>;
  startRun(body: {
    request: FactoryRequest;
    mode: RunMode;
    confirmation: string;
  }): Promise<{ runId: string }>;
  run(id: string): Promise<RunSummary>;
  /** Delivers the run's events from the first one; resolves after the last. */
  streamRun(
    id: string,
    onEvent: (event: RunEvent) => void,
    signal: AbortSignal,
  ): Promise<void>;
  demo(): Promise<{ runId: string; slug: string }>;
}

const slugPath = (slug: string): string =>
  `/api/apps/${encodeURIComponent(slug)}`;

/** The factory endpoints served by the backend, same origin with the session cookie. */
const serverApi: FactoryApi = {
  info: () => getJson('/api/info'),
  apps: () => getJson('/api/apps'),
  app: (slug) => getJson(slugPath(slug)),
  check: (slug, mode) =>
    postJson(
      `${slugPath(slug)}/check`,
      mode === 'Live' ? { mode, confirm: true } : { mode },
    ),
  features: (slug) => getJson(`${slugPath(slug)}/features`),
  addFeature: (slug, feature) =>
    postJson(`${slugPath(slug)}/features`, feature),
  modeCheck: (mode) => getJson(`/api/modes/${mode}/check`),
  preview: (request) => postJson('/api/requests/preview', request),
  startRun: (body) => postJson('/api/runs', body),
  run: (id) => getJson(`/api/runs/${encodeURIComponent(id)}`),
  streamRun: (id, onEvent, signal) =>
    new Promise<void>((resolve, reject) => {
      const source = new EventSource(
        `/api/runs/${encodeURIComponent(id)}/events?from=0`,
      );
      const close = (): void => {
        source.close();
        resolve();
      };
      // The browser reconnects on its own; give up when it stops (404, 401) or after 6 failures.
      let failures = 0;
      source.onerror = () => {
        if (source.readyState !== EventSource.CLOSED && ++failures <= 6) return;
        source.close();
        reject(new Error('The run events could not be loaded.'));
      };
      source.onmessage = (e: MessageEvent<string>) => {
        try {
          onEvent(JSON.parse(e.data) as RunEvent);
        } catch {
          /* ignore malformed event */
        }
      };
      source.addEventListener('end', close);
      signal.addEventListener('abort', close);
    }),
  demo: () => postJson('/api/demo', {}),
};

/**
 * The .NET host serves the factory endpoints: `pnpm build` and `pnpm start` build with `--mode server`.
 * Builds without a backend, such as the Static Web App and plain `pnpm --dir web dev`, run against the in-browser simulation.
 * VITE_FACTORY_API=server also selects the server.
 */
export const factoryApiMode: 'simulated' | 'server' =
  import.meta.env.MODE === 'server' ||
  import.meta.env.VITE_FACTORY_API === 'server'
    ? 'server'
    : 'simulated';

export const factoryApi: FactoryApi =
  factoryApiMode === 'server' ? serverApi : simulatedApi;

export const queryKeys = {
  info: ['factory', 'info'] as const,
  apps: ['factory', 'apps'] as const,
  app: (slug: string) => ['factory', 'app', slug] as const,
  features: (slug: string) => ['factory', 'features', slug] as const,
  run: (id: string) => ['factory', 'run', id] as const,
};
