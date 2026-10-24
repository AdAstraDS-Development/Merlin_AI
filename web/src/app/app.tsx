import { useEffect, useRef, useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../components/icon';
import { Skeleton } from '../components/status';
import { describeError } from '../lib/api-client';
import { factoryApi, factoryApiMode, queryKeys } from '../lib/factory-api';
import { readStorage, toast, writeStorage } from '../lib/format';
import type { FactoryInfo } from '../lib/factory-types';
import { AppDetailView } from './app-detail-view';
import { AppsView } from './apps-view';
import { BoardView } from './board-view';
import { HomeView } from './home-view';
import { HowView } from './how-view';
import { LoadError } from './load-error';
import { NewAppView } from './new-app-view';
import { RunView } from './run-view';

interface Route {
  name: string;
  param?: string;
  query: URLSearchParams;
  key: string;
}

function parseHash(): Route {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  return {
    name: parts[0] || 'home',
    param: parts[1] ? decodeURIComponent(parts[1]) : undefined,
    query: new URLSearchParams(query),
    key: path,
  };
}

const ROUTES = ['home', 'how', 'new', 'run', 'apps', 'app', 'board'];
const navigate = (hash: string): void => {
  location.hash = hash;
};

// ---- Theme
type Theme = 'light' | 'dark';
const THEME_KEY = 'merlin.theme';
const local = (): Storage => localStorage;
const systemDark = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;

function useTheme(): [Theme, () => void] {
  const [chosen, setChosen] = useState<Theme | null>(() => {
    const saved = readStorage(local, THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : null;
  });
  const [dark, setDark] = useState(systemDark);
  useEffect(() => {
    if (chosen) document.documentElement.dataset.theme = chosen;
    else delete document.documentElement.dataset.theme;
  }, [chosen]);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = (): void => setDark(mq.matches);
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  const effective: Theme = chosen ?? (dark ? 'dark' : 'light');
  const toggle = (): void => {
    const next: Theme = effective === 'dark' ? 'light' : 'dark';
    writeStorage(local, THEME_KEY, next);
    setChosen(next);
  };
  return [effective, toggle];
}

export function App(): JSX.Element {
  const queryClient = useQueryClient();
  const [route, setRoute] = useState(parseHash);
  const [theme, toggleTheme] = useTheme();
  const [message, setMessage] = useState<string | null>(null);
  const main = useRef<HTMLElement>(null);
  const info = useQuery({
    queryKey: queryKeys.info,
    queryFn: factoryApi.info,
    staleTime: Infinity,
  });

  useEffect(() => {
    const sync = (): void => setRoute(parseHash());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  useEffect(() => {
    if (!ROUTES.includes(route.name)) navigate('#/');
  }, [route.name]);
  // Page width and per-view styles key off the body, as in the portal.
  useEffect(() => {
    document.body.dataset.view = route.name;
  }, [route.name]);
  useEffect(() => {
    window.scrollTo(0, 0);
    // Views render their heading once their data is there; until then focus the page.
    const target = main.current?.querySelector('h1') ?? main.current;
    target?.setAttribute('tabindex', '-1');
    target?.focus({ preventScroll: true });
  }, [route.key]);
  useEffect(() => {
    let timer = 0;
    const show = (e: Event): void => {
      setMessage((e as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = window.setTimeout(() => setMessage(null), 6000);
    };
    document.addEventListener('merlin:toast', show);
    return () => {
      document.removeEventListener('merlin:toast', show);
      clearTimeout(timer);
    };
  }, []);

  // Simulation: one click starts a dry run of a sample app and opens its live progress.
  const simulate = useMutation({
    mutationFn: () => factoryApi.demo(),
    onSuccess: ({ runId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.apps });
      navigate(`#/run/${runId}`);
    },
    onError: (e) => toast(describeError(e)),
  });
  const runSimulation = (): void => {
    if (!simulate.isPending) simulate.mutate();
  };

  const section = ['run', 'app', 'board'].includes(route.name)
    ? 'apps'
    : route.name;
  const dark = theme === 'dark';

  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          main.current?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/" aria-label="Merlin, home">
            <BrandMark />
            <span className="brand-name">
              <b>Merlin</b>
            </span>
          </a>
          <nav className="nav" aria-label="Main">
            {[
              ['apps', 'Apps'],
              ['how', 'How it works'],
              ['new', 'New app'],
            ].map(([id, label]) => (
              <a
                key={id}
                href={`#/${id}`}
                className={id === 'new' ? 'nav-cta' : undefined}
                aria-current={section === id ? 'page' : undefined}
              >
                {label}
              </a>
            ))}
          </nav>
          <button
            type="button"
            className="btn small"
            hidden={!info.data?.demo}
            disabled={simulate.isPending}
            title="Runs a complete dry run of a sample app and shows its progress"
            onClick={runSimulation}
          >
            Simulate
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={toggleTheme}
          >
            <Icon name={dark ? 'sun' : 'moon'} size={20} />
          </button>
        </div>
      </header>
      <main id="main" ref={main} tabIndex={-1}>
        {info.isPending ? (
          <div className="container">
            <Skeleton rows={4} />
          </div>
        ) : info.isError ? (
          <LoadError error={info.error} retry={() => void info.refetch()} />
        ) : (
          <View route={route} info={info.data} onSimulate={runSimulation} />
        )}
      </main>
      <footer className="site-footer">
        <p>
          {factoryApiMode === 'simulated'
            ? 'Simulated in this browser: nothing is created. Never enter secrets.'
            : 'Never enter secrets.'}
        </p>
      </footer>
      <div
        className="sr-only"
        id="announcer"
        aria-live="polite"
        aria-atomic="true"
      />
      {message && (
        <div className="toast" role="alert">
          <Icon name="warning" size={16} />
          <span>{message}</span>
        </div>
      )}
    </>
  );
}

function View({
  route,
  info,
  onSimulate,
}: {
  route: Route;
  info: FactoryInfo;
  onSimulate: () => void;
}): JSX.Element | null {
  const param = route.param ?? '';
  switch (route.name) {
    case 'home':
      return <HomeView info={info} onSimulate={onSimulate} />;
    case 'how':
      return <HowView initialTab={route.query.get('tab')} />;
    case 'new':
      return <NewAppView info={info} navigate={navigate} />;
    case 'run':
      return <RunView key={param} id={param} />;
    case 'apps':
      return <AppsView />;
    case 'app':
      return <AppDetailView key={param} slug={param} />;
    case 'board':
      return <BoardView key={param} slug={param} demo={info.demo} />;
    default:
      return null;
  }
}

function BrandMark(): JSX.Element {
  const px: [number, number][] = [
    [6, 8],
    [22, 8],
    [6, 12],
    [10, 12],
    [18, 12],
    [22, 12],
    [6, 16],
    [14, 16],
    [22, 16],
    [6, 20],
    [22, 20],
    [6, 24],
    [22, 24],
  ];
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 32 32"
      width="28"
      height="28"
      aria-hidden="true"
      focusable="false"
      shapeRendering="crispEdges"
    >
      <rect className="bg" width="32" height="32" rx="3" />
      {px.map(([x, y]) => (
        <rect
          key={`${x}-${y}`}
          className="px"
          x={x}
          y={y}
          width="4"
          height="4"
        />
      ))}
      <rect className="px" x="26" y="4" width="2" height="2" />
    </svg>
  );
}
