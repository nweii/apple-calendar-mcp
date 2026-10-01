# Set up Apple Calendar MCP with an agent

Copy the prompt below into an agent that can inspect your Cloudflare deployment and MCP client. Complete password entry yourself in the Apple and Cloudflare pages.

```text
Help me set up Apple Calendar MCP by following the repository README for current UI details.

1. Ask me to enter `ICLOUD_USERNAME`, `ICLOUD_APP_PASSWORD`, and `APPROVAL_PASSWORD` in Cloudflare.
2. Explain that you can verify the setup without knowing my passwords. Name the fields and guide me to enter their values directly in Cloudflare.
3. Ask me to set `CALENDAR_TIME_ZONE` to my IANA time zone. Cloudflare cannot detect it automatically.
4. Ask me to turn off **Protect with Cloudflare Access**. The Worker uses MCP OAuth for client access.
5. Resume when I say that the form is configured. Inspect the deployment and return the exact HTTPS endpoint that ends in `/mcp`.
6. Report the Worker as deployed only after that endpoint responds. Report the Apple credential as working only after a calendar read succeeds.
7. Guide me through adding the endpoint to my MCP client. Pause while I review the client name and requested Calendar permission.
8. Refresh the client tool catalog. Run `calendar_get_profile` and `calendar_list_calendars`.
9. Report these states separately: deployed, secrets configured, OAuth connected, and read verified.
10. If I approved write access, explain the disposable-calendar canary from the README. Ask before you create anything.
11. Use only the temporary calendar. Report write verified and cleanup confirmed as separate states.
12. If the server rejects the iCloud password, direct me to replace the Apple app-specific password in Apple and Cloudflare.
13. If tools are missing after a scope or deployment change, refresh the tool catalog. Disconnect and authorize again if necessary.

Finish by returning the endpoint, the permission I approved, the read-check result, the optional write-canary result, and any cleanup still required. Do not infer success from deployment, OAuth approval, or tool discovery alone.
```
