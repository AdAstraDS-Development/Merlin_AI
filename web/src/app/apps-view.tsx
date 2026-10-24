import { useRef, useState, type JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '../components/icon';
import { Skeleton, StatePanel, StatusBadge } from '../components/status';
import { factoryApi, queryKeys } from '../lib/factory-api';
import { APP_STATUS } from '../lib/factory-labels';
import { ago, money, safeUrl } from '../lib/format';
import type { AppStatus, AppSummary } from '../lib/factory-types';
import { LoadError } from './load-error';

export function AppsView(): JSX.Element {
  const apps = useQuery({ queryKey: queryKeys.apps, queryFn: factoryApi.apps });
  if (apps.isPending)
    return (
      <div className="container">
        <Skeleton rows={4} />
      </div>
    );
  if (apps.isError)
    return <LoadError error={apps.error} retry={() => void apps.refetch()} />;
  return <Overview apps={apps.data} />;
}

function Overview({ apps }: { apps: AppSummary[] }): JSX.Element {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | AppStatus>('all');
  const search = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const shown = apps.filter(
    (a) =>
      (filter === 'all' || a.status === filter) &&
      (!q || a.name.toLowerCase().includes(q) || a.slug.includes(q)),
  );
  const statuses: ('all' | AppStatus)[] = [
    'all',
    ...new Set(apps.map((a) => a.status)),
  ];

  return (
    <section className="container stack-lg">
      <div className="page-head">
        <div>
          <h1>Apps</h1>
        </div>
        {apps.length > 0 && (
          <a className="btn primary" href="#/new">
            <Icon name="plus" />
            New app
          </a>
        )}
      </div>
      {apps.length === 0 ? (
        <StatePanel
          icon="box"
          title="No apps yet"
          text="A dry run adds a simulated app here."
        >
          <a className="btn primary" href="#/new">
            <Icon name="plus" />
            Create the first app
          </a>
        </StatePanel>
      ) : (
        <>
          <div className="toolbar">
            <div className="search-wrap">
              <Icon name="search" size={18} />
              <input
                ref={search}
                type="search"
                id="app-search"
                placeholder="Search by name or identifier"
                className="input"
                aria-label="Search applications"
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="chips" role="group" aria-label="Filter by status">
              {statuses.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chip-btn"
                  aria-pressed={filter === s}
                  onClick={() => setFilter(s)}
                >
                  {s === 'all' ? 'All' : (APP_STATUS[s] ?? s)}
                </button>
              ))}
            </div>
          </div>
          <p className="muted" aria-live="polite">
            {shown.length === apps.length
              ? `${apps.length} ${apps.length === 1 ? 'application' : 'applications'}`
              : `${shown.length} of ${apps.length} applications`}
          </p>
          {shown.length > 0 ? (
            <ul className="app-list">
              {shown.map((a) => (
                <AppRow key={a.slug} app={a} />
              ))}
            </ul>
          ) : (
            <StatePanel
              icon="search"
              title="No match"
              text="Try another search or filter."
            >
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                  search.current?.focus();
                }}
              >
                Clear
              </button>
            </StatePanel>
          )}
        </>
      )}
    </section>
  );
}

function AppRow({ app: a }: { app: AppSummary }): JSX.Element {
  const url = safeUrl(a.appUrls[0]);
  const c = a.cost;
  return (
    <li className="app-row">
      <a className="app-row-link" href={`#/app/${encodeURIComponent(a.slug)}`}>
        <div className="app-main">
          <h2>{a.name}</h2>
          <p className="mono muted small">{a.slug}</p>
          {a.description && <p className="app-desc">{a.description}</p>}
        </div>
        <div className="app-status">
          <StatusBadge status={a.status} />
        </div>
        <div className="app-envs">
          {a.environments.map((e) => (
            <span key={e} className="pill">
              {e}
            </span>
          ))}
        </div>
        <div className="app-meta small muted">
          {c?.free ? (
            <span className="cost-chip">Free for now</span>
          ) : c?.forecast != null ? (
            <span className={`cost-chip b-${c.budgetState}`}>
              {money(c.chargeForecast, c.currency)} / month
              {c.budgetState === 'ok'
                ? ''
                : c.budgetState === 'near'
                  ? ', near budget'
                  : ', over budget'}
            </span>
          ) : null}
          <span>
            {a.lastCheck ? `Checked ${ago(a.lastCheck.at)}` : 'Not checked yet'}
          </span>
          {url && (
            <span className="truncate mono" title={url}>
              {url.replace('https://', '')}
            </span>
          )}
        </div>
      </a>
    </li>
  );
}
