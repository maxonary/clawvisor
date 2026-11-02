# Ontora Render deployment

- Instance: https://clawvisor.ontora.com
- Render service: https://dashboard.render.com/web/srv-dbki2clg1s2s738ab84g
- Blueprint: https://dashboard.render.com/blueprint/exs-dbkhv70ae00c73870rq0
- Readiness: https://clawvisor.ontora.com/ready

Deploy `render.yaml` as a Blueprint in the **Ontora Gbrain / OpenClaw** workspace.
The web service builds `render/Dockerfile` from this repository's `main` branch.
Every push to `main` triggers a deployment; Blueprint auto-sync also keeps service
configuration aligned with `render.yaml`.

The Blueprint references the existing **ontora-clawvisor-db** Postgres 18 instance
in Oregon (1 GB storage, 0.1c-256mb compute). It intentionally does not create a
second database. External database access is disabled. Keep the service in Oregon
so it can use the private connection.

`JWT_SECRET` and `VAULT_KEY` are generated once by Render. Keep these environment
values across deployments. The vault key encrypts the credentials in Postgres;
losing or replacing it makes existing encrypted credentials unreadable.

The initial administrator registers as `max@ontora.com`. Set the password directly
in the instance's dashboard; never commit it. `MAX_USERS=0` removes the account
cap so the administrator can invite additional team members.

`AUTH_REQUIRE_INVITE=true` keeps subsequent registration invitation-only. The
`ALLOWED_EMAILS` setting restricts initial registration; valid administrator-issued
invites bypass that list, so invited teammates can use their own email addresses.
Invite claims create member accounts pending email verification. Configure the
supported email verification delivery before onboarding teammates; without it,
claiming an invitation does not produce a usable signed-in account. Admin role
promotion remains a separate administrator action.

This is a fresh instance: existing ClawVisor accounts, credentials, policies,
audit history, and agent integrations have not been migrated.

After login, configure the required service credentials and LLM verification
provider through supported Clawvisor settings / Render secrets. Google services
require `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, with the deployment's
`/api/oauth/callback` URL registered in Google. These optional credentials are
not required just to host the application and are not requested by the Blueprint.

Cloudflare terminates public HTTPS at `clawvisor.ontora.com`. The existing
`mcp-ontora-brain` Cloudflare Tunnel (`b2bb4e9a-0e5b-44da-9758-2ec58e09f4a4`)
runs on the AlphaClaw Render service in Oregon and forwards this hostname to
`http://ontora-clawvisor:10000` over Render's private network. Its existing
`brain.ontora.com` route is preserved. Clawvisor availability therefore also
depends on that tunnel connector and AlphaClaw service.

DNS is a proxied CNAME to the tunnel's `.cfargotunnel.com` hostname, not to the
Render public address. Cloudflare manages the tunnel route and DNS; `render.yaml`
manages Clawvisor's custom domain, `PUBLIC_URL`, and `renderSubdomainPolicy`.
The default `onrender.com` endpoint is disabled and should return HTTP 404.
Clawvisor binds `0.0.0.0:$PORT` and exposes `/ready` as its readiness check.
Its own account authentication continues to protect the dashboard; this does
not add a separate Cloudflare Access login.
The managed database preserves state across builds and deployments without an
attached filesystem disk. Check the deployment in Render and verify `/ready`
after each release. A code rollback does not roll back database migrations.
