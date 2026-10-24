import type { JSX, ReactNode } from 'react';
import { Icon, type IconName } from './icon';
import { APP_STATUS, CHECK_ICON, STATUS_ICON } from '../lib/factory-labels';
import type { AppStatus, CheckState } from '../lib/factory-types';

export function StatusBadge({
  status,
  label,
}: {
  status: AppStatus;
  label?: string;
}): JSX.Element {
  return (
    <span className={`badge st-${status}`}>
      <Icon name={STATUS_ICON[status] ?? 'dash'} size={14} />
      {label ?? APP_STATUS[status] ?? status}
    </span>
  );
}

export function StateMark({
  state,
  size = 16,
}: {
  state: CheckState;
  size?: number;
}): JSX.Element {
  return (
    <span className={`state-mark s-${state}`}>
      <Icon name={CHECK_ICON[state]} size={size} />
    </span>
  );
}

/** Placeholder blocks while a view loads. */
export function Skeleton({ rows = 3 }: { rows?: number }): JSX.Element {
  return (
    <div className="skeleton" aria-hidden="true">
      <span className="sk sk-title" />
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="sk sk-line" />
      ))}
    </div>
  );
}

export function StatePanel({
  icon = 'box',
  title,
  text,
  error = false,
  heading = 'h2',
  children,
}: {
  icon?: IconName;
  title: string;
  text?: string;
  error?: boolean;
  heading?: 'h1' | 'h2';
  children?: ReactNode;
}): JSX.Element {
  const Heading = heading;
  return (
    <div className={`state-panel${error ? ' is-error' : ''}`}>
      <Icon name={icon} size={28} />
      <Heading>{title}</Heading>
      {text && <p className="lead">{text}</p>}
      {children && <div className="btn-row">{children}</div>}
    </div>
  );
}
