import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app';
import { resetSimulation } from '../lib/factory-sim';
import { ApiError } from '../lib/api-client';
import { LoadError } from './load-error';

beforeEach(() => {
  sessionStorage.clear();
  resetSimulation();
});
afterEach(() => {
  cleanup();
  window.location.hash = '';
});

function show(hash = '#/'): void {
  window.location.hash = hash;
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <App />
    </QueryClientProvider>,
  );
}

describe('Merlin', () => {
  it('opens on the create funnel with the simulation offer', async () => {
    show();
    expect(
      await screen.findByRole('heading', { name: 'Create a new app' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Run a simulation/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('0 apps in total')).toBeInTheDocument();
  });

  it('shows an empty app list before any run', async () => {
    show('#/apps');
    expect(await screen.findByText('No apps yet')).toBeInTheDocument();
  });

  it('starts a simulated dry run and opens its progress', async () => {
    show();
    fireEvent.click(
      await screen.findByRole('button', { name: /Run a simulation/ }),
    );
    expect(
      await screen.findByRole('heading', { name: 'FleetPortal', level: 1 }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Dry run')).toBeInTheDocument();
  });

  it('asks for a name before the wizard continues', async () => {
    show('#/new');
    fireEvent.click(await screen.findByRole('button', { name: /Continue/ }));
    expect(await screen.findByText('Give the app a name.')).toBeInTheDocument();
  });

  it('derives the identifier from the app name', async () => {
    show('#/new');
    fireEvent.change(await screen.findByLabelText('What is the app called?'), {
      target: { value: 'Fleet Portal' },
    });
    expect(screen.getByLabelText('Identifier')).toHaveValue('fleet-portal');
  });

  it('UC01 shows sign-in prompt when the factory API returns 401', () => {
    render(<LoadError error={new ApiError(401)} retry={() => undefined} />);
    expect(
      screen.getByRole('heading', { name: 'Sign in to use Merlin' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/api/auth/login',
    );
  });
});
