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

Founders sign in with their Ontora Google Workspace identities through the
existing Cloudflare Access gate. The application verifies the signed Access
assertion and only admits `max@ontora.com`, `leon@ontora.com`, and
`david@ontora.com`. Max is the bootstrap administrator; other new founders are
members. Existing account roles and data are preserved. See **Founder Google
sign-in** below for configuration, rollout, and revocation details.

Instance administrators can open **Users** (`/dashboard/users`) to view accounts,
change roles, and remove accounts. Role changes and removals require confirmation.
The screen protects your own account and the last administrator; server-side
checks remain authoritative. In Google-only mode, password invitations are
replaced with an explanation of the founder allowlist. No invitation or
verification email is sent, and password/magic enrollment routes are disabled.
`AUTH_REQUIRE_INVITE=true` remains a fallback safeguard if SSO is disabled.

This is a fresh instance: existing ClawVisor accounts, credentials, policies,
audit history, and agent integrations have not been migrated.

After login, configure the required service credentials and LLM verification
provider through supported Clawvisor settings / Render secrets. Google services
such as Gmail require `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, with the deployment's
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


## Founder Google sign-in

`ACCESS_SSO_ENABLED=true` connects the application's login to the existing
Cloudflare Access Google Workspace gate. The app validates RS256 signatures
against the configured issuer's cached public keys and checks expiry, issuer,
application audience, human identity, and the exact founder email allowlist.
It never trusts the email header alone. No additional Google OAuth client or
outbound verification email is needed.

The Render Blueprint pins `ACCESS_SSO_ISSUER`, `ACCESS_SSO_AUDIENCE`,
`ACCESS_SSO_EMAILS` (Max, Leon, David), and `ACCESS_SSO_BOOTSTRAP_ADMIN` (Max).
The first successful sign-in creates an authorized founder as a member, or Max
as an administrator. Existing accounts and roles are preserved; an existing
pending account becomes verified only after its signed Google identity matches.
Mixed-case legacy emails are matched without merging ambiguous duplicates.
Password registration/login and local magic-link enrollment are disabled.
Legacy registration/verification links lead to the Google login screen.

All browser bearer sessions, including old password sessions, require the same
valid Access identity on every request and refresh. Private Render agent/API
tokens keep their existing independent authentication; an agent token cannot
be exchanged for a human session. `/ready` remains reachable on the private
network for Render's health check.

To revoke a founder's ability to sign in, remove their email from both
`ACCESS_SSO_EMAILS` and the Cloudflare founder policy. Deleting their application
account alone revokes its agents and removes its data, but an allowlisted
identity can create a new member account on its next sign-in. The bootstrap
administrator is restored as admin if its account is recreated.

Roll out by merging the SSO PR into `main`, allowing Render's Blueprint sync
and auto-deploy to finish, then opening `https://clawvisor.ontora.com/login` as
an authorized founder and choosing **Continue with Ontora Google**. Confirm
that the dashboard opens and stays authenticated after a reload. This last
interactive check requires a real founder Google session; automated tests use
synthetic signed assertions and do not impersonate a founder.

Rollback: revert the SSO commit and deploy that revert, keeping the existing
Cloudflare founder policy and disabled Render URL in place. Password account
hashes are preserved. Google-provisioned accounts intentionally have no usable
password; returning to password auth requires an intentional account recovery
process for those users.
