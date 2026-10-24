import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReviewPane } from './new-app-view';
import { factoryApi } from '../lib/factory-api';
import { simulatedApi } from '../lib/factory-sim';
import { blankDraft, EXAMPLE, requestBody } from '../lib/wizard';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function showReview(): Promise<{
  startRun: ReturnType<typeof vi.spyOn>;
}> {
  const base = await simulatedApi.info();
  // The server reports Factory available once Merlin's GitHub App is configured.
  const info = {
    ...base,
    modes: base.modes.map((m) =>
      m.id === 'Factory' ? { ...m, available: true, reason: null } : m,
    ),
  };
  const draft = {
    ...blankDraft(info),
    text: EXAMPLE.text,
    appName: 'FleetPortal',
    slug: 'fleet-portal',
    repo: 'fleet-portal',
    problem: EXAMPLE.problem,
    users: EXAMPLE.users,
  };
  const preview = await simulatedApi.preview(requestBody(draft, info));
  vi.spyOn(factoryApi, 'modeCheck').mockResolvedValue({
    available: true,
    reason: null,
  });
  const startRun = vi
    .spyOn(factoryApi, 'startRun')
    .mockResolvedValue({ runId: 'run-1' });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewPane
        draft={draft}
        info={info}
        preview={preview}
        nav={(start) => <div>{start}</div>}
        onStarted={() => undefined}
      />
    </QueryClientProvider>,
  );
  return { startRun };
}

describe('Review step', () => {
  it('UC08 Factory run needs the typed slug and posts mode Factory', async () => {
    const { startRun } = await showReview();
    fireEvent.click(screen.getByRole('radio', { name: /Through the factory/ }));
    const button = await screen.findByRole('button', {
      name: /Create repository/,
    });
    expect(button).toBeDisabled();
    expect(
      screen.getByText(
        /creates the repository \S+\/fleet-portal from the template/,
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Type fleet-portal to confirm'), {
      target: { value: 'fleet-portal' },
    });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    await vi.waitFor(() => expect(startRun).toHaveBeenCalledOnce());
    expect(startRun.mock.calls[0]?.[0]).toMatchObject({
      mode: 'Factory',
      confirmation: 'fleet-portal',
    });
  });
});
