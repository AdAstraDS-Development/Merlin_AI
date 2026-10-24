import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api-client';
import { board, names, resetSimulation, simulatedApi } from './factory-sim';
import type { RunEvent } from './factory-types';

beforeEach(() => {
  sessionStorage.clear();
  resetSimulation();
});
afterEach(() => vi.useRealTimers());

describe('simulated factory', () => {
  it('derives resource names like the engine', async () => {
    vi.useFakeTimers();
    const demo = simulatedApi.demo();
    await vi.advanceTimersByTimeAsync(200);
    const { slug } = await demo;
    const app = simulatedApi.app(slug);
    await vi.advanceTimersByTimeAsync(200);
    const detail = await app;
    expect(detail.status).toBe('simulated');
    expect(detail.resources?.azure?.webApps[0].name).toMatch(
      /^app-fleet-portal-dev-[a-z0-9]{4}$/,
    );
    vi.useRealTimers();
    const n = names({
      appName: 'FleetPortal',
      appSlug: 'fleet-portal',
      users: [],
      useCases: [],
      constraints: [],
      documentLinks: [],
      azure: {
        tenantId: 't',
        subscriptionId: 's',
        region: 'westeurope',
        nameSuffix: 'ab12',
        environments: ['development', 'production'],
      },
      github: {
        owner: 'contoso-apps',
        repoName: 'fleet-portal',
        visibility: 'private',
        productionReviewers: ['po'],
      },
      options: {
        protectMain: true,
        runLocalValidation: false,
        database: 'azure-sql',
      },
    });
    expect(n.stateStorage.storageAccount).toBe('stfleetportalab12tf');
    expect(n.resourceGroups.map((g) => g.name)).toEqual([
      'rg-fleet-portal-shared-ab12',
      'rg-fleet-portal-dev-ab12',
      'rg-fleet-portal-prd-ab12',
    ]);
    expect(n.databases).toHaveLength(2);
  });

  it('streams a dry run from plan to result', async () => {
    vi.useFakeTimers();
    const demo = simulatedApi.demo();
    await vi.advanceTimersByTimeAsync(200);
    const { runId } = await demo;
    const events: RunEvent[] = [];
    const done = simulatedApi.streamRun(
      runId,
      (e) => events.push(e),
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await done;
    expect(events[0].type).toBe('plan');
    expect(events.at(-1)).toMatchObject({
      type: 'result',
      status: 'succeeded',
    });
    expect(
      events.filter((e) => e.type === 'step' && e.status === 'succeeded'),
    ).toHaveLength(11);
  });

  it('moves board features through the stages over time', () => {
    const start = board('fleet-portal', Date.now());
    const later = board('fleet-portal', Date.now() + 40_000);
    expect(start.features).toHaveLength(3);
    expect(start.features[0].stage).toBe('spec');
    expect(later.features[0].stage).not.toBe('spec');
  });

  it('refuses live checks of simulated apps', async () => {
    vi.useFakeTimers();
    const demo = simulatedApi.demo();
    await vi.advanceTimersByTimeAsync(200);
    const { slug } = await demo;
    const check = simulatedApi.check(slug, 'Live').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    const error = await check;
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).errors?.mode?.[0]).toMatch(/simulated app/);
  });
});
