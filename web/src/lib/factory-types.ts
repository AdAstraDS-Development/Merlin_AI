// Contract of the factory API (see ai-sw-template factory/PROTOCOL.md and factory/portal/README.md).

export type AppStatus =
  | 'requested'
  | 'awaiting-approval'
  | 'provisioning'
  | 'live'
  | 'degraded'
  | 'failed'
  | 'simulated'
  | 'decommissioned';
export type CheckState = 'pass' | 'warn' | 'fail' | 'unknown';
export type RunMode = 'DryRun' | 'Local' | 'Factory';
export type CheckMode = 'DryRun' | 'Live';
export type StepStatus =
  'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'waiting';

export interface Tier {
  id: string;
  name: string;
  monthlyPerEnvironment: number;
  production?: boolean;
  expiresDays?: number;
  summary: string;
}
export interface CostCenter {
  id: string;
  name: string;
}
export interface Billing {
  simulated: boolean;
  free: boolean;
  databaseMonthlyPerEnvironment: Record<string, number>;
  currency: string;
  platformFeePercent: number;
  seatFeePerMonth: number;
  costCenters: CostCenter[];
  tiers: Tier[];
}
export interface ModeInfo {
  id: RunMode;
  available: boolean;
  reason: string | null;
  needsCheck: boolean;
}
export interface FactoryInfo {
  githubHost: string;
  allowedOwners: string[];
  tenants: string[];
  subscriptions: { id: string; name: string }[];
  regions: string[];
  modes: ModeInfo[];
  defaults: {
    nameSuffix: string;
    region?: string;
    tenantId?: string;
    subscriptionId?: string;
    owner?: string;
    visibility: string;
  };
  isAdmin: boolean;
  databases: string[];
  demo: boolean;
  billing: Billing | null;
  sharedState: boolean;
}

export interface CostEstimate {
  simulated: boolean;
  free: boolean;
  database: string;
  databaseMonthly: number;
  currency: string;
  tier: { id: string; name: string; expiresDays?: number };
  costCenter: CostCenter | null;
  environments: number;
  azureMonthly: number;
  platformFeePercent: number;
  platformFee: number;
  seats: number;
  seatFee: number;
  seatCost: number;
  totalMonthly: number;
  monthToDate?: number;
  forecast?: number;
  budget?: number;
  budgetState?: 'ok' | 'near' | 'over';
  chargeMonthToDate?: number;
  chargeForecast?: number;
  expiresAt?: string;
}

export interface Check {
  id: string;
  title: string;
  status: CheckState;
  detail?: string;
  links?: string[];
  url?: string;
}
export interface CheckResult {
  at: string;
  overall: string;
  checks: Check[];
}
export interface AppResources {
  github?: { host: string; owner: string; repo: string; url: string };
  azure?: {
    resourceGroups: string[];
    stateStorage?: {
      account: string;
      container: string;
      resourceGroup: string;
    };
    identities: { role: string; name: string }[];
    webApps: { environment: string; name: string; url: string }[];
  };
}
export interface RunRef {
  id: string;
  status: 'running' | 'succeeded' | 'failed';
  mode: RunMode;
  startedAt: string;
}
export interface AppSummary {
  id: string;
  slug: string;
  name: string;
  status: AppStatus;
  createdAt: string;
  updatedAt: string;
  requestedBy: string;
  resources: AppResources | null;
  repoUrl?: string | null;
  appUrls: string[];
  description?: string | null;
  environments: string[];
  cost?: CostEstimate;
  lastCheck?: { at: string; overall: string };
}
export interface AppDetail extends AppSummary {
  check?: CheckResult;
  runs: RunRef[];
}

export interface FactoryRequest {
  appName: string;
  appSlug: string;
  author?: string;
  description?: string;
  problem?: string;
  outcome?: string;
  users: string[];
  useCases: string[];
  constraints: string[];
  documentLinks: string[];
  azure: {
    tenantId: string;
    subscriptionId: string;
    region: string;
    nameSuffix: string;
    environments: string[];
  };
  github: {
    owner: string;
    repoName: string;
    visibility: string;
    productionReviewers: string[];
  };
  options: {
    protectMain: boolean;
    runLocalValidation: boolean;
    database: string;
  };
  billing?: { costCenter: string; tier: string };
}
export interface StepDef {
  id: string;
  title: string;
  description: string;
}
export interface Names {
  repository: {
    url: string;
    fullName: string;
    visibility: string;
    branchProtection: boolean;
  };
  resourceGroups: { role: string; name: string }[];
  stateStorage: {
    storageAccount: string;
    container: string;
    resourceGroup: string;
  };
  identities: { name: string; purpose: string; roles: string }[];
  federatedSubjects: string[];
  webApps: { environment: string; name: string; plan: string; url: string }[];
  databases: { environment: string; kind: string; name: string }[];
  githubEnvironments: { name: string; purpose: string }[];
  variables: string[];
  productionReviewers: string[];
  region: string;
}
export interface PreviewResult {
  request: FactoryRequest;
  fingerprint: string;
  names: Names;
  steps: StepDef[];
  cost: CostEstimate | null;
}
export interface RunSummary {
  id: string;
  appSlug: string;
  appName: string;
  mode: RunMode;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: string;
}
export type RunEvent =
  | { type: 'plan'; at: string; mode?: RunMode; steps?: StepDef[] }
  | {
      type: 'step';
      at: string;
      id: string;
      status: StepStatus;
      detail?: string;
      url?: string | null;
      commands?: string[];
    }
  | { type: 'log'; at: string; level?: string; message: string }
  | {
      type: 'result';
      at: string;
      status: 'succeeded' | 'failed';
      repoUrl?: string | null;
      appUrl?: string | null;
      message?: string;
    };

export interface BoardStage {
  id: string;
  title: string;
  agent: string;
  model: string | null;
  purpose: string;
}
export type FeatureStatus =
  'queued' | 'running' | 'waiting' | 'passed' | 'changes' | 'done';
export type FeatureSource = 'jira' | 'servicenow' | 'teams';
export interface Feature {
  id: string;
  title: string;
  kind: 'feature' | 'bug';
  source: { kind: FeatureSource; label: string; key: string };
  size: 'small' | 'big' | null;
  stage: string;
  status: FeatureStatus;
  agent: { name: string; model: string | null };
  detail: string;
  progress: number | null;
  loops: number;
  history: { stage: string; status: FeatureStatus; detail: string }[];
}
export interface BoardData {
  simulated: boolean;
  stages: BoardStage[];
  features: Feature[];
}
export interface NewFeature {
  title: string;
  kind: 'feature' | 'bug';
  source: FeatureSource;
}
