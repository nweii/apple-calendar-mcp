// Updates an existing Worker's code while leaving its Cloudflare dashboard configuration intact.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

const credentials = z.object({
  CLOUDFLARE_API_TOKEN: z.string().min(1),
  CLOUDFLARE_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/i),
  WORKER_NAME: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
});

const runtime = z.object({
  compatibilityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  compatibilityFlags: z.array(z.string()),
});

const settingsResponse = z.object({
  success: z.literal(true),
  result: z.object({
    compatibility_date: z.string(),
    compatibility_flags: z.array(z.string()).default([]),
  }),
});

export async function deployExisting(env, config, bundle, request = fetch) {
  const parsed = credentials.safeParse(env);

  if (!parsed.success) {
    throw new Error('Set valid CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and WORKER_NAME environment variables.');
  }

  const required = runtime.parse(config);
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, WORKER_NAME: name } = parsed.data;
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}/workers`;
  const headers = { Authorization: `Bearer ${token}` };
  const response = await request(`${base}/scripts/${name}/settings`, { headers });

  if (!response.ok) {
    throw new Error(`Existing Worker lookup failed (HTTP ${response.status}); no code uploaded.`);
  }

  const { result: settings } = settingsResponse.parse(await response.json());

  if (settings.compatibility_date !== required.compatibilityDate ||
      required.compatibilityFlags.length !== settings.compatibility_flags.length ||
      required.compatibilityFlags.some(flag => !settings.compatibility_flags.includes(flag))) {
    throw new Error('Worker runtime settings differ from cloudflare.config.ts. Align the compatibility date and flags in the dashboard before uploading.');
  }

  const body = new FormData();
  body.set('metadata', new Blob([JSON.stringify({ main_module: 'worker.js' })], { type: 'application/json' }));
  body.set('worker.js', new Blob([bundle], { type: 'application/javascript+module' }), 'worker.js');

  const upload = await request(`${base}/services/${name}/environments/production/content`, {
    method: 'PUT', headers, body,
  });

  if (!upload.ok) {
    throw new Error(`Code upload failed (HTTP ${upload.status}); inspect Cloudflare deployments before retrying.`);
  }

  const result = z.object({ success: z.literal(true) }).safeParse(await upload.json());

  if (!result.success) {
    throw new Error('Cloudflare did not confirm the upload; inspect deployments before retrying.');
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const output = '.cloudflare/output/v0/workers/default';

  try {
    const config = JSON.parse(await readFile(`${output}/worker.config.json`, 'utf8'));
    const bundle = await readFile(`${output}/bundle/worker.js`);
    await deployExisting(process.env, config, bundle);
    console.log('Existing Worker code updated. Dashboard configuration preserved.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
