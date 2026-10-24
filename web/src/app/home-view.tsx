import { useEffect, useState, type JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '../components/icon';
import { Skeleton, StatusBadge } from '../components/status';
import { factoryApi, queryKeys } from '../lib/factory-api';
import { ago, money, plural, reducedMotion } from '../lib/format';
import type { AppSummary, FactoryInfo } from '../lib/factory-types';
import { LoadError } from './load-error';

export function HomeView({
  info,
  onSimulate,
}: {
  info: FactoryInfo;
  onSimulate: () => void;
}): JSX.Element {
  const apps = useQuery({ queryKey: queryKeys.apps, queryFn: factoryApi.apps });
  if (apps.isPending)
    return (
      <div className="container">
        <Skeleton rows={4} />
      </div>
    );
  if (apps.isError)
    return <LoadError error={apps.error} retry={() => void apps.refetch()} />;
  return <Home apps={apps.data} info={info} onSimulate={onSimulate} />;
}

function Home({
  apps,
  info,
  onSimulate,
}: {
  apps: AppSummary[];
  info: FactoryInfo;
  onSimulate: () => void;
}): JSX.Element {
  const count = (...s: string[]): number =>
    apps.filter((a) => s.includes(a.status)).length;
  // Locally every app is simulated; count them so the demo shows what a real overview looks like.
  const real = count('live', 'degraded');
  const onlySimulated = real === 0 && count('simulated') > 0;
  const online = onlySimulated ? count('simulated') : real;
  const notes = [
    count('degraded') &&
      plural(count('degraded'), 'needs attention', 'need attention'),
    count('provisioning', 'awaiting-approval') &&
      `${count('provisioning', 'awaiting-approval')} in progress`,
    count('failed') && `${count('failed')} failed`,
    !onlySimulated && count('simulated') && `${count('simulated')} simulated`,
  ].filter(Boolean);
  const withCost = apps.filter((a) => a.cost?.forecast != null);
  const spend = withCost.reduce((t, a) => t + (a.cost?.chargeForecast ?? 0), 0);
  const currency = withCost[0]?.cost?.currency ?? 'EUR';
  const simulatedCost = withCost.some((a) => a.cost?.simulated);
  const recent = apps.slice(0, 4);

  const animate = online >= 2 && !reducedMotion();
  const [shown, setShown] = useState(animate ? 0 : online);
  useEffect(() => {
    if (!animate) return;
    let frame = 0;
    const start = performance.now();
    const tick = (t: number): void => {
      const k = Math.min(1, (t - start) / 900);
      setShown(Math.round(online * (1 - (1 - k) ** 3)));
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate, online]);

  return (
    <section className="container stack-xl home">
      <div className="funnel">
        <a className="funnel-create" href="#/new">
          <span className="funnel-icon">
            <Icon name="plus" size={28} />
          </span>
          <h1>Create a new app</h1>
          <p>
            Describe your idea. You get a repository, Azure resources, pipelines
            and a running app.
          </p>
          <span className="btn primary large funnel-cta">
            Start
            <Icon name="arrow" size={18} />
          </span>
        </a>
        <a className="funnel-apps" href="#/apps">
          <span className="funnel-num">{animate ? shown : online}</span>
          <strong>
            {online === 1 ? 'app online' : 'apps online'}
            {onlySimulated ? ' (simulated)' : ''}
          </strong>
          <span className="muted small">
            {notes.length
              ? notes.join(' · ')
              : `${plural(apps.length, 'app', 'apps')} in total`}
          </span>
          {withCost.length > 0 &&
            (withCost.every((a) => a.cost?.free) ? (
              <span className="funnel-spend">
                <strong>Free for now</strong> · later about{' '}
                {money(spend, currency)} / month
              </span>
            ) : (
              <span className="funnel-spend">
                <strong>{money(spend, currency)}</strong> / month
                {simulatedCost ? ' (simulated)' : ''}
              </span>
            ))}
          <span className="funnel-link">
            View apps
            <Icon name="arrow" size={16} />
          </span>
        </a>
      </div>
      {recent.length > 0 && (
        <section className="stack" aria-labelledby="recent-title">
          <h2 id="recent-title" className="minor">
            Recent
          </h2>
          <ul className="recent">
            {recent.map((a) => (
              <li key={a.slug}>
                <a href={`#/app/${encodeURIComponent(a.slug)}`}>
                  <strong>{a.name}</strong>
                  <StatusBadge status={a.status} />
                  <span className="muted small">
                    {ago(a.updatedAt ?? a.createdAt)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {info.demo && (
        <div className="sim-strip">
          <button type="button" className="btn" onClick={onSimulate}>
            <Icon name="play" size={16} />
            Run a simulation
          </button>
          <span className="muted small">
            Creates a sample app in a dry run, then you can open its feature
            board. Nothing real is created.
          </span>
        </div>
      )}
      <ol className="flow-strip" aria-label="How it works">
        {['Describe', 'Review', 'Approve', 'Live'].map((t, i) => (
          <li key={t}>
            <span className="j-num">{i + 1}</span>
            {t}
          </li>
        ))}
        <li className="flow-more">
          <a href="#/how">How it works</a>
        </li>
      </ol>
    </section>
  );
}
