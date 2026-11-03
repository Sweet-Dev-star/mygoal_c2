# vercel-c2-ui

Personal cybersecurity training lab — dashboard UI only.

The actual backend (a FastAPI service) runs on hardware the operator owns and
is reached through an outbound tunnel. This Vercel project contains:

- a Basic Auth gate (`middleware.js`) that blocks every request without valid
  credentials,
- a stateless proxy (`api/proxy/[...path].js`) that forwards dashboard requests
  to the current backend host and injects a shared secret header,
- static HTML pages under `public/` that call the proxy.

All endpoints, hosts, and secrets are supplied through Vercel environment
variables. Nothing sensitive is committed.

## Environment variables

| Name                   | Purpose                                                    |
| ---------------------- | ---------------------------------------------------------- |
| `BASIC_AUTH_USER`      | username for the browser Basic Auth prompt                 |
| `BASIC_AUTH_PASSWORD`  | password for the browser Basic Auth prompt                 |
| `C2_HOSTS`             | comma-separated candidate backend base URLs (tried in order) |
| `LAB_TOKEN`            | shared secret sent to the backend as `x-lab-token`         |

## Scope

Authorized security research on operator-owned systems only. Not for use
against any host the operator does not fully own and administer.