import type { AppStatus, CheckState } from './factory-types';

export const APP_STATUS: Record<AppStatus, string> = {
  requested: 'Saved, not started',
  'awaiting-approval': 'Waiting for approval',
  provisioning: 'Being created',
  live: 'Live',
  degraded: 'Degraded',
  failed: 'Failed',
  simulated: 'Simulated',
  decommissioned: 'Decommissioned',
};

/** Status vocabulary shared by checks and edges: icon + word, never color alone. */
export const CHECK_ICON = {
  pass: 'check',
  warn: 'warning',
  fail: 'x',
  unknown: 'help',
} as const satisfies Record<CheckState, string>;

export const STATUS_ICON = {
  live: 'check',
  degraded: 'warning',
  failed: 'x',
  provisioning: 'clock',
  'awaiting-approval': 'clock',
  simulated: 'eye',
  requested: 'dash',
  decommissioned: 'dash',
} as const satisfies Record<AppStatus, string>;

export const MODEL: Record<string, string> = {
  'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-opus-5-5': 'Opus 5.5',
  'claude-haiku-5-5': 'Haiku 5.5',
};
