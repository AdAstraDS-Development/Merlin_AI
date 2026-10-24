import { useRef, useState, type JSX } from 'react';
import {
  AppFigure,
  ArchitectureFigure,
} from '../components/architecture-diagram';
import { LoopTour, type LoopStage } from '../components/loop-tour';

const JOURNEY = [
  {
    who: 'You',
    title: 'Describe',
    text: 'Name, idea, users. Paste or drop what you have.',
  },
  {
    who: 'You',
    title: 'Review',
    text: 'See every name before anything exists. Rehearse with a dry run.',
  },
  {
    who: 'Approver',
    title: 'Approve',
    text: 'The request waits until a person releases it.',
  },
  {
    who: 'Factory',
    title: 'Build',
    text: 'Repository, Azure resources, identities and pipelines.',
  },
  {
    who: 'Factory',
    title: 'Live',
    text: 'First release deployed and health checked.',
  },
];

const STAGES: (LoopStage & { file: string; by: string; approves: string })[] = [
  {
    label: 'Intent',
    kind: 'human',
    file: 'intent.md',
    by: 'You, with an agent',
    approves: 'Product owner',
    text: 'Problem, outcome, users, constraints.',
  },
  {
    label: 'Spec',
    kind: 'human',
    file: 'spec.md',
    by: 'Agent',
    approves: 'Product owner',
    text: 'Use cases with Given/When/Then acceptance criteria.',
  },
  {
    label: 'Plan',
    kind: 'human',
    file: 'plan.md',
    by: 'Agent in plan mode',
    approves: 'Engineer',
    text: 'Files, order, risks, how each criterion is proven.',
  },
  {
    label: 'Build',
    kind: 'agent',
    file: 'code',
    by: 'Coding agent',
    approves: 'Checked by the next stages',
    text: 'One use case at a time, with tests.',
  },
  {
    label: 'Verify',
    kind: 'auto',
    file: 'pnpm validate',
    by: 'Automation',
    approves: 'Checks must pass',
    text: 'Lint, types, tests, package, smoke test.',
  },
  {
    label: 'Review',
    kind: 'human',
    file: 'pull request',
    by: 'Claude, then a person',
    approves: 'A human merges',
    text: 'AI review is advice; the merge is a human decision.',
  },
  {
    label: 'Deploy',
    kind: 'human',
    file: 'release',
    by: 'GitHub Actions',
    approves: 'Reviewers for production',
    text: 'Built once, promoted unchanged to production.',
  },
  {
    label: 'Maintain',
    kind: 'auto',
    file: 'operate',
    by: 'Team, Dependabot',
    approves: 'Pull request rules',
    text: 'What you learn becomes the next intent.',
  },
];
const KIND = {
  human: 'Human approves',
  agent: 'Agent works',
  auto: 'Automated',
};

type Tab = 'requesters' | 'technical';
const TABS: [Tab, string][] = [
  ['requesters', 'For requesters'],
  ['technical', 'Technical'],
];

export function HowView({
  initialTab,
}: {
  initialTab: string | null;
}): JSX.Element {
  const [tab, setTab] = useState<Tab>(
    initialTab === 'technical' ? 'technical' : 'requesters',
  );
  // Panels are built on first view and then kept, so their figures do not restart.
  const [built, setBuilt] = useState<Set<Tab>>(() => new Set([tab]));
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});

  const select = (next: Tab, focus = false): void => {
    setTab(next);
    setBuilt((b) => (b.has(next) ? b : new Set([...b, next])));
    history.replaceState(
      null,
      '',
      `#/how${next === 'technical' ? '?tab=technical' : ''}`,
    );
    if (focus) buttons.current[next]?.focus();
  };

  return (
    <div>
      <div className="container page-head">
        <h1>How it works</h1>
      </div>
      <section className="container tabs-section">
        <div className="tabs" role="tablist" aria-label="Audience">
          {TABS.map(([id, label], i) => (
            <button
              key={id}
              ref={(el) => {
                buttons.current[id] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-controls={`panel-${id}`}
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              className="tab"
              onClick={() => select(id)}
              onKeyDown={(e) => {
                const to = {
                  ArrowRight: (i + 1) % 2,
                  ArrowLeft: (i + 1) % 2,
                  Home: 0,
                  End: 1,
                }[e.key];
                if (to === undefined) return;
                e.preventDefault();
                select(TABS[to][0], true);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {TABS.map(([id]) => (
          <div
            key={id}
            id={`panel-${id}`}
            role="tabpanel"
            aria-labelledby={`tab-${id}`}
            className="tab-panel"
            tabIndex={0}
            hidden={tab !== id}
          >
            {built.has(id) &&
              (id === 'technical' ? <TechnicalPanel /> : <RequestersPanel />)}
          </div>
        ))}
      </section>
    </div>
  );
}

function RequestersPanel(): JSX.Element {
  return (
    <div className="stack-xl">
      <ol className="journey">
        {JOURNEY.map((s, i) => (
          <li key={s.title} className="j-item">
            <div className="j-top">
              <span className="j-num" aria-hidden="true">
                {i + 1}
              </span>
              <span className="j-who">{s.who}</span>
            </div>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </li>
        ))}
      </ol>
      <div className="stack-lg cv">
        <div className="section-head">
          <h2>After go-live: intent, spec, plan, build</h2>
          <p className="muted">
            Every change is written down, approved by a person and committed
            before the next stage starts.
          </p>
        </div>
        <LoopTour
          stages={STAGES}
          legend={
            <ul className="legend kinds" aria-label="Stage types">
              {Object.entries(KIND).map(([k, v]) => (
                <li key={k}>
                  <span className={`swatch kind-${k}`} aria-hidden="true" />
                  {v}
                </li>
              ))}
            </ul>
          }
          renderDetail={(i) => {
            const s = STAGES[i];
            return (
              <>
                <div className="loop-detail-head">
                  <span className={`kind-tag kind-${s.kind}`}>
                    <span
                      className={`swatch kind-${s.kind}`}
                      aria-hidden="true"
                    />
                    {KIND[s.kind]}
                  </span>
                  <code className="mono-chip">{s.file}</code>
                </div>
                <h3>
                  {i + 1}. {s.label}
                </h3>
                <p>{s.text}</p>
                <dl className="kv compact">
                  <dt>Done by</dt>
                  <dd>{s.by}</dd>
                  <dt>Approved by</dt>
                  <dd>{s.approves}</dd>
                </dl>
              </>
            );
          }}
        />
      </div>
    </div>
  );
}

function TechnicalPanel(): JSX.Element {
  return (
    <div className="stack-xl">
      <div className="section-head">
        <h2>Behind the portal</h2>
        <p className="muted">
          The portal sends identifiers only. The engine or the factory workflow
          creates everything; the portal holds no Azure rights.
        </p>
      </div>
      <ArchitectureFigure />
      <div className="stack-lg cv">
        <div className="section-head">
          <h2>The generated app</h2>
          <p className="muted">
            React served by a .NET backend that handles Entra sign-in. Tokens
            never reach the browser.
          </p>
        </div>
        <AppFigure />
      </div>
    </div>
  );
}
