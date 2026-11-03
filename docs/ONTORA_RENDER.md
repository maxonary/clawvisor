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

Registration is limited to `max@ontora.com`, with one human user. The first
registered user becomes the administrator. Set the password directly in the new
instance's dashboard; never commit it. Invitation-only registration is also enabled.
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
Cloudflare Access protects the entire hostname with the existing **Ontora Founder
Email** policy. Only `max@ontora.com`, `david@ontora.com`, and `leon@ontora.com`
can authenticate through the Google Workspace identity provider. All other
identities are denied; no bypass or service-token policy is attached. Sessions
last up to 12 hours. Clawvisor's own account authentication remains a second layer.
The tunnel connector also validates Access tokens for this application's audience.

Cloudflare Access application: `5c0bf76b-7584-42b6-bc88-dbcbac3dae0b`.
The shared founders policy is managed in Cloudflare; changes to that reusable
policy also affect its other linked applications. Public API and OAuth callback
requests must also pass this gate. Do not add unauthenticated path exceptions
without reviewing their scope.
The managed database preserves state across builds and deployments without an
attached filesystem disk. Check the deployment in Render and verify `/ready`
after each release. A code rollback does not roll back database migrations.
