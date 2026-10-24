// In-browser simulation of the factory backend (ai-sw-template factory/portal): example configuration,
// dry runs with their event stream, simulated costs, status checks and the feature board.
// State lives in sessionStorage, so a reload keeps the apps; nothing leaves the browser.
import { ApiError } from './api-client';
import { randomSuffix, readStorage, writeStorage } from './format';
import type { FactoryApi } from './factory-api';
import type {
  AppDetail,
  AppResources,
  AppStatus,
  AppSummary,
  BoardData,
  BoardStage,
  Check,
  CheckResult,
  CostEstimate,
  FactoryInfo,
  FactoryRequest,
  Feature,
  FeatureSource,
  FeatureStatus,
  ModeInfo,
  Names,
  RunEvent,
  RunMode,
  RunRef,
  RunSummary,
  StepDef,
} from './factory-types';

// ------------------------------------------------------------------ configuration (factory.config.example.json)

const GITHUB_HOST = 'github.com';
const TENANT = '00000000-0000-0000-0000-000000000000';
const CONFIG = {
  owners: ['contoso-apps'],
  tenants: [TENANT],
  subscriptions: [{ id: TENANT, name: 'apps-development' }],
  regions: ['westeurope', 'northeurope', 'germanywestcentral', 'swedencentral'],
  databases: ['azure-sql'],
  billing: {
    simulated: true,
    free: true,
    databaseMonthlyPerEnvironment: { 'azure-sql': 15 } as Record<
      string,
      number
    >,
    currency: 'EUR',
    platformFeePercent: 12,
    seatFeePerMonth: 15,
    costCenters: [],
    tiers: [
      {
        id: 'sandbox',
        name: 'Sandbox',
        monthlyPerEnvironment: 15,
        production: false,
        expiresDays: 30,
        summary: 'Try an idea. Development only, removed after 30 days.',
      },
      {
        id: 'standard',
        name: 'Standard',
        monthlyPerEnvironment: 75,
        production: true,
        summary: 'Internal apps, development and production.',
      },
      {
        id: 'critical',
        name: 'Business critical',
        monthlyPerEnvironment: 420,
        production: true,
        summary: 'Zone redundant, with backups.',
      },
    ],
  },
};
const UNAVAILABLE = 'Not available in the browser simulation.';
const MODES: ModeInfo[] = [
  { id: 'DryRun', available: true, reason: null, needsCheck: false },
  { id: 'Local', available: false, reason: UNAVAILABLE, needsCheck: false },
  { id: 'Factory', available: false, reason: UNAVAILABLE, needsCheck: false },
];
const REQUESTED_BY = 'you';

// ------------------------------------------------------------------ state

interface SimApp {
  slug: string;
  name: string;
  status: AppStatus;
  createdAt: string;
  updatedAt: string;
  requestedBy: string;
  request: FactoryRequest;
  resources: AppResources | null;
  check?: CheckResult;
  runs: RunRef[];
}
interface SimRun {
  summary: RunSummary;
  events: RunEvent[];
}
interface AddedFeature {
  title: string;
  kind: 'feature' | 'bug';
  source: FeatureSource;
  start: number;
}
interface SimState {
  apps: SimApp[];
  runs: SimRun[];
  added: Record<string, AddedFeature[]>;
}

const STATE_KEY = 'merlin.simulation';
const session = (): Storage => sessionStorage;

function loadState(): SimState {
  const empty: SimState = { apps: [], runs: [], added: {} };
  const raw = readStorage(session, STATE_KEY);
  if (!raw) return empty;
  try {
    const s = { ...empty, ...(JSON.parse(raw) as Partial<SimState>) };
    // A run cannot survive a reload of the page that played it.
    for (const r of s.runs.filter((x) => x.summary.status === 'running')) {
      r.summary.status = 'failed';
      r.events.push({
        type: 'result',
        at: new Date().toISOString(),
        status: 'failed',
        message: 'The page was reloaded while the simulation was running.',
      });
      const ref = s.apps
        .flatMap((a) => a.runs)
        .find((x) => x.id === r.summary.id);
      if (ref) ref.status = 'failed';
    }
    return s;
  } catch {
    return empty;
  }
}

let state = loadState();
const save = (): void =>
  writeStorage(session, STATE_KEY, JSON.stringify(state));
const listeners = new Map<string, Set<() => void>>();

/** Forgets every simulated app and run (used by tests). */
export function resetSimulation(): void {
  state = { apps: [], runs: [], added: {} };
  listeners.clear();
  save();
}

const now = (): string => new Date().toISOString();
const later = <T>(fn: () => T, ms = 120): Promise<T> =>
  new Promise<T>((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(fn());
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    }, ms),
  );
const notFound = (): ApiError =>
  new ApiError(404, { title: 'Not found', status: 404 });
const invalid = (errors: Record<string, string[]>): ApiError =>
  new ApiError(400, {
    title: 'The request is not valid.',
    status: 400,
    errors,
  });

function findApp(slug: string): SimApp {
  const a = state.apps.find((x) => x.slug === slug);
  if (!a) throw notFound();
  return a;
}

// ------------------------------------------------------------------ costs (Costs.cs)

function estimate(
  costCenterId: string | undefined,
  tierId: string | undefined,
  environments: number,
  seats: number,
  database = 'none',
): CostEstimate | null {
  const b = CONFIG.billing;
  const tier = b.tiers.find((t) => t.id === tierId);
  if (!tier) return null;
  const envs = Math.max(environments, 1);
  const dbPrice = b.databaseMonthlyPerEnvironment[database] ?? 0;
  const azure = (tier.monthlyPerEnvironment + dbPrice) * envs;
  const fee = round2((azure * b.platformFeePercent) / 100);
  const seatCost = b.seatFeePerMonth * seats;
  return {
    simulated: b.simulated,
    free: b.free,
    database,
    databaseMonthly: dbPrice * envs,
    currency: b.currency,
    tier: { id: tier.id, name: tier.name, expiresDays: tier.expiresDays },
    costCenter: costCenterId ? { id: costCenterId, name: '' } : null,
    environments,
    azureMonthly: azure,
    platformFeePercent: b.platformFeePercent,
    platformFee: fee,
    seats,
    seatFee: b.seatFeePerMonth,
    seatCost,
    totalMonthly: azure + fee + seatCost,
  };
}
const round2 = (v: number): number => Math.round(v * 100) / 100;
const seatsOf = (r: FactoryRequest): number =>
  1 + r.github.productionReviewers.length;
const costForRequest = (r: FactoryRequest): CostEstimate | null =>
  estimate(
    r.billing?.costCenter,
    r.billing?.tier,
    r.azure.environments.length,
    seatsOf(r),
    r.options.database,
  );

/** Estimate plus simulated month-to-date, forecast and budget state. */
function attachCost(a: SimApp, at: Date): CostEstimate | undefined {
  const est = costForRequest(a.request);
  if (!est) return undefined;
  if (['live', 'degraded', 'simulated'].includes(a.status)) {
    // A stable per-app factor between 0.80 and 1.15 makes the simulation look like real, varying usage.
    let h = 17;
    for (const c of a.slug) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
    const factor = 0.8 + ((h >>> 0) % 36) / 100;
    const days = new Date(
      Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0),
    ).getUTCDate();
    let start = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1);
    const created = Date.parse(a.createdAt);
    if (created > start) start = created;
    const share = Math.min(
      1,
      Math.max(0, (at.getTime() - start) / 86_400_000 / days),
    );
    const pct = est.platformFeePercent / 100;
    const mtd = round2(est.azureMonthly * factor * share);
    const forecast = round2(est.azureMonthly * factor);
    Object.assign(est, {
      monthToDate: mtd,
      forecast,
      budget: est.azureMonthly,
      budgetState:
        forecast > est.azureMonthly
          ? 'over'
          : forecast > est.azureMonthly * 0.9
            ? 'near'
            : 'ok',
      chargeMonthToDate: round2(mtd * (1 + pct) + est.seatCost * share),
      chargeForecast: round2(forecast * (1 + pct) + est.seatCost),
    });
  }
  if (est.tier.expiresDays)
    est.expiresAt = new Date(
      Date.parse(a.createdAt) + est.tier.expiresDays * 86_400_000,
    ).toISOString();
  return est;
}

// ------------------------------------------------------------------ names and steps (Preview.cs)

const STEPS: StepDef[] = [
  {
    id: 'validate',
    title: 'Validate request',
    description:
      'Checks the request against the schema and the platform allowlists.',
  },
  {
    id: 'prerequisites',
    title: 'Check tools and sign-ins',
    description:
      'Verifies tools, sign-ins and Azure resource provider registration.',
  },
  {
    id: 'export',
    title: 'Create the app from the template',
    description:
      'Generates the app including intent/001-initial/intent.md and the .tfvars files.',
  },
  {
    id: 'validate-app',
    title: 'Validate the app locally',
    description: 'Installs dependencies and runs pnpm validate (optional).',
  },
  {
    id: 'repository',
    title: 'Create the GitHub repository',
    description: 'Creates the repository and pushes the initial commit.',
  },
  {
    id: 'azure-groups',
    title: 'Create Azure resource groups',
    description: 'One shared group and one per environment.',
  },
  {
    id: 'azure-state',
    title: 'Create Terraform state storage',
    description: 'Creates or reuses the storage account for Terraform state.',
  },
  {
    id: 'azure-identities',
    title: 'Create deployment identities',
    description:
      'Plan, infrastructure and deploy identities with federated credentials and scoped roles.',
  },
  {
    id: 'github-setup',
    title: 'Configure GitHub',
    description: 'Creates environments, variables and branch protection.',
  },
  {
    id: 'infrastructure',
    title: 'Provision development',
    description:
      'Runs the Infrastructure workflow (plan and apply) for development.',
  },
  {
    id: 'release',
    title: 'Deploy the first release',
    description: 'Enables deployment and runs the Release workflow.',
  },
  {
    id: 'verify',
    title: 'Verify the deployment',
    description: "Checks the deployed app's health endpoint.",
  },
];

const stepList = (r: FactoryRequest): StepDef[] =>
  STEPS.filter((s) => s.id !== 'validate-app' || r.options.runLocalValidation);

const short = (env: string): string => (env === 'production' ? 'prd' : 'dev');

export function names(r: FactoryRequest): Names {
  const slug = r.appSlug;
  const suffix = r.azure.nameSuffix;
  const { owner, repoName: repo } = r.github;
  const shared = `rg-${slug}-shared-${suffix}`;
  const sql = r.options.database === 'azure-sql';
  return {
    repository: {
      url: `https://${GITHUB_HOST}/${owner}/${repo}`,
      fullName: `${owner}/${repo}`,
      visibility: r.github.visibility,
      branchProtection: r.options.protectMain,
    },
    resourceGroups: [
      { role: 'shared', name: shared },
      ...r.azure.environments.map((e) => ({
        role: e,
        name: `rg-${slug}-${short(e)}-${suffix}`,
      })),
    ],
    stateStorage: {
      storageAccount: `st${slug.replaceAll('-', '')}${suffix}tf`,
      container: 'tfstate',
      resourceGroup: shared,
    },
    identities: [
      {
        name: `id-${slug}-plan`,
        purpose: 'Plan',
        roles: 'Reader and state blob access',
      },
      {
        name: `id-${slug}-infra`,
        purpose: 'Infrastructure',
        roles: sql
          ? 'Web Plan, Website, SQL Server Contributor and SQL Security Manager on the environment groups'
          : 'Web Plan and Website Contributor on the environment groups',
      },
      {
        name: `id-${slug}-deploy`,
        purpose: 'Deploy',
        roles: 'Website Contributor on the web app',
      },
    ],
    federatedSubjects: r.azure.environments.flatMap((e) => [
      `repo:${owner}/${repo}:environment:${e}-plan`,
      `repo:${owner}/${repo}:environment:${e}`,
    ]),
    webApps: r.azure.environments.map((e) => {
      const n = `${slug}-${short(e)}-${suffix}`;
      return {
        environment: e,
        name: `app-${n}`,
        plan: `plan-${n}`,
        url: `https://app-${n}.azurewebsites.net`,
      };
    }),
    databases: sql
      ? r.azure.environments.map((e) => ({
          environment: e,
          kind: 'Azure SQL (serverless)',
          name: `sql-${slug}-${short(e)}-${suffix} / sqldb-${slug}`,
        }))
      : [],
    githubEnvironments: r.azure.environments.flatMap((e) => [
      { name: `${e}-plan`, purpose: 'terraform plan (read-only identity)' },
      {
        name: e,
        purpose:
          e === 'production'
            ? 'apply and deploy, behind required reviewers'
            : 'apply and deploy',
      },
    ]),
    variables: [
      'AZURE_TENANT_ID',
      'AZURE_SUBSCRIPTION_ID',
      'AZURE_CLIENT_ID',
      'AZURE_INFRA_CLIENT_ID',
      'TF_STATE_RESOURCE_GROUP',
      'TF_STATE_STORAGE_ACCOUNT',
      'TF_STATE_CONTAINER',
      'AZURE_WEBAPP_NAME',
    ],
    productionReviewers: [...r.github.productionReviewers],
    region: r.azure.region,
  };
}

function resourcesOf(r: FactoryRequest): AppResources {
  const n = names(r);
  return {
    github: {
      host: GITHUB_HOST,
      owner: r.github.owner,
      repo: r.github.repoName,
      url: n.repository.url,
    },
    azure: {
      resourceGroups: n.resourceGroups.map((g) => g.name),
      stateStorage: {
        account: n.stateStorage.storageAccount,
        container: n.stateStorage.container,
        resourceGroup: n.stateStorage.resourceGroup,
      },
      identities: n.identities.map((i) => ({
        role: i.name.slice(i.name.lastIndexOf('-') + 1),
        name: i.name,
      })),
      webApps: n.webApps.map((w) => ({
        environment: w.environment,
        name: w.name,
        url: w.url,
      })),
    },
  };
}

/** The commands a real run executes; a dry run only lists them. */
function commandsFor(step: string, r: FactoryRequest): string[] {
  const n = names(r);
  const full = n.repository.fullName;
  switch (step) {
    case 'prerequisites':
      return [
        'az account show',
        `gh auth status --hostname ${GITHUB_HOST}`,
        'az provider show --namespace Microsoft.Web --query registrationState',
      ];
    case 'export':
      return [
        `Export the template to ./work/${r.appSlug}`,
        'git init --initial-branch=main',
        'git add --all',
        'git commit --message "chore: initial commit"',
      ];
    case 'validate-app':
      return ['pnpm install --frozen-lockfile', 'pnpm validate'];
    case 'repository':
      return [
        `gh repo create ${full} --${r.github.visibility} --disable-wiki`,
        `git push --set-upstream https://${GITHUB_HOST}/${full}.git main`,
      ];
    case 'azure-groups':
      return n.resourceGroups.map(
        (g) =>
          `az group create --name ${g.name} --location ${n.region} --tags app=${r.appSlug}`,
      );
    case 'azure-state':
      return [
        `az storage account create --name ${n.stateStorage.storageAccount} --resource-group ${n.stateStorage.resourceGroup} --sku Standard_LRS --allow-blob-public-access false`,
        `az storage container create --name ${n.stateStorage.container} --account-name ${n.stateStorage.storageAccount} --auth-mode login`,
      ];
    case 'azure-identities':
      return [
        ...n.identities.map(
          (i) =>
            `az identity create --name ${i.name} --resource-group ${n.stateStorage.resourceGroup}`,
        ),
        ...n.federatedSubjects.map(
          (s) => `az identity federated-credential create --subject ${s} ...`,
        ),
      ];
    case 'github-setup':
      return [
        ...n.githubEnvironments.map(
          (e) => `gh api --method PUT repos/${full}/environments/${e.name}`,
        ),
        ...n.variables.map((v) => `gh variable set ${v} --repo ${full}`),
        ...(r.options.protectMain
          ? [`gh api --method PUT repos/${full}/branches/main/protection`]
          : []),
      ];
    case 'infrastructure':
      return [
        `gh workflow run infrastructure.yml --repo ${full} --field environment=development`,
        `gh run watch --repo ${full}`,
      ];
    case 'release':
      return [
        `gh variable set DEPLOY_ENABLED --body true --repo ${full}`,
        `gh workflow run release.yml --repo ${full}`,
      ];
    case 'verify':
      return n.webApps.map((w) => `curl --fail ${w.url}/health/live`);
    default:
      return [];
  }
}

async function fingerprint(r: FactoryRequest): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(r));
  if (globalThis.crypto?.subtle) {
    const hash = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(hash)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  let h = 0;
  for (const b of data) h = (Math.imul(h, 31) + b) | 0;
  return (h >>> 0).toString(16).padStart(64, '0');
}

function validateRequest(r: FactoryRequest): Record<string, string[]> {
  const e: Record<string, string[]> = {};
  if (!/^[A-Z][A-Za-z0-9]{1,39}$/.test(r.appName))
    e.appName = ['Use at least two letters, starting with a letter.'];
  if (
    !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(r.appSlug) ||
    r.appSlug.length < 3 ||
    r.appSlug.length > 25
  )
    e.appSlug = ['Use 3 to 25 lowercase letters, digits and single hyphens.'];
  const existing = state.apps.find((a) => a.slug === r.appSlug);
  if (existing && existing.status !== 'simulated')
    e.appSlug = [`An app named ${r.appSlug} exists already.`];
  if (
    r.azure.environments.includes('production') &&
    r.github.productionReviewers.length === 0
  )
    e['github.productionReviewers'] = [
      'Add at least one reviewer for production releases.',
    ];
  const tier = CONFIG.billing.tiers.find((t) => t.id === r.billing?.tier);
  if (!tier) e['billing.tier'] = ['Choose a tier.'];
  else if (
    tier.production === false &&
    r.azure.environments.includes('production')
  )
    e['azure.environments'] = [
      `The ${tier.name} tier has no production environment.`,
    ];
  return e;
}

// ------------------------------------------------------------------ runs

function emit(run: SimRun, event: RunEvent): void {
  run.events.push(event);
  save();
  listeners.get(run.summary.id)?.forEach((f) => f());
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function play(run: SimRun, r: FactoryRequest): Promise<void> {
  const steps = stepList(r);
  const n = names(r);
  emit(run, { type: 'plan', at: now(), mode: run.summary.mode, steps });
  emit(run, {
    type: 'log',
    at: now(),
    level: 'info',
    message: `Dry run for ${r.appSlug} started by ${REQUESTED_BY}.`,
  });
  for (const step of steps) {
    await wait(350);
    emit(run, {
      type: 'step',
      at: now(),
      id: step.id,
      status: 'running',
      detail: `Running ${step.title}`,
    });
    await wait(500 + ((step.id.length * 97) % 900));
    const commands = commandsFor(step.id, r);
    for (const c of commands.slice(0, 3))
      emit(run, {
        type: 'log',
        at: now(),
        level: 'info',
        message: `[dry run] ${c}`,
      });
    emit(run, {
      type: 'step',
      at: now(),
      id: step.id,
      status: 'succeeded',
      detail:
        step.id === 'validate'
          ? 'Request is valid. Names derived.'
          : 'Simulated, nothing was changed.',
      url: step.id === 'repository' ? n.repository.url : null,
      commands,
    });
  }
  await wait(300);
  run.summary.status = 'succeeded';
  const app = state.apps.find((a) => a.slug === r.appSlug);
  const ref = app?.runs.find((x) => x.id === run.summary.id);
  if (ref) ref.status = 'succeeded';
  if (app) app.updatedAt = now();
  emit(run, {
    type: 'result',
    at: now(),
    status: 'succeeded',
    repoUrl: n.repository.url,
    appUrl: n.webApps[0]?.url ?? null,
    message: 'Dry run finished. Nothing was created.',
  });
}

function startRun(r: FactoryRequest, mode: RunMode): SimRun {
  if (mode !== 'DryRun')
    throw invalid({
      mode: ['Only the dry run is available in the browser simulation.'],
    });
  const errors = validateRequest(r);
  if (Object.keys(errors).length) throw invalid(errors);
  if (
    state.runs.some(
      (x) => x.summary.appSlug === r.appSlug && x.summary.status === 'running',
    )
  )
    throw new ApiError(409, {
      title: 'Run already in progress',
      detail: `A run for ${r.appSlug} is already in progress.`,
      status: 409,
    });
  const id = `${Date.now().toString(36)}-${randomSuffix(6)}`;
  const startedAt = now();
  const run: SimRun = {
    summary: {
      id,
      appSlug: r.appSlug,
      appName: r.appName,
      mode,
      status: 'running',
      startedAt,
    },
    events: [],
  };
  state.runs.push(run);
  let app = state.apps.find((a) => a.slug === r.appSlug);
  if (!app) {
    app = {
      slug: r.appSlug,
      name: r.appName,
      status: 'simulated',
      createdAt: startedAt,
      updatedAt: startedAt,
      requestedBy: REQUESTED_BY,
      request: r,
      resources: null,
      runs: [],
    };
    state.apps.push(app);
  }
  // A dry run never overwrites a real app; here every app is simulated.
  Object.assign(app, {
    name: r.appName,
    request: r,
    resources: resourcesOf(r),
    updatedAt: startedAt,
  });
  app.runs.unshift({ id, status: 'running', mode, startedAt });
  save();
  void play(run, r);
  return run;
}

// ------------------------------------------------------------------ app rows and checks

const firstLine = (text?: string): string | null => {
  const line = text
    ?.split('\n')
    .map((l) => l.trim().replace(/^[#\s]+/, ''))
    .find((l) => l.length > 0);
  return line && line.length > 200
    ? `${line.slice(0, 200)}...`
    : (line ?? null);
};

function detail(a: SimApp): AppDetail {
  const at = new Date();
  return {
    id: a.slug,
    slug: a.slug,
    name: a.name,
    status: a.status,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    requestedBy: a.requestedBy,
    resources: a.resources,
    repoUrl: a.resources?.github?.url ?? null,
    appUrls: a.resources?.azure?.webApps.map((w) => w.url) ?? [],
    description: a.request.problem ?? firstLine(a.request.description),
    environments: a.request.azure.environments,
    cost: attachCost(a, at),
    lastCheck: a.check
      ? { at: a.check.at, overall: a.check.overall }
      : undefined,
    check: a.check,
    runs: a.runs,
  };
}

const CHECKS: [string, string, string[]][] = [
  ['repository', 'Repository exists', ['github']],
  ['github-environments', 'Environments and variables', ['github']],
  ['identities', 'Federated identities', ['github', 'azure']],
  ['azure-groups', 'Resource groups and role assignments', ['azure']],
  ['state', 'Terraform state storage', ['azure']],
  ['web-app', 'Web app is running', ['azure', 'deployment']],
  ['release', 'Latest release succeeded', ['deployment']],
  ['deployed-version', 'Deployed commit matches main', ['deployment']],
  ['health', 'Health endpoint answers', ['deployment']],
];

function runCheck(a: SimApp, mode: string): CheckResult {
  if (mode === 'Live')
    throw invalid({
      mode: ['A simulated app has no real resources to check.'],
    });
  const simulated = a.status === 'simulated';
  const checks: Check[] = CHECKS.map(([id, title, links]) => ({
    id,
    title,
    status: simulated ? 'pass' : 'unknown',
    detail: simulated ? '(simulated pass)' : '(dry run)',
    links,
  }));
  return { at: now(), overall: simulated ? 'healthy' : 'unknown', checks };
}

// ------------------------------------------------------------------ feature board (FeatureBoard.cs)

export const BOARD_STAGES: BoardStage[] = [
  {
    id: 'spec',
    title: 'Spec',
    agent: 'Spec writer',
    model: 'claude-sonnet-5-5',
    purpose: 'Turns the request into use cases and acceptance criteria',
  },
  {
    id: 'grill',
    title: 'Grill',
    agent: 'Griller',
    model: 'claude-opus-5-5',
    purpose: 'Challenges the spec: gaps, edge cases, open questions',
  },
  {
    id: 'size',
    title: 'Size',
    agent: 'Sizer',
    model: 'claude-haiku-5-5',
    purpose: 'Small goes straight on, big is split into slices',
  },
  {
    id: 'build',
    title: 'Build',
    agent: 'Builder',
    model: 'claude-sonnet-5-5',
    purpose: 'Implements slice by slice with tests',
  },
  {
    id: 'review-code',
    title: 'Review: code',
    agent: 'Code reviewer',
    model: 'claude-sonnet-5-5',
    purpose: 'Checks the coding guidelines and REVIEW.md',
  },
  {
    id: 'review-security',
    title: 'Review: security',
    agent: 'Security reviewer',
    model: 'claude-opus-5-5',
    purpose: 'Checks auth, input handling, secrets, dependencies',
  },
  {
    id: 'human',
    title: 'Human',
    agent: 'Product owner',
    model: null,
    purpose: 'A person approves the change',
  },
  {
    id: 'done',
    title: 'Released',
    agent: 'Release pipeline',
    model: null,
    purpose: 'Deployed through the release workflow',
  },
];

/** One scripted step: stage, status, seconds it lasts, detail, optional progress (0..1). */
type Step = [string, FeatureStatus, number, string, number?];
interface Script {
  title: string;
  kind: 'feature' | 'bug';
  source: FeatureSource;
  size: 'small' | 'big';
  offset: number;
  steps: Step[];
  repeat: boolean;
}

const smallFeature = (what: string): Step[] => [
  ['spec', 'running', 8, `Drafting use cases for ${what}`, 0.4],
  ['spec', 'running', 6, 'Writing acceptance criteria (Given/When/Then)', 0.8],
  ['grill', 'running', 8, 'Asking 4 questions about edge cases'],
  ['grill', 'running', 5, 'Spec updated: 1 edge case added'],
  ['size', 'running', 4, 'Estimating the change'],
  ['size', 'passed', 2, 'Small: one slice'],
  ['build', 'running', 7, 'Writing tests first', 0.2],
  ['build', 'running', 9, 'Implementing endpoint and UI', 0.6],
  ['build', 'running', 6, 'pnpm validate: 9/9 checks', 0.95],
  ['review-code', 'running', 8, 'Checking naming, structure and tests'],
  [
    'review-security',
    'running',
    8,
    'Checking authorization and input validation',
  ],
  ['human', 'waiting', 14, 'Waiting for the product owner'],
  ['done', 'done', 30, 'Deployed to development'],
];

const SEEDS: Script[] = [
  {
    title: 'CSV export of the main list',
    kind: 'feature',
    source: 'jira',
    size: 'small',
    offset: 0,
    steps: smallFeature('the CSV export'),
    repeat: true,
  },
  {
    title: 'Sign-in for external partners',
    kind: 'feature',
    source: 'servicenow',
    size: 'big',
    offset: 9,
    repeat: true,
    steps: [
      ['spec', 'running', 10, 'Drafting use cases for partner sign-in', 0.5],
      ['spec', 'running', 6, 'Acceptance criteria for 5 use cases', 0.9],
      ['grill', 'running', 9, 'Question: which partner tenants are allowed?'],
      ['grill', 'waiting', 8, 'Waiting for an answer from the requester'],
      ['grill', 'running', 5, 'Answer received, spec updated'],
      ['size', 'running', 4, 'Estimating the change'],
      ['size', 'passed', 3, 'Big: split into 3 slices'],
      ['build', 'running', 9, 'Slice 1/3: guest tenant allowlist', 0.33],
      ['build', 'running', 9, 'Slice 2/3: role mapping', 0.66],
      ['build', 'running', 8, 'Slice 3/3: partner landing page', 0.95],
      ['review-code', 'running', 7, 'Checking the coding guidelines'],
      [
        'review-code',
        'changes',
        4,
        '2 comments: missing test for UC-04, naming',
      ],
      ['build', 'running', 8, 'Fixing 2 review comments', 0.8],
      ['review-code', 'running', 6, 'Re-checking the changes'],
      [
        'review-security',
        'running',
        9,
        'Checking tenant validation and token handling',
      ],
      [
        'human',
        'waiting',
        16,
        'Waiting for the product owner and security officer',
      ],
      ['done', 'done', 30, 'Deployed to development'],
    ],
  },
  {
    title: 'Bug: date filter ignores the time zone',
    kind: 'bug',
    source: 'teams',
    size: 'small',
    offset: 22,
    repeat: true,
    steps: [
      [
        'spec',
        'running',
        6,
        'Reproducing the bug, writing a failing test',
        0.6,
      ],
      ['grill', 'running', 5, 'Checking other places with the same pattern'],
      ['size', 'passed', 3, 'Small: one fix'],
      ['build', 'running', 8, 'Fixing the filter and 3 similar places', 0.7],
      ['review-code', 'running', 6, 'Checking the fix'],
      ['review-security', 'running', 6, 'Checking the query parameters'],
      [
        'review-security',
        'changes',
        4,
        'Query string reaches SQL unparameterized',
      ],
      ['build', 'running', 7, 'Parameterizing the query', 0.9],
      ['review-security', 'running', 5, 'Re-checking'],
      ['human', 'waiting', 12, 'Waiting for the product owner'],
      ['done', 'done', 30, 'Deployed to development'],
    ],
  },
];

const epoch = Date.now();
// eslint-disable-next-line no-control-regex -- rejects control characters on purpose
const TITLE = /^[^\x00-\x1F\x7F-\x9F]{3,120}$/;

export const checkFeatureTitle = (title: string | undefined): string | null =>
  !title || !TITLE.test(title) || title.trim().length < 3
    ? 'Use 3 to 120 characters, without line breaks.'
    : null;

/** States are computed from the elapsed time, so the board is stateless and always moving. */
function feature(
  s: Script,
  start: number,
  at: number,
  prefix: string,
  n: number,
): Feature {
  const total = s.steps.reduce((t, x) => t + x[2], 0);
  let elapsed = (at - start) / 1000;
  if (s.repeat && elapsed >= 0) elapsed %= total;
  const history: Feature['history'] = [];
  let current: Step | null = null;
  let t = 0;
  let loops = 0;
  if (elapsed >= 0)
    for (const [i, step] of s.steps.entries()) {
      if (elapsed < t + step[2] || i === s.steps.length - 1) {
        current = step;
        break;
      }
      if (step[1] === 'changes') loops++;
      history.push({ stage: step[0], status: step[1], detail: step[3] });
      t += step[2];
    }
  const stage = BOARD_STAGES.find((x) => x.id === (current?.[0] ?? 'spec'))!;
  const source: Feature['source'] =
    s.source === 'jira'
      ? { kind: 'jira', label: 'Jira', key: `${prefix}-${140 + n}` }
      : s.source === 'servicenow'
        ? { kind: 'servicenow', label: 'ServiceNow', key: `RITM00${41200 + n}` }
        : { kind: 'teams', label: 'Teams', key: `Task ${n}` };
  const sized =
    history.some((h) => h.stage === 'size') ||
    (current?.[0] === 'size' && current[1] === 'passed') ||
    ['build', 'review-code', 'review-security', 'human', 'done'].includes(
      current?.[0] ?? '',
    );
  return {
    id: `f${n}`,
    title: s.title,
    kind: s.kind,
    source,
    size: sized ? s.size : null,
    stage: stage.id,
    status: current ? current[1] : 'queued',
    agent: { name: stage.agent, model: stage.model },
    detail: current?.[3] ?? 'Queued',
    progress: current?.[4] ?? null,
    loops: loops + (current?.[1] === 'changes' ? 1 : 0),
    history,
  };
}

export function board(slug: string, at = Date.now()): BoardData {
  const prefix = slug
    .split('-')
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
  let n = 0;
  const features = SEEDS.map((s) =>
    feature(s, epoch + s.offset * 1000, at, prefix, ++n),
  );
  for (const a of state.added[slug] ?? [])
    features.push(
      feature(
        {
          title: a.title,
          kind: a.kind,
          source: a.source,
          size: 'small',
          offset: 0,
          steps: smallFeature('the request'),
          repeat: false,
        },
        a.start,
        at,
        prefix,
        ++n,
      ),
    );
  return { simulated: true, stages: BOARD_STAGES, features };
}

// ------------------------------------------------------------------ the API

const DEMO_NAMES = [
  'Fleet Portal',
  'Visitor Desk',
  'Spare Parts',
  'Shift Planner',
  'Track Works',
  'Lost And Found',
];

function info(): FactoryInfo {
  return {
    githubHost: GITHUB_HOST,
    allowedOwners: CONFIG.owners,
    tenants: CONFIG.tenants,
    subscriptions: CONFIG.subscriptions,
    regions: CONFIG.regions,
    modes: MODES,
    defaults: {
      nameSuffix: randomSuffix(),
      region: CONFIG.regions[0],
      visibility: 'private',
      tenantId: CONFIG.tenants[0],
      subscriptionId: CONFIG.subscriptions[0]?.id,
      owner: CONFIG.owners[0],
    },
    isAdmin: false,
    databases: CONFIG.databases,
    demo: true,
    billing: CONFIG.billing,
    sharedState: false,
  };
}

export const simulatedApi: FactoryApi = {
  info: () => later(info),
  apps: () =>
    later(() =>
      [...state.apps]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((a): AppSummary => {
          // The list carries no check details and no run history.
          const row: Partial<AppDetail> = detail(a);
          delete row.check;
          delete row.runs;
          return row as AppSummary;
        }),
    ),
  app: (slug) => later(() => detail(findApp(slug))),
  check: (slug, mode) =>
    later(() => {
      const a = findApp(slug);
      a.check = runCheck(a, mode);
      a.updatedAt = now();
      save();
      return detail(a);
    }, 700),
  features: (slug) =>
    later(() => {
      findApp(slug);
      return board(slug);
    }),
  addFeature: (slug, f) =>
    later(() => {
      findApp(slug);
      const errors: Record<string, string[]> = {};
      const titleError = checkFeatureTitle(f.title);
      if (titleError) errors.title = [titleError];
      if (!['feature', 'bug'].includes(f.kind))
        errors.kind = ['Choose feature or bug.'];
      if (!['jira', 'servicenow', 'teams'].includes(f.source))
        errors.source = ['Choose jira, servicenow or teams.'];
      if (Object.keys(errors).length) throw invalid(errors);
      const list = (state.added[slug] ??= []);
      if (list.length >= 10)
        throw invalid({
          title: ['At most 10 added requests per app in the simulation.'],
        });
      list.push({
        title: f.title.trim(),
        kind: f.kind,
        source: f.source,
        start: Date.now(),
      });
      save();
      return board(slug);
    }),
  modeCheck: (mode) =>
    later(() => {
      const m = MODES.find((x) => x.id === mode);
      if (!m) throw notFound();
      return { available: m.available, reason: m.reason };
    }, 300),
  preview: async (request) => {
    await wait(250);
    const errors = validateRequest(request);
    if (Object.keys(errors).length) throw invalid(errors);
    return {
      request,
      fingerprint: await fingerprint(request),
      names: names(request),
      steps: stepList(request),
      cost: costForRequest(request),
    };
  },
  startRun: ({ request, mode }) =>
    later(() => ({ runId: startRun(request, mode).summary.id })),
  run: (id) =>
    later(() => {
      const r = state.runs.find((x) => x.summary.id === id);
      if (!r) throw notFound();
      return { ...r.summary };
    }),
  streamRun: (id, onEvent, signal) =>
    new Promise<void>((resolve, reject) => {
      const run = state.runs.find((x) => x.summary.id === id);
      if (!run) return reject(notFound());
      let next = 0;
      const set = listeners.get(id) ?? new Set<() => void>();
      listeners.set(id, set);
      const stop = (): void => {
        set.delete(flush);
        resolve();
      };
      function flush(): void {
        if (signal.aborted) return stop();
        while (next < run!.events.length) onEvent(run!.events[next++]);
        if (run!.summary.status !== 'running') stop();
      }
      set.add(flush);
      signal.addEventListener('abort', stop);
      setTimeout(flush, 0);
    }),
  demo: () =>
    later(() => {
      const taken = new Set(state.apps.map((a) => a.slug));
      const pick = DEMO_NAMES.map((name) => ({
        name,
        slug: name.toLowerCase().replaceAll(' ', '-'),
      })).find((x) => !taken.has(x.slug));
      if (!pick)
        throw new ApiError(409, {
          title: 'All sample apps exist already',
          detail: 'All sample apps exist already. Close the tab to start over.',
          status: 409,
        });
      const tier =
        CONFIG.billing.tiers.find((t) => t.id === 'sandbox') ??
        CONFIG.billing.tiers[0];
      const production = tier.production !== false;
      const request: FactoryRequest = {
        appName: pick.name.replaceAll(' ', ''),
        appSlug: pick.slug,
        author: REQUESTED_BY,
        problem: `Sample app ${pick.name}, created by the simulation.`,
        description:
          '## Today\nThe team works with spreadsheets and mail.\n\n## What they need to do\n- Record a new entry\n- See all open entries\n- Export the list',
        outcome: undefined,
        users: ['Employees', 'Team leads'],
        useCases: [
          'Employee records a new entry',
          'Team lead reviews open entries',
        ],
        constraints: [],
        documentLinks: [],
        azure: {
          tenantId: CONFIG.tenants[0],
          subscriptionId: CONFIG.subscriptions[0].id,
          region: CONFIG.regions[0],
          nameSuffix: randomSuffix(),
          environments: production
            ? ['development', 'production']
            : ['development'],
        },
        github: {
          owner: CONFIG.owners[0],
          repoName: pick.slug,
          visibility: 'private',
          productionReviewers: production ? ['product-owner'] : [],
        },
        options: {
          protectMain: true,
          runLocalValidation: false,
          database: 'none',
        },
        billing: { costCenter: 'CC-4711', tier: tier.id },
      };
      return { runId: startRun(request, 'DryRun').summary.id, slug: pick.slug };
    }),
};
