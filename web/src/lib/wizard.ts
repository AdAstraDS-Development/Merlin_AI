// Draft, derivation and validation rules of the "New app" wizard. The server validates again.
import { readStorage, writeStorage } from './format';
import type { FactoryInfo, FactoryRequest } from './factory-types';

export const MAX_DESCRIPTION = 16000;
export const MAX_FILE = 200 * 1024;
export const TEXT_FILE =
  /\.(md|markdown|txt|csv|tsv|json|ya?ml|xml|html?|feature|rst|adoc)$/i;
export const TEXT_ACCEPT =
  '.md,.markdown,.txt,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm,.feature,.rst,.adoc';
export const RX = {
  appName: /^[A-Z][A-Za-z0-9]{1,39}$/,
  slug: /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
  suffix: /^[a-z0-9]{4,8}$/,
  repo: /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/,
  reviewer: /^[A-Za-z0-9-]{1,39}$/,
  link: /^https:\/\/\S+$/,
  costCenter: /^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/,
};
export const STEPS = [
  'Your idea',
  'Users and use cases',
  'Where it runs',
  'Review and start',
];
export const SUBS = [
  '',
  'Optional. The agent asks about anything missing.',
  '',
  'Nothing is created until you start.',
];
export const ADMIN_FIELDS = [
  'tenantId',
  'subscriptionId',
  'region',
  'owner',
  'repoName',
  'nameSuffix',
];
export const USER_HINTS = [
  'Employees',
  'Managers',
  'Administrators',
  'Customers',
  'External partners',
  'Support team',
];

export const OUTLINE = `## Today
How is this done now, and what goes wrong?

## Who uses it
-

## What they need to do
-

## Rules and constraints
-

## Systems it works with
-
`;

export const EXAMPLE = {
  text: 'Fleet Portal',
  problem:
    'Dispatchers plan vehicles in a shared spreadsheet, so double bookings are found too late.',
  description: `## Today
Dispatchers keep vehicle assignments in a shared Excel file. Conflicts show up when the driver arrives.

## What they need to do
- Dispatcher assigns a vehicle to a trip and sees conflicts immediately
- Driver sees today's trips on the phone
- Fleet manager reviews utilisation per week

## Rules and constraints
- Company sign-in only
- No personal data leaves the EU`,
  users: ['Dispatchers', 'Drivers', 'Fleet managers'],
  outcome:
    'One live assignment board; conflicts are prevented at booking time.',
};

export interface Draft {
  v: 2;
  step: number;
  text: string;
  appName: string;
  slug: string;
  repo: string;
  slugDirty: boolean;
  repoDirty: boolean;
  problem: string;
  description: string;
  outcome: string;
  users: string[];
  useCases: string[];
  useCasesSeeded: boolean;
  constraints: string[];
  documentLinks: string[];
  database: string;
  azure: {
    tenantId: string;
    subscriptionId: string;
    region: string;
    nameSuffix: string;
    production: boolean;
  };
  github: {
    owner: string;
    visibility: string;
    reviewers: string[];
    protectMain: boolean;
    runLocalValidation: boolean;
  };
  billing: { costCenter: string; tier: string } | null;
}
export type Errors = Record<string, string>;

function words(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}
export const toPascal = (t: string): string =>
  words(t)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('')
    .replace(/^[0-9]+/, '')
    .slice(0, 40);
export const toSlug = (t: string): string =>
  words(t)
    .map((w) => w.toLowerCase())
    .join('-')
    .replace(/^[0-9-]+/, '')
    .slice(0, 25)
    .replace(/-+$/, '');

/** Shortens a slug until its letters and digits fit the room left in the storage account name. */
export function fitSlug(slug: string, room: number): string {
  let s = slug;
  while (s.replaceAll('-', '').length > room)
    s = s.slice(0, -1).replace(/-+$/, '');
  return s;
}

/** Removes a leading bullet or number from a pasted line. */
export const stripBullet = (line: string): string =>
  line.replace(/^[ \t]*(?:[-*•]|\d+[.)])[ \t]+/, '').trim();

/** Bullet and numbered lines that are likely use cases: under a "what they need to do" style heading, or all of them when there are no headings. */
export function bulletLines(text: string): string[] {
  const out: string[] = [];
  let take = !/^#{1,6}\s/m.test(text);
  for (const line of text.split('\n')) {
    const head = /^#{1,6}\s+(.*)$/.exec(line);
    if (head) {
      take =
        /need|do|use case|feature|should|must|able|task/i.test(head[1]) &&
        !/rule|constraint|system|today|who/i.test(head[1]);
      continue;
    }
    const m = /^[ \t]*(?:[-*•]|\d+[.)])[ \t]+(.{8,300}?)[ \t]*$/.exec(line);
    if (take && m) out.push(m[1]);
  }
  return out;
}

const DRAFT_KEY = 'merlin.draft';
const COST_CENTER_KEY = 'merlin.costCenter';
const session = (): Storage => sessionStorage;
const local = (): Storage => localStorage;

export const rememberCostCenter = (v: string): void =>
  writeStorage(local, COST_CENTER_KEY, v.trim());

function defaultBilling(info: FactoryInfo): Draft['billing'] {
  const b = info.billing;
  if (!b) return null;
  const known = b.costCenters.map((c) => c.id);
  const last = readStorage(local, COST_CENTER_KEY) ?? '';
  return {
    costCenter: known.length ? (known.includes(last) ? last : known[0]) : last,
    tier: (b.tiers.find((t) => t.id === 'sandbox') ?? b.tiers[0])?.id ?? '',
  };
}

export function blankDraft(info: FactoryInfo): Draft {
  return {
    v: 2,
    step: 0,
    text: '',
    appName: '',
    slug: '',
    repo: '',
    slugDirty: false,
    repoDirty: false,
    problem: '',
    description: '',
    outcome: '',
    users: [],
    useCases: [],
    useCasesSeeded: false,
    constraints: [],
    documentLinks: [],
    database: 'none',
    azure: {
      tenantId: info.tenants[0] ?? '',
      subscriptionId: info.subscriptions[0]?.id ?? '',
      region: info.defaults.region ?? '',
      nameSuffix: info.defaults.nameSuffix,
      production: false,
    },
    github: {
      owner: info.allowedOwners[0] ?? '',
      visibility: 'private',
      reviewers: [],
      protectMain: true,
      runLocalValidation: false,
    },
    billing: defaultBilling(info),
  };
}

/** The saved draft, or a blank one; people who are not platform admins get the platform's targets. */
export function loadDraft(info: FactoryInfo): Draft {
  let d = blankDraft(info);
  try {
    const saved = JSON.parse(
      readStorage(session, DRAFT_KEY) ?? 'null',
    ) as Draft | null;
    if (saved?.v === 2)
      d = { ...saved, billing: saved.billing ?? defaultBilling(info) };
  } catch {
    /* no draft */
  }
  if (!info.databases.includes(d.database)) d.database = 'none';
  if (!info.isAdmin) {
    const t = info.defaults;
    d.azure = {
      ...d.azure,
      tenantId: t.tenantId ?? d.azure.tenantId,
      subscriptionId: t.subscriptionId ?? d.azure.subscriptionId,
      region: t.region ?? d.azure.region,
    };
    d.github = {
      ...d.github,
      owner: t.owner ?? d.github.owner,
      visibility: 'private',
      protectMain: true,
      runLocalValidation: false,
    };
    d.repo = d.slug;
    d.repoDirty = false;
  }
  return d;
}

export const saveDraft = (d: Draft): void =>
  writeStorage(session, DRAFT_KEY, JSON.stringify(d));
export const clearDraft = (): void => writeStorage(session, DRAFT_KEY, null);

export const storageRoom = (d: Draft, info: FactoryInfo): number =>
  info.sharedState ? 99 : 20 - d.azure.nameSuffix.length;

export function slugError(d: Draft, info: FactoryInfo): string | null {
  if (!RX.slug.test(d.slug) || d.slug.length < 3 || d.slug.length > 25)
    return 'Use 3 to 25 lowercase letters, digits and single hyphens, starting with a letter.';
  const room = storageRoom(d, info);
  if (d.slug.replaceAll('-', '').length > room)
    return `Too long for the Azure storage name: use at most ${room} letters and digits (hyphens do not count).`;
  return null;
}

export function validateStep(d: Draft, info: FactoryInfo, i: number): Errors {
  const e: Errors = {};
  const slug = slugError(d, info);
  if (i === 0) {
    if (!d.text.trim()) e.appName = 'Give the app a name.';
    else if (!RX.appName.test(d.appName))
      e.appName = 'Use at least two letters, starting with a letter.';
    if (slug) e.appSlug = slug;
    if (d.description.length > MAX_DESCRIPTION)
      e.description = `Shorten the description to ${MAX_DESCRIPTION.toLocaleString()} characters.`;
  }
  if (i === 1) {
    if (d.useCases.some((u) => u.length > 300))
      e.useCases = 'Keep each use case under 300 characters.';
    if (d.useCases.length > 50) e.useCases = 'At most 50 use cases.';
    if (d.users.length > 30 || d.users.some((u) => u.length > 200))
      e.users = 'At most 30 user groups of up to 200 characters.';
    if (d.constraints.length > 30 || d.constraints.some((c) => c.length > 300))
      e.constraints = 'At most 30 constraints of up to 300 characters.';
  }
  if (i === 2) {
    if (!d.azure.tenantId) e.tenantId = 'Choose a tenant.';
    if (!d.azure.subscriptionId) e.subscriptionId = 'Choose a subscription.';
    if (!d.azure.region) e.region = 'Choose a region.';
    if (!d.github.owner) e.owner = 'Choose an owner.';
    if (d.azure.production && d.github.reviewers.length === 0)
      e.reviewers = 'Add at least one reviewer for production releases.';
    if (info.billing && !d.billing?.costCenter)
      e.costCenter = 'Enter the cost center that pays for the app.';
    else if (info.billing && !RX.costCenter.test(d.billing?.costCenter ?? ''))
      e.costCenter =
        'Use letters, digits, dots, underscores and hyphens, for example CC-4711.';
    if (info.billing && !d.billing?.tier) e.tier = 'Choose a tier.';
    if (!RX.suffix.test(d.azure.nameSuffix))
      e.nameSuffix = 'Use 4 to 8 lowercase letters or digits.';
    else if (slug)
      e.nameSuffix = `With this suffix the identifier ${d.slug} is too long. Use a shorter suffix or change the identifier in step 1.`;
    if (
      !RX.repo.test(d.repo) ||
      /\.git$/i.test(d.repo) ||
      /^\.github(-private)?$/i.test(d.repo)
    )
      e.repoName =
        'Use letters, digits, dots, underscores and hyphens, starting with a letter or digit.';
  }
  return e;
}

export function requestBody(d: Draft, info: FactoryInfo): FactoryRequest {
  return {
    appName: d.appName,
    appSlug: d.slug,
    description: d.description.trim() || undefined,
    problem: d.problem.trim() || undefined,
    outcome: d.outcome.trim() || undefined,
    users: d.users,
    useCases: d.useCases,
    constraints: d.constraints,
    documentLinks: d.documentLinks,
    azure: {
      tenantId: d.azure.tenantId,
      subscriptionId: d.azure.subscriptionId,
      region: d.azure.region,
      nameSuffix: d.azure.nameSuffix,
      environments: d.azure.production
        ? ['development', 'production']
        : ['development'],
    },
    github: {
      owner: d.github.owner,
      repoName: d.repo,
      visibility: d.github.visibility,
      productionReviewers: d.azure.production ? d.github.reviewers : [],
    },
    options: {
      protectMain: d.github.protectMain,
      runLocalValidation: d.github.runLocalValidation,
      database: d.database,
    },
    billing:
      info.billing && d.billing
        ? { costCenter: d.billing.costCenter, tier: d.billing.tier }
        : undefined,
  };
}

/** Server error paths (for example github.productionReviewers[0]) as wizard field keys. */
export function fieldKey(path: string): string {
  const last =
    path
      .replace(/\[\d+\]$/, '')
      .split('.')
      .pop() ?? path;
  return (
    { productionReviewers: 'reviewers', environments: 'reviewers' }[last] ??
    last
  );
}

export function stepFor(key: string): number {
  if (/^(appName|appSlug|problem|description|documentLinks)$/.test(key))
    return 0;
  if (/^(outcome|users|useCases|constraints)$/.test(key)) return 1;
  return 2;
}
