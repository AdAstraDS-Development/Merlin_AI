import { useEffect, useReducer, useState, type JSX } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../components/icon';
import { Skeleton } from '../components/status';
import { factoryApi, queryKeys } from '../lib/factory-api';
import { announce, fmtDuration, safeUrl } from '../lib/format';
import type {
  RunEvent,
  RunMode,
  RunSummary,
  StepStatus,
} from '../lib/factory-types';
import { LoadError } from './load-error';

const LABEL: Record<StepStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  succeeded: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
  waiting: 'Waiting',
};
const modeLabel = (m: RunMode | string): string =>
  m === 'DryRun'
    ? 'Dry run'
    : m === 'Local'
      ? 'On this computer'
      : m === 'Factory'
        ? 'Factory'
        : m;

function StatusIcon({ status }: { status: StepStatus }): JSX.Element {
  switch (status) {
    case 'succeeded':
      return (
        <svg className="st-ic" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10" className="ring" />
          <path d="M7 12.5l3.2 3.2L17 9" className="tick" pathLength={1} />
        </svg>
      );
    case 'failed':
      return (
        <svg className="st-ic" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10" className="ring" />
          <path
            d="M8.5 8.5l7 7M15.5 8.5l-7 7"
            className="tick"
            pathLength={1}
          />
        </svg>
      );
    case 'running':
      return (
        <svg className="st-ic spin" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10" className="ring faint" />
          <path d="M12 2a10 10 0 0 1 10 10" className="arc" />
        </svg>
      );
    case 'waiting':
      return (
        <svg className="st-ic pulse" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10" className="ring" />
          <path d="M12 7v5l3 2" className="hand" />
        </svg>
      );
    case 'skipped':
      return (
        <svg className="st-ic" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10" className="ring faint" />
          <path d="M8 12h8" className="hand" />
        </svg>
      );
    default:
      return (
        <svg className="st-ic" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10" className="ring faint" />
        </svg>
      );
  }
}

interface StepState {
  id: string;
  title: string;
  description?: string;
  status: StepStatus;
  detail?: string;
  url?: string | null;
  commands?: string[];
  startedAt?: number;
  endedAt?: number;
}
type Result = Extract<RunEvent, { type: 'result' }>;
interface RunState {
  mode: RunMode;
  steps: StepState[];
  logs: string[];
  statusLine: string;
  waiting: string | null;
  result: Result | null;
}
type Action = RunEvent | { type: 'lost'; message: string };

const finished = (s: StepStatus): boolean =>
  s === 'succeeded' || s === 'failed' || s === 'skipped';

function reduce(state: RunState, ev: Action): RunState {
  switch (ev.type) {
    case 'plan':
      // The plan is always the first event; a replay of the stream starts over.
      return {
        ...state,
        mode: ev.mode ?? state.mode,
        steps: (ev.steps ?? []).map((s) => ({ ...s, status: 'pending' })),
        logs: [],
        statusLine: 'Working...',
        waiting: null,
        result: null,
      };
    case 'step': {
      const t = Date.parse(ev.at) || Date.now();
      const known = state.steps.some((s) => s.id === ev.id);
      const steps = (
        known
          ? state.steps
          : [
              ...state.steps,
              { id: ev.id, title: ev.id, status: 'pending' as const },
            ]
      ).map((s) => {
        if (s.id !== ev.id) return s;
        const n: StepState = { ...s, status: ev.status };
        if (ev.detail) n.detail = ev.detail;
        if (ev.url) n.url = ev.url;
        if (ev.commands) n.commands = ev.commands;
        if (ev.status === 'running' && !n.startedAt) n.startedAt = t;
        if (finished(ev.status)) {
          n.startedAt ??= t;
          n.endedAt = t;
        }
        return n;
      });
      const step = steps.find((s) => s.id === ev.id)!;
      return {
        ...state,
        steps,
        statusLine:
          ev.status === 'running'
            ? `${step.title}...`
            : ev.status === 'waiting'
              ? 'Waiting for approval.'
              : state.statusLine,
        waiting:
          ev.status === 'waiting'
            ? step.detail || 'Waiting for an approval or a workflow run.'
            : ev.status !== 'pending'
              ? null
              : state.waiting,
      };
    }
    case 'log':
      return {
        ...state,
        logs: [
          ...state.logs,
          `${(ev.at || '').slice(11, 19)} ${ev.level || 'info'}  ${ev.message}`,
        ],
      };
    case 'result': {
      const ok = ev.status === 'succeeded';
      const at = Date.parse(ev.at) || Date.now();
      return {
        ...state,
        steps: state.steps.map((s) =>
          s.status === 'running' || s.status === 'waiting'
            ? { ...s, status: ok ? 'succeeded' : 'failed', endedAt: at }
            : s,
        ),
        waiting: null,
        statusLine: ev.message || (ok ? 'Finished.' : 'The run failed.'),
        result: ev,
      };
    }
    case 'lost':
      return {
        ...state,
        statusLine: `Lost connection to the portal: ${ev.message}`,
      };
    default:
      return state;
  }
}

export function RunView({ id }: { id: string }): JSX.Element {
  const run = useQuery({
    queryKey: queryKeys.run(id),
    queryFn: () => factoryApi.run(id),
  });
  if (run.isPending)
    return (
      <div className="container">
        <Skeleton rows={4} />
      </div>
    );
  if (run.isError)
    return (
      <LoadError
        error={run.error}
        retry={() => void run.refetch()}
        missing={{ title: 'Run not found' }}
      />
    );
  return <RunProgress summary={run.data} />;
}

function RunProgress({ summary }: { summary: RunSummary }): JSX.Element {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(reduce, {
    mode: summary.mode,
    steps: [],
    logs: [],
    statusLine: 'Connecting...',
    waiting: null,
    result: null,
  });
  const [now, setNow] = useState(() => Date.now());
  const anyRunning = state.steps.some((s) => s.status === 'running');

  useEffect(() => {
    const ctrl = new AbortController();
    factoryApi
      .streamRun(summary.id, dispatch, ctrl.signal)
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted)
          dispatch({
            type: 'lost',
            message: e instanceof Error ? e.message : String(e),
          });
      });
    return () => ctrl.abort();
  }, [summary.id]);

  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyRunning]);

  const result = state.result;
  useEffect(() => {
    if (!result) return;
    announce(
      result.status === 'succeeded'
        ? 'Run finished successfully'
        : 'Run failed',
    );
    void queryClient.invalidateQueries({ queryKey: queryKeys.apps });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.app(summary.appSlug),
    });
  }, [result, queryClient, summary.appSlug]);

  const ok = result?.status === 'succeeded';
  const total = state.steps.length;
  const done = state.steps.filter(
    (s) => s.status === 'succeeded' || s.status === 'skipped',
  ).length;
  const p = result && ok ? 1 : total ? done / total : 0;
  const recent = state.logs.slice(-500);

  return (
    <section className="container narrow-wide stack-lg run-view">
      <div
        className={`run-head card${result ? (ok ? ' is-success' : ' is-failed') : ''}`}
      >
        <div className="run-head-text">
          <div className="title-row">
            <h1>{summary.appName || summary.appSlug}</h1>
            <span className="pill">{modeLabel(state.mode)}</span>
          </div>
          <p className="lead" aria-live="polite">
            {state.statusLine}
          </p>
          <div className="run-progress">
            <div
              className="bar"
              role="progressbar"
              aria-label="Run progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(p * 100)}
            >
              <span
                className="bar-fill"
                style={{ ['--p' as string]: String(p) }}
              />
            </div>
            <span className="bar-text">
              {total
                ? `${result && ok ? total : done} of ${total} steps`
                : 'Starting'}
            </span>
          </div>
          {state.waiting && (
            <div className="banner-slot">
              <div className="notice warn">
                <Icon name="clock" />
                <p>{state.waiting}</p>
              </div>
            </div>
          )}
        </div>
      </div>
      {result &&
        (ok ? (
          <SuccessCard summary={summary} mode={state.mode} result={result} />
        ) : (
          <FailureCard result={result} />
        ))}
      <div className="card">
        <h2>Progress</h2>
        <ol className="timeline">
          {state.steps.map((s) => (
            <TimelineItem key={s.id} step={s} now={now} />
          ))}
        </ol>
      </div>
      <details className="card log-card">
        <summary>Log ({state.logs.length} lines)</summary>
        <pre className="log" tabIndex={0} aria-label="Run log">
          {recent.join('\n')}
        </pre>
      </details>
    </section>
  );
}

function TimelineItem({
  step: s,
  now,
}: {
  step: StepState;
  now: number;
}): JSX.Element {
  const dur = s.startedAt ? fmtDuration((s.endedAt ?? now) - s.startedAt) : '';
  const url = safeUrl(s.url);
  const title = s.title.toLowerCase();
  const detail = s.detail?.toLowerCase() ?? '';
  const redundant =
    !s.detail || detail === `running ${title}` || detail.includes(title);
  const text = redundant ? s.description : s.detail;
  return (
    <li className={`tl-item s-${s.status}`}>
      <span className="tl-mark">
        <StatusIcon status={s.status} />
      </span>
      <div className="tl-body">
        <div className="tl-line">
          <h3>{s.title}</h3>
          <span className="tl-state">{LABEL[s.status] ?? s.status}</span>
          <span className="tl-dur">{dur}</span>
        </div>
        {text && <p className="muted">{text}</p>}
        {url && (
          <a
            className="tl-link"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {url.replace(/^https?:\/\//, '')}
            <Icon name="external" size={14} />
          </a>
        )}
        {s.commands && s.commands.length > 0 && (
          <details className="cmds">
            <summary>Commands ({s.commands.length})</summary>
            <pre className="code">{s.commands.join('\n')}</pre>
          </details>
        )}
      </div>
    </li>
  );
}

function SuccessCard({
  summary,
  mode,
  result,
}: {
  summary: RunSummary;
  mode: RunMode;
  result: Result;
}): JSX.Element {
  const sim = mode === 'DryRun';
  const repo = safeUrl(result.repoUrl);
  const app = safeUrl(result.appUrl);
  const slug = encodeURIComponent(summary.appSlug);
  return (
    <div className="card result success">
      <span className="result-mark">
        <Icon name="check" size={26} />
      </span>
      <div className="result-text">
        <h2>{sim ? 'Dry run complete' : 'Your application is live'}</h2>
        <p className="lead">
          {sim
            ? 'Nothing was created. Open a step to see the commands a real run executes.'
            : result.message ||
              'Repository, Azure resources and pipelines are ready.'}
        </p>
        <div className="btn-row">
          {!sim && repo && (
            <a
              className="btn primary"
              href={repo}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open repository
              <Icon name="external" size={16} />
            </a>
          )}
          {!sim && app && (
            <a
              className="btn"
              href={app}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open app
              <Icon name="external" size={16} />
            </a>
          )}
          <a className="btn primary" href={`#/board/${slug}`}>
            Open feature board
            <Icon name="arrow" size={16} />
          </a>
          <a className="btn" href={`#/app/${slug}`}>
            View app
          </a>
          {sim && (
            <a className="btn" href="#/new">
              Run for real
            </a>
          )}
        </div>
        {!sim && (
          <p className="muted">
            Next: clone the repository and ask your agent{' '}
            <code>Write the spec for intent 001</code>.
          </p>
        )}
      </div>
    </div>
  );
}

function FailureCard({ result }: { result: Result }): JSX.Element {
  return (
    <div className="card result failed" role="alert">
      <span className="result-mark">
        <Icon name="warning" size={26} />
      </span>
      <div className="result-text">
        <h2>The run stopped</h2>
        <p className="lead">{result.message || 'A step failed.'}</p>
        <p className="muted">
          Open the failed step for details. Fix the cause, then run again with a
          new name suffix, or continue this run with the engine&apos;s -Resume
          option.
        </p>
        <div className="btn-row">
          <a className="btn" href="#/new">
            Back to the form
          </a>
          <a className="btn" href="#/apps">
            All apps
          </a>
        </div>
      </div>
    </div>
  );
}
