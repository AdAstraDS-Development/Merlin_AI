import { afterEach, expect, it, vi } from 'vitest';
import { postJson } from './api-client';
afterEach(() => vi.unstubAllGlobals());
it('fails closed when CSRF acquisition fails', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
  vi.stubGlobal('fetch', fetch);
  await expect(postJson('/api/private/ping')).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('uses cookies and a request token for mutations', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ requestToken: 'test-token' })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
  vi.stubGlobal('fetch', fetch);
  await postJson('/api/private/ping');
  expect(fetch).toHaveBeenLastCalledWith(
    '/api/private/ping',
    expect.objectContaining({
      credentials: 'include',
      method: 'POST',
      headers: expect.objectContaining({ 'X-CSRF-TOKEN': 'test-token' }),
    }),
  );
});
