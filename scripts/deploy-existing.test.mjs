// Exercises the content-only deployment contract without accessing Cloudflare.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deployExisting } from './deploy-existing.mjs';

const env = { CLOUDFLARE_API_TOKEN: 'test-token', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), WORKER_NAME: 'test-calendar' };

const config = { compatibilityDate: '2026-08-27', compatibilityFlags: ['nodejs_compat'] };

const settings = { success: true, result: { compatibility_date: config.compatibilityDate, compatibility_flags: config.compatibilityFlags, bindings: [{ name: 'OAUTH_KV', id: 'private-id' }] } };

test('uploads only code and entrypoint metadata to the existing service', async () => {
  const calls = [];
  await deployExisting(env, config, 'export default {};', async (url, options) => {
    calls.push({ url, options });

    return Response.json(calls.length === 1 ? settings : { success: true });
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/test-calendar/settings`);
  assert.equal(calls[1].url, `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/services/test-calendar/environments/production/content`);
  assert.equal(calls[1].options.method, 'PUT');
  const body = calls[1].options.body;
  assert.deepEqual([...body.keys()], ['metadata', 'worker.js']);
  assert.deepEqual(JSON.parse(await body.get('metadata').text()), { main_module: 'worker.js' });
  assert.equal(await body.get('worker.js').text(), 'export default {};');
  assert.equal(body.get('worker.js').type, 'application/javascript+module');
});

test('missing Worker fails before a write', async () => {
  let calls = 0;
  await assert.rejects(deployExisting(env, config, '', async () => {
    calls += 1;

    return new Response('private error detail', { status: 404 });
  }), /lookup failed \(HTTP 404\); no code uploaded/);
  assert.equal(calls, 1);
});

for (const incompatible of [
  { ...settings.result, compatibility_date: '2026-01-01' },
  { ...settings.result, compatibility_flags: [] },
  { ...settings.result, compatibility_flags: ['nodejs_compat', 'extra_flag'] },
]) {
  test(`rejects incompatible runtime ${JSON.stringify(incompatible)}`, async () => {
    let calls = 0;
    await assert.rejects(deployExisting(env, config, '', async () => {
      calls += 1;

      return Response.json({ success: true, result: incompatible });
    }), /runtime settings differ/);
    assert.equal(calls, 1);
  });
}

test('invalid credentials fail before any request', async () => {
  await assert.rejects(deployExisting({}, config, '', () => assert.fail('Unexpected request')), /environment variables/);
});
