import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../components/icon';
import { Skeleton, StateMark, StatusBadge } from '../components/status';
import { describeError } from '../lib/api-client';
import { factoryApi, queryKeys } from '../lib/factory-api';
import {
  announce,
  fmtTime,
  money,
  reducedMotion,
  safeUrl,
} from '../lib/format';
import type {
  AppDetail,
  Check,
  CheckMode,
  CheckState,
  CostEstimate,
} from '../lib/factory-types';
import { LoadError } from './load-error';

const EDGES = [
  {
    id: 'e0',
    kinds: ['github'],
    ids: ['repository', 'github-environments'],
    title: 'Repository to environments',
    text: 'Repository exists; environments hold the Azure variables.',
  },
  {
    id: 'e1',
    kinds: ['github', 'azure'],
    ids: ['identities', 'github-environments'],
    title: 'Environments to identities',
    text: 'Each environment signs in with its own federated identity. No secrets.',
  },
  {
    id: 'e2',
    kinds: ['azure'],
    ids: ['azure-groups', 'identities'],
    title: 'Identities to resource groups',
    text: 'Roles only on the app’s own resource groups.',
  },
  {
    id: 'e3',
    kinds: ['azure', 'deployment'],
    ids: ['web-app', 'state'],
    title: 'Resource groups to App Service',
    text: 'Terraform state exists; the web app is running.',
  },
  {
    id: 'e4',
    kinds: ['deployment'],
    ids: ['release', 'deployed-version', 'health'],
    title: 'App Service to live URL',
    text: 'Latest release succeeded, deployed commit matches main, health check answers.',
  },
];
type Edge = (typeof EDGES)[number];
const NODES = [
  { title: 'Repository', sub: 'GitHub' },
  { title: 'Environments', sub: 'Variables, reviewers' },
  { title: 'Identities', sub: 'Federated credentials' },
  { title: 'Resource groups', sub: 'Scoped roles' },
  { title: 'App Service', sub: 'Per environment' },
  { title: 'Live URL', sub: 'Health checked' },
];
const RANK: Record<CheckState, number> = {
  fail: 3,
  warn: 2,
  unknown: 1,
  pass: 0,
};
const WORD: Record<CheckState, string> = {
  pass: 'Healthy',
  warn: 'Warning',
  fail: 'Failing',
  unknown: 'Not checked',
};
const CHECK_WORD: Record<CheckState, string> = {
  pass: 'Pass',
  warn: 'Warning',
  fail: 'Fail',
  unknown: 'Unknown',
};
const STATES: CheckState[] = ['pass', 'warn', 'fail', 'unknown'];
const BUDGET = {
  ok: 'Within budget',
  near: 'Near budget',
  over: 'Over budget',
};
const KNOWN = new Set(EDGES.flatMap((e) => e.ids));

interface EdgeResult {
  status: CheckState;
  checks: Check[];
}

function edgeStatus(edge: Edge, checks: Check[]): EdgeResult {
  const rel = checks.filter(
    (c) =>
      edge.ids.includes(c.id) ||
      (!KNOWN.has(c.id) && (c.links ?? []).some((l) => edge.kinds.includes(l))),
  );
  if (!rel.length) return { status: 'unknown', checks: [] };
  const worst = rel.reduce<CheckState>(
    (w, c) => (RANK[c.status] > RANK[w] ? c.status : w),
    'pass',
  );
  const allUnknown = rel.every((c) => c.status === 'unknown');
  return {
    status: allUnknown ? 'unknown' : worst === 'unknown' ? 'warn' : worst,
    checks: rel,
  };
}

/** Detail lines like "ok" or "(dry run)" repeat the status; only show text that adds information. */
const informative = (c: Check): boolean =>
  !!c.detail &&
  !/^\(?(ok|dry run|simulated pass)\)?\.?$/i.test(c.detail.trim());

const External = ({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}): JSX.Element => (
  <a
    className={className}
    href={href}
    target="_blank"
    rel="noopener noreferrer"
  >
    {children}
  </a>
);

export function AppDetailView({ slug }: { slug: string }): JSX.Element {
  const app = useQuery({
    queryKey: queryKeys.app(slug),
    queryFn: () => factoryApi.app(slug),
  });
  if (app.isPending)
    return (
      <div className="container">
        <Skeleton rows={4} />
      </div>
    );
  if (app.isError)
    return (
      <LoadError
        error={app.error}
        retry={() => void app.refetch()}
        missing={{
          title: 'App not found',
          text: `No app with the identifier "${slug}".`,
        }}
      />
    );
  return <Detail app={app.data} />;
}

function Detail({ app }: { app: AppDetail }): JSX.Element {
  const queryClient = useQueryClient();
  const [confirmLive, setConfirmLive] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const check = useMutation({
    mutationFn: (mode: CheckMode) => factoryApi.check(app.slug, mode),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.app(app.slug), next);
      void queryClient.invalidateQueries({ queryKey: queryKeys.apps });
      announce(`Check finished: ${next.check?.overall}`);
    },
    onSettled: () => setConfirmLive(false),
  });
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  const focusEdge = (id: string): void => {
    const item = document.getElementById(`edge-${id}`);
    if (!item) return;
    item.scrollIntoView({
      block: 'nearest',
      behavior: reducedMotion() ? 'auto' : 'smooth',
    });
    item.focus({ preventScroll: true });
    setFlash(id);
  };

  const checks = app.check?.checks ?? [];
  const simulated = app.status === 'simulated' || app.status === 'requested';
  const res = EDGES.map((e) => edgeStatus(e, checks));
  const webApps = app.resources?.azure?.webApps ?? [];
  const subs = NODES.map((n) => n.sub);
  if (app.resources?.github?.repo)
    subs[0] = `${app.resources.github.owner}/${app.resources.github.repo}`;
  if (webApps.length)
    subs[4] = `${webApps.length} environment${webApps.length > 1 ? 's' : ''}`;
  const repo = safeUrl(app.repoUrl);
  const appUrl = safeUrl(app.appUrls[0]);
  const busy = check.isPending;

  return (
    <section className="container stack-lg app-detail">
      <a className="back" href="#/apps">
        <Icon name="arrow" size={16} />
        All apps
      </a>
      <div className="page-head">
        <div>
          <div className="title-row">
            <h1>{app.name}</h1>
            <StatusBadge status={app.status} />
          </div>
          <p className="muted meta-line">
            <span className="mono">{app.slug}</span> requested by{' '}
            {app.requestedBy} on {fmtTime(app.createdAt)}
          </p>
        </div>
        <div className="btn-row">
          <a
            className="btn primary"
            href={`#/board/${encodeURIComponent(app.slug)}`}
          >
            Feature board
            <Icon name="arrow" size={16} />
          </a>
          {repo && (
            <External className="btn" href={repo}>
              Repository
              <Icon name="external" size={16} />
            </External>
          )}
          {appUrl && (
            <External className="btn" href={appUrl}>
              Open app
              <Icon name="external" size={16} />
            </External>
          )}
        </div>
      </div>
      {simulated && (
        <div className="notice info">
          <Icon name="eye" />
          <p>Simulated by a dry run. No real resources exist.</p>
        </div>
      )}

      <section
        className="card map-card"
        aria-labelledby="map-title"
        aria-busy={busy}
      >
        <div className="card-head">
          <div>
            <h2 id="map-title">Connection map</h2>
            <p className="muted">
              {app.lastCheck
                ? `Last check ${fmtTime(app.lastCheck.at)}, overall ${app.lastCheck.overall}`
                : 'No check has run yet.'}
            </p>
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => check.mutate('DryRun')}
            >
              <Icon name="refresh" size={16} />
              {busy ? 'Checking...' : simulated ? 'Run check' : 'Dry run check'}
            </button>
            {!simulated && (
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                aria-expanded={confirmLive}
                onClick={() => setConfirmLive((v) => !v)}
              >
                Run live check
              </button>
            )}
          </div>
        </div>
        {confirmLive && (
          <div className="notice warn">
            <Icon name="warning" />
            <div>
              <p>Reads GitHub and Azure with your own sign-in. Read-only.</p>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => check.mutate('Live')}
              >
                Read now
              </button>
            </div>
          </div>
        )}
        {check.isError && (
          <div className="notice err" role="alert">
            <Icon name="warning" />
            <p>{describeError(check.error)}</p>
          </div>
        )}
        <div
          className="cmap"
          role="group"
          aria-label="Connection map from repository to live URL"
        >
          {NODES.map((n, i) => {
            const adj = [res[i - 1], res[i]]
              .filter(Boolean)
              .map((r) => r.status);
            const s = adj.reduce<CheckState>(
              (w, x) => (RANK[x] > RANK[w] ? x : w),
              'pass',
            );
            const e = EDGES[i];
            return [
              <div key={`n${i}`} className={`cm-node s-${s}`}>
                <strong>{n.title}</strong>
                <span className="cm-sub" title={subs[i]}>
                  {subs[i]}
                </span>
                <span className="cm-state">
                  <StateMark state={s} size={14} />
                  {WORD[s]}
                </span>
              </div>,
              e && (
                <button
                  key={e.id}
                  type="button"
                  className={`cm-edge s-${res[i].status}`}
                  aria-label={`${e.title}: ${WORD[res[i].status]}. Show explanation.`}
                  onClick={() => focusEdge(e.id)}
                >
                  <span className="cm-line" />
                  <StateMark state={res[i].status} size={14} />
                </button>
              ),
            ];
          })}
        </div>
        <ul className="legend" aria-label="Connection states">
          {STATES.map((s) => (
            <li key={s}>
              <span className={`link-key s-${s}`} aria-hidden="true" />
              <StateMark state={s} size={14} />
              {WORD[s]}
            </li>
          ))}
        </ul>
        <ol className="edge-list">
          {EDGES.map((e, i) => (
            <EdgeItem
              key={e.id}
              edge={e}
              result={res[i]}
              flash={flash === e.id}
            />
          ))}
        </ol>
      </section>

      {app.cost && <CostCard cost={app.cost} />}
      {checks.length > 0 && <ChecksCard checks={checks} />}
      <div className="cols">
        <ResourcesCard app={app} />
        <HistoryCard app={app} />
      </div>
    </section>
  );
}

function EdgeItem({
  edge: e,
  result: r,
  flash,
}: {
  edge: Edge;
  result: EdgeResult;
  flash: boolean;
}): JSX.Element {
  const bad = r.checks.filter((c) => c.status !== 'pass');
  return (
    <li
      className={`edge-item s-${r.status}${flash ? ' flash' : ''}`}
      id={`edge-${e.id}`}
      tabIndex={-1}
    >
      <div className="edge-state">
        <StateMark state={r.status} />
        <span>{WORD[r.status]}</span>
      </div>
      <div className="edge-body">
        <h3>{e.title}</h3>
        <p className="muted">{e.text}</p>
        {r.checks.length === 0 ? (
          <p className="small muted">Not checked yet.</p>
        ) : bad.length === 0 ? (
          <p className="small muted">
            {r.checks.length} {r.checks.length === 1 ? 'check' : 'checks'}{' '}
            passed.
          </p>
        ) : (
          <ul className="edge-checks">
            {bad.map((c) => (
              <li key={c.id}>
                <StateMark state={c.status} size={14} />
                <span>
                  <strong>{c.title}</strong>
                  {informative(c)
                    ? ` ${c.detail}`
                    : ` ${CHECK_WORD[c.status].toLowerCase()}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function CostCard({ cost: c }: { cost: CostEstimate }): JSX.Element {
  const m = (v: number | undefined): string => money(v, c.currency);
  const running = c.forecast != null;
  const pct =
    running && c.budget
      ? Math.min(100, Math.round(((c.monthToDate ?? 0) / c.budget) * 100))
      : 0;
  return (
    <section className="card cost-card" aria-labelledby="cost-title">
      <div className="card-head">
        <h2 id="cost-title">Cost</h2>
        {c.free ? (
          <span className="free-tag">Free for now</span>
        ) : c.simulated ? (
          <span className="pill">Simulated</span>
        ) : null}
      </div>
      {c.free && (
        <p className="muted small">
          Nothing is charged yet. The figures show what the app would cost
          later.
        </p>
      )}
      {running ? (
        <div className="cost-figures">
          <div>
            <span className="muted small">This month</span>
            <strong>{m(c.monthToDate)}</strong>
          </div>
          <div>
            <span className="muted small">Forecast</span>
            <strong>{m(c.forecast)}</strong>
          </div>
          <div>
            <span className="muted small">Budget</span>
            <strong>{m(c.budget)}</strong>
          </div>
          <div>
            <span className="muted small">Charge forecast</span>
            <strong>{m(c.chargeForecast)}</strong>
          </div>
        </div>
      ) : (
        <p className="muted">
          Estimated {m(c.totalMonthly)} per month once running.
        </p>
      )}
      {running && c.budgetState && (
        <div className={`budget b-${c.budgetState}`}>
          <div
            className="budget-bar"
            role="img"
            aria-label={`${pct}% of the monthly budget used`}
          >
            <span
              className="budget-fill"
              style={{ ['--p' as string]: String(pct / 100) }}
            />
          </div>
          <span className="small">{BUDGET[c.budgetState]}</span>
        </div>
      )}
      <dl className="kv compact">
        <dt>Tier</dt>
        <dd>{c.tier.name}</dd>
        <dt>Cost center</dt>
        <dd>
          {c.costCenter
            ? `${c.costCenter.id} ${c.costCenter.name}`.trim()
            : '-'}
        </dd>
        <dt>Charge</dt>
        <dd>
          Azure + {c.platformFeePercent}% platform fee + {c.seats} ×{' '}
          {m(c.seatFee)} seats
        </dd>
        {c.expiresAt && (
          <>
            <dt>Expires</dt>
            <dd>{fmtTime(c.expiresAt)}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

function ChecksCard({ checks }: { checks: Check[] }): JSX.Element {
  const sorted = [...checks].sort((a, b) => RANK[b.status] - RANK[a.status]);
  const counts = STATES.map(
    (s) => [s, checks.filter((c) => c.status === s).length] as const,
  ).filter(([, n]) => n);
  return (
    <section className="card" aria-labelledby="checks-title">
      <div className="card-head">
        <h2 id="checks-title">Latest check</h2>
        <ul className="tally" aria-label="Result summary">
          {counts.map(([s, n]) => (
            <li key={s} className={`s-${s}`}>
              <StateMark state={s} size={14} />
              {n} {CHECK_WORD[s].toLowerCase()}
            </li>
          ))}
        </ul>
      </div>
      <ul className="check-list">
        {sorted.map((c) => {
          const u = safeUrl(c.url);
          return (
            <li key={c.id} className={`check s-${c.status}`}>
              <span className="check-status">
                <StateMark state={c.status} />
                <span>{CHECK_WORD[c.status]}</span>
              </span>
              <div className="check-body">
                <strong>{c.title}</strong>
                {informative(c) && <p className="muted">{c.detail}</p>}
              </div>
              <div className="check-meta small muted">
                {(c.links ?? []).join(', ')}
                {u && (
                  <External href={u}>
                    Open
                    <Icon name="external" size={12} />
                  </External>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LinkOrText({
  name,
  url,
}: {
  name: string;
  url?: string;
}): JSX.Element {
  const u = safeUrl(url);
  return u ? <External href={u}>{name}</External> : <span>{name}</span>;
}

function ResourcesCard({ app }: { app: AppDetail }): JSX.Element {
  const r = app.resources;
  const az = r?.azure;
  const rows: [string, ReactNode][] = [];
  if (r?.github?.url)
    rows.push([
      'Repository',
      <LinkOrText
        name={`${r.github.owner}/${r.github.repo}`}
        url={r.github.url}
      />,
    ]);
  (az?.resourceGroups ?? []).forEach((g) =>
    rows.push(['Resource group', <span className="mono">{g}</span>]),
  );
  if (az?.stateStorage)
    rows.push([
      'State storage',
      <span className="mono">{`${az.stateStorage.account}/${az.stateStorage.container}`}</span>,
    ]);
  (az?.identities ?? []).forEach((i) =>
    rows.push([`Identity (${i.role})`, <span className="mono">{i.name}</span>]),
  );
  (az?.webApps ?? []).forEach((w) =>
    rows.push([
      `Web app (${w.environment})`,
      <LinkOrText name={w.name} url={w.url} />,
    ]),
  );
  return (
    <section className="card" aria-labelledby="res-title">
      <h2 id="res-title">Resources</h2>
      {rows.length ? (
        <dl className="kv">
          {rows.map(([k, v], i) => [
            <dt key={`k${i}`}>{k}</dt>,
            <dd key={`v${i}`}>{v}</dd>,
          ])}
        </dl>
      ) : (
        <p className="muted">None yet.</p>
      )}
    </section>
  );
}

function HistoryCard({ app }: { app: AppDetail }): JSX.Element {
  const kind = (s: string) =>
    s === 'succeeded' ? 'live' : s === 'failed' ? 'failed' : 'provisioning';
  const label: Record<string, string> = {
    succeeded: 'Succeeded',
    failed: 'Failed',
    running: 'Running',
  };
  return (
    <section className="card" aria-labelledby="hist-title">
      <h2 id="hist-title">Run history</h2>
      {app.runs.length ? (
        <ul className="history">
          {app.runs.map((r) => (
            <li key={r.id}>
              <a href={`#/run/${encodeURIComponent(r.id)}`}>
                <StatusBadge
                  status={kind(r.status)}
                  label={label[r.status] ?? r.status}
                />
                <span className="pill">{r.mode}</span>
                <span className="muted small">{fmtTime(r.startedAt)}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No runs yet.</p>
      )}
    </section>
  );
}
