# Apple Calendar MCP

Apple Calendar MCP gives an AI client remote read and write access to one iCloud Calendar account. It runs as a stateless TypeScript Worker on Cloudflare and does not require an Apple device to stay online.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/nweii/apple-calendar-mcp)

One deployment connects to one Apple Account. This is not a multi-user calendar service.

## Before you deploy

You need:

- A Cloudflare account.
- An Apple Account with two-factor authentication.
- An MCP client that supports remote HTTPS servers and OAuth.
- Your [IANA time zone name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones), such as `America/New_York`.

Open the Apple and Cloudflare setup pages yourself. An agent can guide you and verify the result, but it should not receive or enter your passwords.

> [!WARNING]
> Never paste your Apple Account password, Apple app-specific password, or approval password into chat, source control, logs, or issues.

## Create an Apple app-specific password

1. Open [account.apple.com](https://account.apple.com/) and sign in.
2. Select **Sign-In and Security > App-Specific Passwords**.
3. Select **Generate an app-specific password**.
4. Give it a clear label, such as `Apple Calendar MCP`.
5. Keep the generated value on the Apple page until Cloudflare asks for it.

Apple requires two-factor authentication for app-specific passwords. You can have up to 25 active passwords. You can revoke one or all of them. Changing or resetting your main Apple Account password revokes all app-specific passwords. See [Apple's app-specific password instructions](https://support.apple.com/102654).

> [!WARNING]
> The Apple app-specific password is broader than the Calendar permissions that this MCP shows to clients. The Worker limits itself to allowlisted iCloud CalDAV hosts, but Apple does not issue a Calendar-only app-specific password.

## Deploy to Cloudflare

1. Select **Deploy to Cloudflare** at the top of this page.
2. Sign in to Cloudflare and follow the deployment form.
3. Enter the three secret values when Cloudflare asks for them:
   - `ICLOUD_USERNAME`: the full email address used for your Apple Account and iCloud Calendar.
   - `ICLOUD_APP_PASSWORD`: the app-specific password that Apple generated. Preserve it exactly.
   - `APPROVAL_PASSWORD`: a separate, unique password that protects new MCP client approvals. Do not reuse either Apple password.
4. Change `CALENDAR_TIME_ZONE` from `UTC` to your IANA time zone name. Cloudflare cannot detect your time zone automatically.
5. Turn off **Protect with Cloudflare Access**. The Worker uses MCP OAuth for client access.
6. Deploy the Worker and wait for the deployment to finish.
7. Copy the endpoint in this form: `https://<worker-name>.<account-subdomain>.workers.dev/mcp`.

Cloudflare stores the three secret values as encrypted Worker secrets. The deployment form does not write them to the generated repository or to a local `.dev.vars` file.

If you skipped a secret or need to replace one, open **Workers & Pages**, select the Worker, select **Settings**, find **Variables and Secrets**, add or edit the value as a **Secret**, and select **Deploy**.

Cloudflare automatically provisions the `OAUTH_KV` namespace. Do not add a KV ID to `wrangler.jsonc`.

## Connect an MCP client

1. Add the deployed `/mcp` endpoint as a custom remote MCP server or app.
2. Select **Connect**. Your client should discover OAuth and open the Apple Calendar MCP approval page.
3. Confirm the client name and requested permission.
4. Enter `APPROVAL_PASSWORD` and select **Allow and return**. Select **Cancel** if the page asks for more access than you want.
5. Wait for the client to report that the connection is complete. Close the browser tab if it remains open after completion.
6. Refresh or rescan the client's tools. Clients can cache tool catalogs after a connection or server update.

For Claude, see [Use custom connectors with remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp). For ChatGPT, see [Developer mode and full MCP connectors](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt).

The approval page offers two permissions:

- **Read calendars and events** grants `calendar:read` and exposes seven read tools.
- **Read and edit calendars and events** grants `calendar:read calendar:write` and adds four mutation tools.

Changing permission requires authorization again and a tool-catalog refresh. A server update does not add write tools to an existing read-only grant.

> [!WARNING]
> Write actions involving attendees or invitations can send email or notifications to other people.

## Verify the connection

Verify read access first:

1. Call `calendar_get_profile`. Confirm the Apple Account identity and time zone.
2. Call `calendar_list_calendars`. Confirm that the expected calendar names appear.
3. If you approved read-only access, confirm that the client does not show mutation tools.

Deployment, secret entry, OAuth connection, and a successful calendar read are separate states. A successful calendar read proves that the Apple credential works.

To verify write access, first create an empty temporary calendar in Apple Calendar. Ask the agent to run this bounded test only after you confirm:

1. Create one future event with a unique title, no attendees, no recurrence, and no alerts.
2. Read the event and keep its current ETag.
3. Change only its title by using that ETag.
4. Read the event again and use the returned ETag to delete it.
5. Confirm that the event is absent.

If cleanup fails, record the exact calendar, title, and time so that you can remove the event yourself. Do not test writes on your default calendar.

You can also give an agent the bounded procedure in [Set up Apple Calendar MCP with an agent](docs/agent-setup-prompt.md).

## Tools

| Tool | Scope | Purpose |
| --- | --- | --- |
| `calendar_get_profile` | `calendar:read` | Return the configured iCloud account identity and default time zone. |
| `calendar_list_calendars` | `calendar:read` | List visible calendars, effective time zones, and opaque IDs. |
| `calendar_search_events` | `calendar:read` | Search a bounded time range across calendars. |
| `calendar_list_events` | `calendar:read` | List a bounded time range from one calendar. |
| `calendar_get_event` | `calendar:read` | Read full event details and the current ETag. |
| `calendar_batch_get_events` | `calendar:read` | Read up to 20 events with per-event errors. |
| `calendar_get_availability` | `calendar:read` | Return merged busy windows without event details. |
| `calendar_create_event` | `calendar:write` | Create timed, all-day, recurring, invited, located, or alerted events. |
| `calendar_update_event` | `calendar:write` | Change one occurrence, this and later occurrences, or an entire series. |
| `calendar_delete_event` | `calendar:write` | Delete one occurrence, this and later occurrences, or an entire series. |
| `calendar_respond_to_invitation` | `calendar:write` | Accept, decline, or tentatively accept an invitation. |

Update, delete, and invitation-response tools require the latest ETag. Recurring occurrence changes also require the original `recurrenceId` returned by a search.

Timed inputs use RFC 3339 timestamps with `Z` or an explicit offset. Clients can omit `timeZone`; creation uses the calendar's published IANA time zone, then `CALENDAR_TIME_ZONE`. Timed outputs include UTC and local values.

`location` is the visible Calendar field. `structuredLocation` can add a title, address, latitude, longitude, and radius. Verified coordinates enable Apple Calendar's map preview. Do not guess coordinates.

`description` maps to Calendar Notes. `url` maps to the event URL field. The MCP preserves unsupported attachments and alarm types during unrelated changes, but it does not upload, download, or modify attachments. It does not import raw ICS.

## Use a custom domain

The default `workers.dev` endpoint needs no hostname configuration. A custom domain requires one explicit allowlist setting:

1. Open the Worker in Cloudflare.
2. Select **Settings > Domains & Routes > Add > Custom Domain** and add the hostname.
3. Under **Variables and Secrets**, add `MCP_HOSTNAME` as a plain-text variable. Enter only the hostname, such as `calendar.example.com`. Do not include `https://`, a path, a port, or credentials.
4. Deploy the setting.
5. Connect clients again at `https://<custom-host>/mcp` and complete authorization again.

The hostname is part of the OAuth identity. Tokens issued for `workers.dev` do not move to the custom origin.

## Add Cloudflare Access

The built-in approval password is the default authorization guard. Turn off the Access switch in the deployment form.

**Previews only** does not protect the production Worker. **All traffic** also protects MCP and OAuth endpoints that clients must reach.

To replace the approval password with Access, deploy the Worker first. Then create a path-based Access application for `<hostname>/authorize`.

Leave `/mcp`, `/.well-known/*`, `/oauth/token`, and `/oauth/register` reachable by MCP clients. When Access protects `/authorize`, add `EXTERNAL_AUTHORIZATION=true` as a plain-text Worker variable.

To use Access without an approval password, delete `APPROVAL_PASSWORD` only after you deploy `EXTERNAL_AUTHORIZATION=true`. If both settings exist, users must pass both checks.

> [!WARNING]
> Set `EXTERNAL_AUTHORIZATION=true` only after an outside guard protects `/authorize`. The setting declares that the outside guard is active.

## Security

The Worker receives your Apple username and app-specific password at runtime. You trust your Cloudflare account, the deployed source, Apple, and every connected MCP client. Restrict access to your Cloudflare account and connect only clients you trust.

`APPROVAL_PASSWORD` protects new approvals. The approval route fails closed unless this password is configured or `EXTERNAL_AUTHORIZATION` declares a verified outside guard. Anyone who passes the guard can authorize a client against the configured Apple account.

> [!WARNING]
> Rotating `APPROVAL_PASSWORD` does not revoke OAuth tokens that were already issued.

Cloudflare's OAuth provider stores access tokens, refresh tokens, authorization codes, and registered client secrets by hash. It encrypts authorization properties. Client names and grant metadata remain visible in storage, so they must not contain secrets. See the provider's [KV storage and cleanup documentation](https://github.com/cloudflare/workers-oauth-provider#kv-storage-and-cleanup).

The Worker sends Apple credentials only over HTTPS to allowlisted iCloud CalDAV hosts. Tool arguments cannot choose an upstream host. Errors redact credential-like values. The Worker does not log tool arguments or event payloads.

Tool results can include titles, notes, locations, attendees, and URLs. MCP clients can retain this data under their own product and workspace policies.

Write access covers event creation, changes, deletion, and invitation responses. ETags prevent overwriting a newer event, but they cannot make an unintended write harmless. Unrelated updates preserve unsupported Apple properties when possible.

Deploy from this canonical repository or from a fork whose changes you reviewed. A remote MCP server can change its tool catalog when its owner deploys new code.

### Revoke or rotate access

| Goal | Action | Result |
| --- | --- | --- |
| Stop one client | Disconnect or remove it in that client's settings. Use its revoke flow when available. | The client stops using its connection. |
| Stop new approvals | Rotate `APPROVAL_PASSWORD` or disable the Worker. | Existing OAuth tokens are unaffected. |
| Stop all Apple access immediately | Disable the Worker and revoke its app-specific password at [account.apple.com](https://account.apple.com/). | Calendar calls fail until you configure a new app-specific password. |
| Rotate normally | Create a new Apple app-specific password, replace `ICLOUD_APP_PASSWORD` in Cloudflare, verify a read call, then revoke the old password. | You verify the replacement before revocation and avoid downtime. |
| Recover after an Apple Account password reset | Create a new app-specific password and replace the Worker secret. | Apple already revoked the old app-specific password. |

If you suspect compromise, revoke the old Apple app-specific password first. Then replace it and verify access. This causes a short outage.

## Troubleshooting

- A `401` or iCloud password rejection usually means that the app-specific password is missing or revoked. Create or replace it in Apple and Cloudflare. Do not paste it into chat.
- Missing write tools usually mean that the client has a read-only grant or a cached tool catalog. Refresh tools, then disconnect and authorize again if needed.
- A custom domain that rejects `/mcp` usually has a missing or invalid `MCP_HOSTNAME`. Set the exact hostname and redeploy.
- An approval page that fails closed has neither `APPROVAL_PASSWORD` nor a declared external guard. Add the approval secret unless you have already verified Cloudflare Access on `/authorize`.

## Develop locally

```bash
bun install
cp .dev.vars.example .dev.vars
bun run test
bun run typecheck
bun run cloudflare:check
```

Keep `.dev.vars` local. Deploy with `bun run deploy`.

## License

[MIT](LICENSE)
