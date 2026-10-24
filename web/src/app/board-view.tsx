import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../components/icon';
import { Skeleton } from '../components/status';
import { describeError } from '../lib/api-client';
import { factoryApi, queryKeys } from '../lib/factory-api';
import { MODEL } from '../lib/factory-labels';
import { announce, toast } from '../lib/format';
import type {
  AppDetail,
  BoardData,
  BoardStage,
  Feature,
  FeatureSource,
  NewFeature,
} from '../lib/factory-types';
import { LoadError } from './load-error';

const STATUS: Record<string, string> = {
  queued: 'Queued',
  running: 'Working',
  waiting: 'Waiting',
  passed: 'Passed',
  changes: 'Changes requested',
  done: 'Released',
};
const SOURCE: Record<FeatureSource, string> = {
  jira: 'Jira',
  servicenow: 'ServiceNow',
  teams: 'Teams',
};
const POLL_MS = 2000;
const SAMPLES: NewFeature[] = [
  { title: 'Show entries on a map', kind: 'feature', source: 'jira' },
  {
    title: 'Approval step for large orders',
    kind: 'feature',
    source: 'servicenow',
  },
  { title: 'Bug: export cuts off umlauts', kind: 'bug', source: 'teams' },
  { title: 'Weekly summary mail', kind: 'feature', source: 'jira' },
  {
    title: 'Bug: search ignores the last word',
    kind: 'bug',
    source: 'servicenow',
  },
];

export function BoardView({
  slug,
  demo,
}: {
  slug: string;
  demo: boolean;
}): JSX.Element {
  const app = useQuery({
    queryKey: queryKeys.app(slug),
    queryFn: () => factoryApi.app(slug),
  });
  const board = useQuery({
    queryKey: queryKeys.features(slug),
    queryFn: () => factoryApi.features(slug),
    refetchInterval: POLL_MS,
  });
  if (app.isPending || board.isPending)
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
        missing={{ title: 'App not found' }}
      />
    );
  if (board.isError && !board.data)
    return (
      <LoadError
        error={board.error}
        retry={() => void board.refetch()}
        missing={{ title: 'App not found' }}
      />
    );
  return (
    <Board
      app={app.data}
      data={board.data!}
      offline={board.isError}
      demo={demo}
    />
  );
}

function Board({
  app,
  data,
  offline,
  demo,
}: {
  app: AppDetail;
  data: BoardData;
  offline: boolean;
  demo: boolean;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [sample, setSample] = useState(0);
  const toggle = useRef<HTMLButtonElement>(null);
  const add = useMutation({
    mutationFn: (f: NewFeature) => factoryApi.addFeature(app.slug, f),
    onSuccess: (next) =>
      queryClient.setQueryData(queryKeys.features(app.slug), next),
  });

  const simulate = (): void => {
    const f = SAMPLES[sample % SAMPLES.length];
    setSample((n) => n + 1);
    add.mutate(f, {
      onSuccess: () => announce(`Simulated request added: ${f.title}`),
      onError: (e) => toast(describeError(e)),
    });
  };
  const close = (): void => {
    setFormOpen(false);
    toggle.current?.focus();
  };

  const index = Object.fromEntries(data.stages.map((s, i) => [s.id, i]));
  const count = (st: string): number =>
    data.features.filter((f) => f.status === st).length;
  const human = data.features.filter(
    (f) => f.stage === 'human' && f.status === 'waiting',
  ).length;
  const tally = [
    `${count('running')} ${count('running') === 1 ? 'agent' : 'agents'} working`,
    human ? `${human} waiting for a person` : '',
    `${count('done')} released`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section className="container board-view stack-lg">
      <a className="back" href={`#/app/${encodeURIComponent(app.slug)}`}>
        <Icon name="arrow" size={16} />
        {app.name}
      </a>
      <div className="page-head">
        <div>
          <div className="title-row">
            <h1>Feature board</h1>
            {data.simulated && <span className="pill">Simulated</span>}
            <span className={`live-dot${offline ? ' off' : ''}`}>
              {offline ? 'Offline, retrying' : 'Live'}
            </span>
          </div>
          <p className="board-tally muted small" role="status">
            {tally}
          </p>
        </div>
        <div className="btn-row">
          {demo && (
            <button
              type="button"
              className="btn"
              disabled={add.isPending}
              onClick={simulate}
            >
              <Icon name="play" size={16} />
              Simulate a request
            </button>
          )}
          <button
            ref={toggle}
            type="button"
            className="btn primary"
            aria-expanded={formOpen}
            onClick={() => setFormOpen((o) => !o)}
          >
            <Icon name="plus" size={16} />
            New request
          </button>
        </div>
      </div>
      {formOpen && (
        <RequestForm
          busy={add.isPending}
          onClose={close}
          onSubmit={(f, done) =>
            add.mutate(f, {
              onSuccess: () => {
                done(null);
                close();
                announce('Request added. The spec writer picks it up.');
              },
              onError: (e) => done(describeError(e)),
            })
          }
        />
      )}
      <div className="board-scroll">
        <div
          className="board"
          role="table"
          aria-label="Features by stage"
          style={{ ['--cols' as string]: String(data.stages.length) }}
        >
          <div className="board-row board-head" role="row">
            <div className="lane-head" role="columnheader">
              Request
            </div>
            {data.stages.map((s) => (
              <div
                key={s.id}
                className={`stage-head st-${s.id}`}
                role="columnheader"
                title={s.purpose}
              >
                <strong>{s.title}</strong>
                <span className="small muted">
                  {s.model
                    ? `${s.agent} · ${MODEL[s.model] ?? s.model}`
                    : s.agent}
                </span>
              </div>
            ))}
          </div>
          {data.features.map((f) => (
            <Lane
              key={f.id}
              feature={f}
              stages={data.stages}
              current={index[f.stage] ?? 0}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function Lane({
  feature: f,
  stages,
  current,
}: {
  feature: Feature;
  stages: BoardStage[];
  current: number;
}): JSX.Element {
  const changed = new Set(
    f.history.filter((x) => x.status === 'changes').map((x) => x.stage),
  );
  return (
    <div className={`board-row lane s-${f.status}`} role="row">
      <div className="lane-head" role="rowheader">
        <span className={`src src-${f.source.kind}`}>
          <span className="src-dot" aria-hidden="true" />
          {`${SOURCE[f.source.kind] ?? f.source.label} ${f.source.key}`}
        </span>
        <strong className="lane-title">{f.title}</strong>
        <span className="lane-tags">
          <span className={`tag ${f.kind === 'bug' ? 'tag-bug' : ''}`}>
            {f.kind === 'bug' ? 'Bug' : 'Feature'}
          </span>
          {f.size && (
            <span className="tag">{f.size === 'big' ? 'Big' : 'Small'}</span>
          )}
          {f.loops > 0 && (
            <span
              className="tag tag-loop"
              title="Review rounds that sent the work back"
            >
              <Icon name="refresh" size={12} />
              {f.loops}
            </span>
          )}
        </span>
      </div>
      {stages.map((s, i) => (
        <div
          key={s.id}
          className={`cell${i < current ? ' past' : ''}${i === current ? ' now' : ''}`}
          role="cell"
          aria-label={`${s.title}: ${i < current ? 'done' : i === current ? (STATUS[f.status] ?? f.status) : 'not started'}`}
        >
          {i < current && (
            <span
              className={`past-mark${changed.has(s.id) ? ' looped' : ''}`}
              aria-hidden="true"
            >
              <Icon name={changed.has(s.id) ? 'refresh' : 'check'} size={14} />
            </span>
          )}
          {i === current && (
            <FeatureCard key={`${f.id}-${s.id}`} feature={f} stage={s} />
          )}
        </div>
      ))}
    </div>
  );
}

function FeatureCard({
  feature: f,
  stage: s,
}: {
  feature: Feature;
  stage: BoardStage;
}): JSX.Element {
  const person = !s.model;
  // The card is mounted again when it moves to another stage, so the enter animation plays once per move.
  const [entering, setEntering] = useState(true);
  return (
    <article
      className={`fcard${entering ? ' enter' : ''} s-${f.status}`}
      onAnimationEnd={(e) => e.target === e.currentTarget && setEntering(false)}
    >
      <div className="fcard-top">
        <span className={`avatar${person ? ' person' : ''}`} aria-hidden="true">
          {person ? (
            <Icon name={s.id === 'done' ? 'check' : 'eye'} size={14} />
          ) : (
            (MODEL[s.model ?? ''] ?? 'AI').slice(0, 2)
          )}
        </span>
        <span className="fcard-who">
          <strong>{f.agent.name}</strong>
          <span className="small muted">
            {s.model
              ? (MODEL[s.model] ?? s.model)
              : s.id === 'human'
                ? 'Human in the loop'
                : 'GitHub Actions'}
          </span>
        </span>
      </div>
      <p className="fcard-status">
        <span className="st-ind" aria-hidden="true" />
        {STATUS[f.status] ?? f.status}
      </p>
      <p className="fcard-detail small">{f.detail}</p>
      <span
        className="fcard-bar"
        aria-hidden="true"
        hidden={f.progress == null}
      >
        <span style={{ ['--p' as string]: String(f.progress ?? 0) }} />
      </span>
    </article>
  );
}

function RequestForm({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (f: NewFeature, done: (error: string | null) => void) => void;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<NewFeature['kind']>('feature');
  const [source, setSource] = useState<FeatureSource>('jira');
  const [error, setError] = useState<string | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  useEffect(() => titleInput.current?.focus(), []);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    setError(null);
    onSubmit({ title, kind, source }, setError);
  };

  return (
    <form
      className="card request-form"
      noValidate
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="field grow">
        <label htmlFor="req-title">What should change?</label>
        <input
          ref={titleInput}
          type="text"
          className="input"
          id="req-title"
          maxLength={120}
          autoComplete="off"
          placeholder="For example: Show trips on a map"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="req-kind">Type</label>
        <select
          className="input"
          id="req-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as NewFeature['kind'])}
        >
          <option value="feature">Feature</option>
          <option value="bug">Bug</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="req-source">From</label>
        <select
          className="input"
          id="req-source"
          value={source}
          onChange={(e) => setSource(e.target.value as FeatureSource)}
        >
          {Object.entries(SOURCE).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn primary" disabled={busy}>
        Add
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
