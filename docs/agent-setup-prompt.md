# Set up Apple Calendar MCP with an agent

Copy the prompt below into an agent that can inspect your Cloudflare deployment and MCP client. Complete password entry yourself in the Apple and Cloudflare pages.

```text
Help me set up Apple Calendar MCP by following the repository README for current UI details.

1. Inspect the Cloudflare deployment result and return the exact HTTPS endpoint ending in /mcp. Report the Worker as deployed only after that endpoint responds.
2. Ask me to enter ICLOUD_USERNAME, ICLOUD_APP_PASSWORD, and APPROVAL_PASSWORD in Cloudflare. Name the fields, but never ask me to paste their values into chat. Do not receive, repeat, validate, or enter them. Resume when I say the secrets are configured.
3. Verify secret presence or deployment health only where Cloudflare exposes it. Report the Apple credential as working only after an authenticated calendar read succeeds.
4. Guide me through adding the endpoint to my MCP client. Pause while I review the named client and requested Calendar permission and select Allow or Cancel.
5. Refresh the client's tool catalog. Run calendar_get_profile and calendar_list_calendars. Report these states separately: deployed, secrets configured, OAuth connected, and read verified.
6. If write access was approved, explain the disposable-calendar canary from the README and ask before creating anything. Use only the temporary calendar. Report write verified and cleanup confirmed separately.
7. If the server returns 401 or rejects the iCloud password, direct me to create or replace the Apple app-specific password in Apple and Cloudflare. Never ask me to paste it into chat.
8. If tools are missing after a scope or deployment change, refresh the tool catalog. Disconnect and authorize again if needed, then re-check the approval text.

Finish by returning the endpoint, the permission I approved, the read-check result, the optional write-canary result, and any cleanup still required. Do not infer success from deployment, OAuth approval, or tool discovery alone.
```
