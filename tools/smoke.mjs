import assert from 'node:assert/strict';
const base = process.env.SMOKE_URL ?? 'http://localhost:5080';
for (const [path, status] of [
  ['/', 200],
  ['/health/live', 200],
  ['/api/config', 200],
  ['/api/me', 401],
  ['/api/private/ping', 401],
  ['/api/not-found', 404],
  ['/app', 302],
]) {
  const response = await fetch(new URL(path, base), {
    redirect: 'manual',
    method: path === '/api/private/ping' ? 'POST' : 'GET',
  });
  assert.equal(response.status, status, `${path}: unexpected status`);
  if (path === '/') assert.match(await response.text(), /id="root"/);
  if (path === '/api/config')
    assert.equal(typeof (await response.json()).loginEnabled, 'boolean');
}
console.log(
  'PASS: public SPA, health, configuration, authentication boundaries and API 404.',
);
