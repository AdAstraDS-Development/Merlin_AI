import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Icon } from './icon';
import { reducedMotion } from '../lib/format';

export interface LoopStage {
  label: string;
  kind: 'human' | 'agent' | 'auto';
  text: string;
}

const CX = 320;
const CY = 320;
const R = 236;
const NODE_R = 47;
const f1 = (v: number): string => v.toFixed(1);
const pt = (deg: number, r = R): [number, number] => [
  CX + r * Math.cos((deg * Math.PI) / 180),
  CY + r * Math.sin((deg * Math.PI) / 180),
];

/**
 * Circular diagram of the development loop with a detail panel.
 * Wide containers show the circle, narrow ones a list of stage buttons (container query in CSS); both stay in sync.
 * The loop advances on its own only while it is visible and nobody hovers, focuses or pauses it.
 */
export function LoopTour({
  stages,
  legend,
  renderDetail,
}: {
  stages: LoopStage[];
  legend: ReactNode;
  renderDetail: (i: number) => ReactNode;
}): JSX.Element {
  const n = stages.length;
  const [motionOff] = useState(reducedMotion);
  const [observable] = useState(() => 'IntersectionObserver' in window);
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [inside, setInside] = useState(false);
  const [visible, setVisible] = useState(false);
  const [seen, setSeen] = useState(false);
  const [docHidden, setDocHidden] = useState(() => document.hidden);
  const fig = useRef<HTMLDivElement>(null);
  const nodes = useRef<(SVGGElement | null)[]>([]);
  const chips = useRef<(HTMLButtonElement | null)[]>([]);
  const playing =
    !userPaused && !hovering && !inside && visible && !docHidden && !motionOff;
  const drawn = motionOff || !observable || seen;

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setActive((a) => (a + 1) % n);
      setAuto(true);
    }, 5000);
    return () => clearInterval(t);
  }, [playing, n]);

  useEffect(() => {
    const sync = (): void => setDocHidden(document.hidden);
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  useEffect(() => {
    if (motionOff || !observable || !fig.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        const v = entries.some((e) => e.isIntersecting);
        setVisible(v);
        if (v) setSeen(true);
      },
      { threshold: 0.35 },
    );
    io.observe(fig.current);
    return () => io.disconnect();
  }, [motionOff, observable]);

  const choose = (i: number): void => {
    setActive(i);
    setAuto(false);
  };
  const move = (
    e: KeyboardEvent,
    i: number,
    items: (HTMLElement | SVGGElement | null)[],
  ): void => {
    const to = {
      ArrowRight: (i + 1) % n,
      ArrowDown: (i + 1) % n,
      ArrowLeft: (i - 1 + n) % n,
      ArrowUp: (i - 1 + n) % n,
      Home: 0,
      End: n - 1,
    }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    choose(to);
    items[to]?.focus();
  };

  const step = 360 / n;
  const gap = ((NODE_R + 8) / R) * (180 / Math.PI);
  const showPause = !userPaused && !motionOff;
  const s = stages[active];

  return (
    <>
      <div className="fig-bar">
        {legend}
        <button
          type="button"
          className="btn small ghost loop-play"
          hidden={motionOff}
          aria-label={
            showPause
              ? 'Pause the automatic tour of the stages'
              : 'Play the automatic tour of the stages'
          }
          onClick={() => setUserPaused((p) => !p)}
        >
          <Icon name={showPause ? 'pause' : 'play'} size={14} />
          {showPause ? 'Pause tour' : 'Play tour'}
        </button>
      </div>
      <div className="loop-wrap">
        <div
          ref={fig}
          className={`loop-fig${drawn ? ' drawn' : ''}${playing ? ' is-playing' : ''}`}
          onPointerEnter={() => setHovering(true)}
          onPointerLeave={() => setHovering(false)}
          onFocus={() => setInside(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null))
              setInside(false);
          }}
        >
          <svg
            className="loop-svg"
            viewBox="0 0 640 640"
            role="group"
            aria-label={`The AI-native development loop in ${n} stages`}
            focusable="false"
          >
            <defs>
              <marker
                id="loop-arrow"
                viewBox="0 0 10 10"
                refX="7"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M1 1.5L8 5L1 8.5" className="loop-arrowhead" />
              </marker>
            </defs>
            <circle className="loop-track" cx={CX} cy={CY} r={R} />
            {stages.map((_, i) => {
              const [x0, y0] = pt(-90 + i * step + gap);
              const [x1, y1] = pt(-90 + (i + 1) * step - gap);
              return (
                <path
                  key={i}
                  className={`loop-arc${i === active ? ' next' : ''}`}
                  style={{ ['--k' as string]: String(i) }}
                  pathLength={1}
                  markerEnd="url(#loop-arrow)"
                  d={`M${f1(x0)} ${f1(y0)} A${R} ${R} 0 0 1 ${f1(x1)} ${f1(y1)}`}
                />
              );
            })}
            {stages.map((st, i) => {
              const [x, y] = pt(-90 + i * step);
              return (
                <g
                  key={i}
                  ref={(el) => {
                    nodes.current[i] = el;
                  }}
                  className={`loop-node kind-${st.kind}${i === active ? ' active' : ''}`}
                  role="button"
                  tabIndex={i === active ? 0 : -1}
                  aria-pressed={i === active}
                  aria-label={`Stage ${i + 1}, ${st.label}: ${st.text}`}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && choose(i)}
                  onClick={() => choose(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      choose(i);
                    } else move(e, i, nodes.current);
                  }}
                >
                  <circle
                    className="halo"
                    cx={f1(x)}
                    cy={f1(y)}
                    r={NODE_R + 8}
                  />
                  <circle className="disc" cx={f1(x)} cy={f1(y)} r={NODE_R} />
                  <text
                    className="num"
                    x={f1(x)}
                    y={f1(y - 10)}
                    textAnchor="middle"
                  >
                    {i + 1}
                  </text>
                  <text
                    className="lbl"
                    x={f1(x)}
                    y={f1(y + 14)}
                    textAnchor="middle"
                  >
                    {st.label}
                  </text>
                </g>
              );
            })}
            <g className="loop-center">
              <text x={CX} y={CY - 14} textAnchor="middle" className="c1">
                AI-native
              </text>
              <text x={CX} y={CY + 16} textAnchor="middle" className="c1">
                development loop
              </text>
              <text x={CX} y={CY + 46} textAnchor="middle" className="c2">
                every change starts as an intent
              </text>
            </g>
          </svg>
          <ol
            className="loop-chips"
            aria-label="Stages of the development loop"
          >
            {stages.map((st, i) => (
              <li key={i}>
                <button
                  ref={(el) => {
                    chips.current[i] = el;
                  }}
                  type="button"
                  className={`loop-chip kind-${st.kind}`}
                  tabIndex={i === active ? 0 : -1}
                  aria-pressed={i === active}
                  onClick={() => choose(i)}
                  onKeyDown={(e) => move(e, i, chips.current)}
                >
                  <span className="chip-n">{i + 1}</span>
                  {st.label}
                </button>
              </li>
            ))}
          </ol>
        </div>
        <div
          className={`loop-detail kind-${s.kind}`}
          aria-live={auto ? 'off' : 'polite'}
        >
          {renderDetail(active)}
        </div>
      </div>
    </>
  );
}
