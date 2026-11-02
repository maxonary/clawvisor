# Ontora Render deployment

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

Render terminates HTTPS. Clawvisor binds `0.0.0.0:$PORT`, derives its public URL
from `RENDER_EXTERNAL_URL`, and exposes `/ready` as its readiness check.
The managed database preserves state across builds and deployments without an
attached filesystem disk. Check the deployment in Render and verify `/ready`
after each release. A code rollback does not roll back database migrations.
