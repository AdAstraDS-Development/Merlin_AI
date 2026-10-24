import type { JSX } from 'react';
import { Icon } from '../components/icon';
import { StatePanel } from '../components/status';
import { ApiError } from '../lib/api-client';

/** A page that could not load, with a way to try again; 401 asks to sign in and 404 shows `missing` instead. */
export function LoadError({
  error,
  retry,
  missing,
}: {
  error: Error;
  retry: () => void;
  missing?: { title: string; text?: string };
}): JSX.Element {
  if (error instanceof ApiError && error.status === 401)
    return (
      <section className="container narrow">
        <StatePanel
          icon="lock"
          heading="h1"
          title="Sign in to use Merlin"
          text="Merlin shows the shared app inventory and starts runs for signed-in people only."
        >
          <a className="btn" href="/api/auth/login">
            Sign in
          </a>
        </StatePanel>
      </section>
    );
  if (missing && error instanceof ApiError && error.status === 404)
    return (
      <section className="container narrow">
        <StatePanel
          icon="search"
          heading="h1"
          title={missing.title}
          text={missing.text}
        >
          <a className="btn" href="#/apps">
            All apps
          </a>
        </StatePanel>
      </section>
    );
  return (
    <section className="container narrow">
      <StatePanel
        icon="warning"
        heading="h1"
        error
        title="This page could not load"
        text={`${error.message} Try again.`}
      >
        <button type="button" className="btn" onClick={retry}>
          <Icon name="refresh" size={16} />
          Try again
        </button>
      </StatePanel>
    </section>
  );
}
