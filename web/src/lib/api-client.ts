export interface AppConfig {
  applicationName: string;
  loginEnabled: boolean;
}
export interface CurrentUser {
  name: string;
}
/** RFC 9457 problem details as returned by `Results.Problem` and `Results.ValidationProblem`. */
export interface ProblemDetails {
  title?: string;
  detail?: string;
  status?: number;
  errors?: Record<string, string[]>;
}
export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails | null;
  constructor(status: number, problem: ProblemDetails | null = null) {
    super(problem?.title || problem?.detail || `Request failed (${status})`);
    this.status = status;
    this.problem = problem;
  }
  get errors(): Record<string, string[]> | null {
    return this.problem?.errors ?? null;
  }
}
/** One readable sentence for an error: validation messages, else the problem detail, else the message. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.errors) return Object.values(error.errors).flat().join(' ');
    return error.problem?.detail || error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
async function readProblem(response: Response): Promise<ProblemDetails | null> {
  try {
    return (await response.json()) as ProblemDetails;
  } catch {
    return null;
  }
}
export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok)
    throw new ApiError(response.status, await readProblem(response));
  return response.json() as Promise<T>;
}
export async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const { requestToken } = await getJson<{ requestToken: string }>(
    '/api/auth/csrf',
  );
  if (!requestToken) throw new Error('Unable to obtain CSRF token.');
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'X-CSRF-TOKEN': requestToken,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok)
    throw new ApiError(response.status, await readProblem(response));
  return response.json() as Promise<T>;
}
