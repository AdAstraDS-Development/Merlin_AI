import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { Icon } from './icon';
import { reducedMotion } from '../lib/format';

type FlowKind = 'req' | 'fac' | 'oidc' | 'ai';
const FLOW_KINDS: [FlowKind, string][] = [
  ['req', 'Local engine'],
  ['fac', 'Factory workflow'],
  ['oidc', 'OIDC sign-in'],
  ['ai', 'AI review'],
];

/** Highlighted ids: a figure element is highlighted when one of its ids is in the set. */
type Hl = (ids: string) => string;
const noHl: Hl = () => '';

function Markers({ prefix }: { prefix: string }): JSX.Element {
  return (
    <defs>
      {FLOW_KINDS.map(([k]) => (
        <marker
          key={k}
          id={`${prefix}arrow-${k}`}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path className={`ah k-${k}`} d="M1 1.5L8.5 5L1 8.5z" />
        </marker>
      ))}
    </defs>
  );
}

function Box({
  id,
  x,
  y,
  w,
  h,
  title,
  sub,
  cls,
  hl,
}: {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub: string;
  cls: string;
  hl: Hl;
}): JSX.Element {
  return (
    <g className={`node ${cls} ${hl(id)}`}>
      <rect x={x} y={y} width={w} height={h} rx="10" />
      <text className="n-title" x={x + 14} y={y + 27}>
        {title}
      </text>
      {sub.split('|').map((l, i) => (
        <text key={i} className="n-sub" x={x + 14} y={y + 48 + i * 17}>
          {l}
        </text>
      ))}
    </g>
  );
}

function Flow({
  id,
  kind,
  d,
  hl,
}: {
  id: string;
  kind: FlowKind;
  d: string;
  hl: Hl;
}): JSX.Element {
  const [prefix, short] = id.split('-');
  return (
    <path
      id={id}
      className={`flow k-${kind} ${hl(short)}`}
      markerEnd={`url(#${prefix}-arrow-${kind})`}
      d={d}
    />
  );
}

/** A label that knocks the line out behind it, so text never collides with a path. */
function Label({
  x,
  y,
  text,
  cls = '',
}: {
  x: number;
  y: number;
  text: string;
  cls?: string;
}): JSX.Element {
  const lines = text.split('\n');
  const w = Math.max(...lines.map((l) => l.length)) * 7 + 18;
  const h = lines.length * 17 + 8;
  return (
    <g className={`p-label ${cls}`}>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx="6" />
      {lines.map((l, i) => (
        <text
          key={i}
          x={x}
          y={y - ((lines.length - 1) * 17) / 2 + i * 17 + 4.5}
          textAnchor="middle"
        >
          {l}
        </text>
      ))}
    </g>
  );
}

function Particles({
  paths,
}: {
  paths: [string, FlowKind, number][];
}): JSX.Element {
  return (
    <>
      {paths.map(([id, k, dur], i) => (
        <circle key={id} className={`particle k-${k}`} r="3.6">
          <animateMotion
            dur={`${dur}s`}
            begin={`${(i % 3) * 0.7}s`}
            repeatCount="indefinite"
            calcMode="linear"
          >
            <mpath href={`#${id}`} />
          </animateMotion>
        </circle>
      ))}
    </>
  );
}

/** Pause control for continuously moving figures (WCAG 2.2.2). */
function useMotion(): {
  svg: React.RefObject<SVGSVGElement | null>;
  paused: boolean;
  toggle: ReactNode;
} {
  const [motionOff] = useState(reducedMotion);
  const [paused, setPaused] = useState(motionOff);
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (paused) svg.current?.pauseAnimations?.();
    else svg.current?.unpauseAnimations?.();
  }, [paused]);
  const toggle = (
    <button
      type="button"
      className="btn small ghost"
      hidden={motionOff}
      onClick={() => setPaused((p) => !p)}
    >
      <Icon name={paused ? 'play' : 'pause'} size={14} />
      {paused ? 'Play motion' : 'Pause motion'}
    </button>
  );
  return { svg, paused, toggle };
}

function LineSwatch({ kind }: { kind: FlowKind }): JSX.Element {
  return (
    <svg
      className="line-swatch"
      width="34"
      height="10"
      viewBox="0 0 34 10"
      aria-hidden="true"
      focusable="false"
    >
      <path className={`flow k-${kind}`} d="M2 5H32" />
    </svg>
  );
}

function StackNode({
  title,
  sub,
  cls = '',
  children,
}: {
  title: string;
  sub: string;
  cls?: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <li className={`stk-node ${cls}`}>
      <strong>{title}</strong>
      <span>{sub}</span>
      {children}
    </li>
  );
}

// ------------------------------------------------------------------ factory architecture

const GH_NODES: [string, string, string][] = [
  ['repo', 'Repository', 'Template export, first commit'],
  ['envs', 'Environments', 'Variables, required reviewers'],
  ['prot', 'Branch protection', 'Pull request required'],
  ['wf', 'Workflows', 'CI, Infrastructure, Release'],
];
const AZ_NODES: [string, string, string][] = [
  ['rg', 'Resource groups', 'Shared and one per environment'],
  ['state', 'Terraform state', 'Versioned blob storage'],
  ['app', 'App Service', 'Linux, health check, one per environment'],
  [
    'ids',
    '3 identities',
    'Plan, Infrastructure, Deploy; federated credentials',
  ],
];
const CALLOUTS = [
  {
    id: 'secrets',
    hl: 'portal',
    title: 'No secrets',
    text: 'Requests hold identifiers and text only.',
  },
  {
    id: 'allow',
    hl: 'portal local factory',
    title: 'Allowlists',
    text: 'Tenants, subscriptions, regions and owners are set by the platform team.',
  },
  {
    id: 'approval',
    hl: 'gate factory',
    title: 'Approval gate',
    text: 'Factory runs wait for a person to release them.',
  },
  {
    id: 'oidc',
    hl: 'wf ids p8 p9',
    title: 'OIDC',
    text: 'Short-lived Azure tokens, no client secrets in GitHub.',
  },
  {
    id: 'least',
    hl: 'ids rg state',
    title: 'Least privilege',
    text: 'Plan reads, Infrastructure applies, Deploy updates the web app.',
  },
  {
    id: 'prod',
    hl: 'envs app',
    title: 'Production gate',
    text: 'Required reviewers; an agent cannot approve.',
  },
  {
    id: 'local',
    hl: 'local',
    title: 'Local mode',
    text: 'Acts with your own sign-ins, after you confirm.',
  },
  {
    id: 'ai',
    hl: 'foundry wf',
    title: 'Claude via Foundry',
    text: 'Reviews and triage stay in your tenant.',
  },
];

/** Architecture of the factory with its legend, motion control and highlight callouts. */
export function ArchitectureFigure(): JSX.Element {
  const { svg, paused, toggle } = useMotion();
  const [pinned, setPinned] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const current = CALLOUTS.find((c) => c.id === (hover ?? pinned));
  const active = new Set(current?.hl.split(' ') ?? []);
  const hl: Hl = (ids) =>
    ids.split(' ').some((id) => active.has(id)) ? 'hl' : '';
  const n = (
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    title: string,
    sub: string,
    cls: string,
  ): JSX.Element => (
    <Box
      id={id}
      x={x}
      y={y}
      w={w}
      h={h}
      title={title}
      sub={sub}
      cls={cls}
      hl={hl}
    />
  );
  const f = (id: string, kind: FlowKind, d: string): JSX.Element => (
    <Flow id={id} kind={kind} d={d} hl={hl} />
  );
  const item = (
    id: string,
    title: string,
    sub: string,
    cls = '',
  ): JSX.Element => (
    <StackNode key={id} title={title} sub={sub} cls={`${cls} ${hl(id)}`} />
  );

  return (
    <>
      <div className="fig-card">
        <div className="fig-bar">
          <ul className="legend flows" aria-label="Line types">
            {FLOW_KINDS.map(([k, v]) => (
              <li key={k}>
                <LineSwatch kind={k} />
                {v}
              </li>
            ))}
          </ul>
          {toggle}
        </div>
        <div
          className={`fig arch-fig${paused ? ' is-paused' : ''}${current ? ' has-hl' : ''}`}
        >
          <div className="fig-svg">
            <svg
              ref={svg}
              className="arch-svg"
              viewBox="0 0 1090 690"
              role="img"
              aria-labelledby="arch-title arch-desc"
              focusable="false"
            >
              <title id="arch-title">Merlin architecture</title>
              <desc id="arch-desc">
                The portal sends a request either to the local engine or,
                through an approval gate, to the factory workflow. Both create
                the GitHub repository and the Azure resources. GitHub workflows
                reach Azure through OIDC and Microsoft Foundry reviews pull
                requests.
              </desc>
              <Markers prefix="arch-" />
              <g className={`group ${hl('github')}`}>
                <rect x="600" y="16" width="430" height="232" rx="16" />
                <text className="g-title" x="622" y="42">
                  GitHub
                </text>
              </g>
              <g className={`group ${hl('azure')}`}>
                <rect x="600" y="372" width="430" height="300" rx="16" />
                <text className="g-title" x="622" y="398">
                  Azure
                </text>
              </g>
              {f('arch-p1', 'req', 'M170 285 C235 285 235 140 300 140')}
              {f('arch-p2', 'fac', 'M170 305 C235 305 235 432 300 432')}
              {f('arch-p3', 'req', 'M475 120 C545 120 545 94 620 94')}
              {f('arch-p4', 'req', 'M475 160 C560 210 560 450 620 450')}
              {f('arch-p5', 'fac', 'M475 405 C550 360 550 184 620 184')}
              {f('arch-p6', 'fac', 'M475 450 C550 450 550 551 620 551')}
              {f('arch-p7', 'ai', 'M917 222 L917 272')}
              {f('arch-p8', 'oidc', 'M1010 184 C1044 184 1044 551 1010 551')}
              {f('arch-p9', 'oidc', 'M825 551 L797 551')}
              {n(
                'portal',
                20,
                250,
                150,
                90,
                'Portal',
                'Browser and|local API',
                'n-portal',
              )}
              {n(
                'local',
                300,
                100,
                175,
                80,
                'Local engine',
                'Your az and gh sign-in',
                'n-local',
              )}
              {n(
                'factory',
                300,
                380,
                175,
                110,
                'Factory workflow',
                'GitHub Actions',
                'n-factory',
              )}
              <g className={`node n-gate ${hl('gate')}`}>
                <rect x="314" y="452" width="120" height="26" rx="13" />
                <text
                  x="374"
                  y="469.5"
                  textAnchor="middle"
                  className="n-gate-t"
                >
                  Approval gate
                </text>
              </g>
              {n(
                'repo',
                620,
                56,
                175,
                76,
                'Repository',
                'Template export,|first commit',
                'n-gh',
              )}
              {n(
                'envs',
                825,
                56,
                185,
                76,
                'Environments',
                'Variables,|required reviewers',
                'n-gh',
              )}
              {n(
                'prot',
                620,
                146,
                175,
                76,
                'Branch protection',
                'Pull request required',
                'n-gh',
              )}
              {n(
                'wf',
                825,
                146,
                185,
                76,
                'Workflows',
                'CI, Infrastructure,|Release',
                'n-gh',
              )}
              {n(
                'foundry',
                700,
                272,
                270,
                64,
                'Microsoft Foundry',
                'Claude for review and build triage',
                'n-ai',
              )}
              {n(
                'rg',
                620,
                412,
                175,
                76,
                'Resource groups',
                'Shared and one|per environment',
                'n-az',
              )}
              {n(
                'state',
                825,
                412,
                185,
                76,
                'Terraform state',
                'Versioned|blob storage',
                'n-az',
              )}
              {n(
                'app',
                620,
                508,
                175,
                86,
                'App Service',
                'Linux, health check|one per environment',
                'n-az',
              )}
              {n(
                'ids',
                825,
                508,
                185,
                86,
                '3 identities',
                'Plan, Infrastructure,|Deploy; federated',
                'n-az',
              )}
              <text className="g-note" x="622" y="628">
                Roles are scoped to resource groups, never to the subscription.
              </text>
              <text className="g-note" x="622" y="650">
                No stored credentials: GitHub Actions signs in with OIDC.
              </text>
              <Label x={235} y={212} text="Local mode" />
              <Label x={235} y={368} text={'Issue and\ndispatch'} />
              <Label x={548} y={298} text={'Create and\nconfigure'} />
              <Label x={1044} y={368} text="OIDC" cls="k-oidc" />
              <Particles
                paths={[
                  ['arch-p1', 'req', 4],
                  ['arch-p2', 'fac', 4.4],
                  ['arch-p3', 'req', 3.6],
                  ['arch-p4', 'req', 5.2],
                  ['arch-p5', 'fac', 5.2],
                  ['arch-p6', 'fac', 3.4],
                  ['arch-p7', 'ai', 2.2],
                  ['arch-p8', 'oidc', 5.6],
                  ['arch-p9', 'oidc', 1.8],
                ]}
              />
            </svg>
          </div>
          <div className="arch-stack">
            <ol className="stk-flow">
              <li className="stk-step">
                <ul className="stk-row">
                  {item('portal', 'Portal', 'Browser and local API')}
                </ul>
              </li>
              <li className="stk-step">
                <p className="stk-label">Two ways to run a request</p>
                <ul className="stk-row">
                  {item(
                    'local',
                    'Local engine',
                    'Your az and gh sign-in',
                    'k-req',
                  )}
                  <StackNode
                    title="Factory workflow"
                    sub="GitHub Actions"
                    cls={`k-fac ${hl('factory')}`}
                  >
                    <span className={`gate-chip ${hl('gate')}`}>
                      <Icon name="shield" size={14} />
                      Approval gate first
                    </span>
                  </StackNode>
                </ul>
              </li>
              <li className="stk-step">
                <p className="stk-label">Both create and configure</p>
                <div className={`stk-group ${hl('github')}`}>
                  <h4>GitHub</h4>
                  <ul className="stk-row">
                    {GH_NODES.map(([id, t, s]) => item(id, t, s))}
                  </ul>
                </div>
                <div className={`stk-group ${hl('azure')}`}>
                  <h4>Azure</h4>
                  <ul className="stk-row">
                    {AZ_NODES.map(([id, t, s]) => item(id, t, s))}
                  </ul>
                  <p className="muted small">
                    Roles are scoped to resource groups, never to the
                    subscription. No stored credentials: GitHub Actions signs in
                    with OIDC.
                  </p>
                </div>
              </li>
              <li className="stk-step">
                <p className="stk-label">Connections</p>
                <ul className="stk-links">
                  {item(
                    'p8 p9',
                    'OIDC sign-in',
                    'Workflows get short-lived Azure tokens for the identities.',
                    'k-oidc',
                  )}
                  {item(
                    'foundry',
                    'Microsoft Foundry',
                    'Claude reviews pull requests and triages builds.',
                    'k-ai',
                  )}
                </ul>
              </li>
            </ol>
          </div>
        </div>
      </div>
      <ul className="callouts">
        {CALLOUTS.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className="callout"
              aria-pressed={pinned === c.id}
              onPointerEnter={(e) =>
                e.pointerType === 'mouse' && setHover(c.id)
              }
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(c.id)}
              onBlur={() => setHover(null)}
              onClick={() => setPinned((p) => (p === c.id ? null : c.id))}
            >
              <strong>{c.title}</strong>
              <span>{c.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

// ------------------------------------------------------------------ generated app

export function AppFigure(): JSX.Element {
  const { svg, paused, toggle } = useMotion();
  const n = (
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    title: string,
    sub: string,
    cls: string,
  ): JSX.Element => (
    <Box
      id={id}
      x={x}
      y={y}
      w={w}
      h={h}
      title={title}
      sub={sub}
      cls={cls}
      hl={noHl}
    />
  );
  return (
    <div className="fig-card">
      <div className="fig-bar">
        <span />
        {toggle}
      </div>
      <div className={`fig app-fig${paused ? ' is-paused' : ''}`}>
        <div className="fig-svg">
          <svg
            ref={svg}
            className="arch-svg app-svg"
            viewBox="0 0 940 270"
            role="img"
            aria-labelledby="app-title app-desc"
            focusable="false"
          >
            <title id="app-title">
              Architecture of a generated application
            </title>
            <desc id="app-desc">
              The browser talks to one .NET backend that also serves the React
              build. The backend signs users in with Microsoft Entra ID and
              keeps sessions on the server. The client secret comes from Key
              Vault.
            </desc>
            <Markers prefix="app-" />
            <g className="group">
              <rect x="300" y="20" width="370" height="232" rx="16" />
              <text className="g-title" x="320" y="46">
                App Service, one origin
              </text>
            </g>
            <Flow id="app-a1" kind="req" d="M180 125 L318 99" hl={noHl} />
            <Flow id="app-a2" kind="oidc" d="M652 99 L768 83" hl={noHl} />
            <Flow
              id="app-a3"
              kind="ai"
              d="M768 205 C720 205 700 150 652 128"
              hl={noHl}
            />
            {n(
              'browser',
              20,
              80,
              160,
              90,
              'Browser',
              'React UI|opaque cookie only',
              'n-portal',
            )}
            {n(
              'bff',
              320,
              64,
              330,
              70,
              '.NET backend (BFF)',
              'Sign-in, sessions, CSRF, /api/*',
              'n-az',
            )}
            {n('spa', 320, 156, 160, 76, 'React build', 'Static files', 'n-az')}
            {n(
              'sess',
              490,
              156,
              160,
              76,
              'Sessions',
              'Encrypted|on /home',
              'n-az',
            )}
            {n(
              'entra',
              770,
              36,
              150,
              90,
              'Microsoft Entra',
              'Code + PKCE|single tenant',
              'n-gh',
            )}
            {n(
              'kv',
              770,
              160,
              150,
              90,
              'Key Vault',
              'Client secret|via reference',
              'n-gh',
            )}
            <Label x={249} y={133} text="HTTPS + cookie" />
            <Label x={710} y={112} text="Server side" />
            <Particles
              paths={[
                ['app-a1', 'req', 2.4],
                ['app-a2', 'oidc', 2.2],
                ['app-a3', 'ai', 3],
              ]}
            />
          </svg>
        </div>
        <div className="arch-stack">
          <ol className="stk-flow">
            <li className="stk-step">
              <ul className="stk-row">
                <StackNode title="Browser" sub="React UI, opaque cookie only" />
              </ul>
            </li>
            <li className="stk-step">
              <p className="stk-label">HTTPS and cookie</p>
              <div className="stk-group">
                <h4>App Service, one origin</h4>
                <ul className="stk-row">
                  <StackNode
                    title=".NET backend (BFF)"
                    sub="Sign-in, sessions, CSRF, /api/*"
                  />
                  <StackNode title="React build" sub="Static files" />
                  <StackNode title="Sessions" sub="Encrypted on /home" />
                </ul>
              </div>
            </li>
            <li className="stk-step">
              <p className="stk-label">Server side only</p>
              <ul className="stk-row">
                <StackNode
                  title="Microsoft Entra"
                  sub="Code + PKCE, single tenant"
                  cls="k-oidc"
                />
                <StackNode
                  title="Key Vault"
                  sub="Client secret via reference"
                  cls="k-ai"
                />
              </ul>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
