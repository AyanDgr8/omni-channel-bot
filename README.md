# VoxAgent — Getting Started

A plain-English guide to running this app on your own computer.

---

## 1. What is this thing?

**VoxAgent is a control panel for AI phone agents.**

Imagine you run a hotel, a clinic, or a support desk. Instead of hiring 20 people to answer
the phone, you set up an AI "bot" that picks up calls, talks to the customer like a human,
and then emails them a summary afterwards. VoxAgent is the website where you **set up,
configure, and watch** those bots.

It does *not* make the phone ring by itself — it's the dashboard/brain that decides:

- **Who the bot is** — its personality, tone, greeting, what it's allowed and not allowed to say ("Personas")
- **Which AI it uses** — OpenAI, Google Gemini, Anthropic, Ollama… and which one to fall back to if the first one is down
- **What happened on every call** — logs, transcripts, charts, hang-up reasons
- **What happens after the call** — send a WhatsApp / Telegram / email, book a calendar slot
- **Who on your team can touch what** — logins, roles, and separate "tenants" (companies) that can't see each other's data

---

## 2. What's inside the folder?

This is a **monorepo** — one folder containing several mini-apps that work together.

| Folder | What it is | Do I need it? |
|---|---|---|
| `artifacts/api-server` | The **backend**. Talks to the database, handles logins, runs all the logic. | ✅ Yes — required |
| `artifacts/dashboard` | The **website** you actually click around in (React). | ✅ Yes — required |
| `lib/db` | Database tables + migrations (MySQL via Drizzle). | ✅ Used automatically |
| `lib/api-zod` | Rules that check incoming data isn't garbage. | ✅ Used automatically |
| `lib/api-client-react` | Auto-generated code the dashboard uses to call the backend. | ✅ Used automatically |
| `lib/api-spec` | The `openapi.yaml` "contract" that generates the two libs above. | Only when changing the API |
| `artifacts/mobile` | Companion phone app (Expo / React Native). | ❌ Optional |
| `artifacts/video` | An animated explainer video of the product. | ❌ Optional |
| `artifacts/mockup-sandbox` | A design playground for previewing UI components. | ❌ Optional |
| `scripts` | Helper scripts, e.g. loading 5 sample bot personalities. | ❌ Optional |
| `docs/VoxAgent-BRD.md` | The full business/product spec, if you want the deep story. | 📖 Reading only |

---

## 3. What you need installed first

Three things. That's it.

| Tool | Version | How to check | How to get it |
|---|---|---|---|
| **Node.js** | 22 or newer (24 recommended) | `node -v` | [nodejs.org](https://nodejs.org) |
| **pnpm** | 9 or newer | `pnpm -v` | `npm install -g pnpm` |
| **MySQL** | 8.0 or newer | `mysql --version` | `brew install mysql` (Mac) or [dev.mysql.com](https://dev.mysql.com/downloads/) |

> ⚠️ **Use `pnpm`, not `npm` or `yarn`.** This project will literally refuse to install with npm.
> The three mini-apps share code with each other, and only pnpm knows how to wire that up.

---

## 4. Setup — first time only

### Step 1 — Install all the code libraries

From the project folder:

```bash
pnpm install
```

This reads every `package.json` in the repo and downloads everything. Takes a few minutes the first time.

> 💡 If it seems to hang on a package, that's the `minimumReleaseAge` safety setting in
> `pnpm-workspace.yaml` — it refuses to install any npm package published less than 24 hours
> ago, to protect you from hacked packages. Leave it on.

### Step 2 — Create an empty database

The app needs a MySQL database to store calls, bots, users, etc.

First make sure MySQL is actually running:

```bash
brew services start mysql     # Mac, if you installed it with Homebrew
```

Then create an empty database:

```bash
mysql -u root -p -e "CREATE DATABASE \`omni-channel\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
```

It'll ask for your MySQL root password. If you've never set one, just press Enter.

> 💡 The `utf8mb4` bit matters — it's what lets the database store emoji and
> non-English characters, which a multilingual voice bot will absolutely run into.

### Step 3 — Tell the app where the database is

The app reads its settings from **environment variables**. The easiest way is to create a
file called `.env` in the project root and paste this in:

```bash
# ── Database ─────────────────────────────────────────────
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your-mysql-password
MYSQL_DATABASE=omni-channel

# ── Required ─────────────────────────────────────────────
# Port the API server listens on. The dashboard is started with PORT=8678.
PORT=8677
SESSION_SECRET=any-long-random-string-you-make-up-here

# ── Strongly recommended ─────────────────────────────────
PROVIDER_KEY_SECRET=another-long-random-string-32-chars-min
NODE_ENV=development

# ── Public URLs ──────────────────────────────────────────
BACKEND_URL=https://maveai.voicemeetme.net:8677/
FRONTEND_URL=https://maveai.voicemeetme.net:8678/

# Where the dashboard's /api proxy actually dials. Only needed when the hostname
# in BACKEND_URL does not resolve to the machine running the API server.
API_PROXY_TARGET=https://localhost:8677

# ── TLS ──────────────────────────────────────────────────
# Both servers read privkey.pem + fullchain.pem from this folder.
SSL_DIR=/absolute/path/to/Omni-Channel-Bot/ssl
ENABLE_HTTPS=true

# ── Optional: AI provider keys ───────────────────────────
# OPENAI_API_KEY=sk-...
# GEMINI_API_KEY=AIza...
# ANTHROPIC_API_KEY=sk-ant-...
# DEEPGRAM_API_KEY=...
# OLLAMA_API_URL=http://localhost:11434
```

> 🔒 `.env` holds your real password, so it's listed in `.gitignore` — it will never be
> committed. Don't remove that line.

**Or, if you prefer a single connection string**, use `DATABASE_URL` in place of the five
`MYSQL_*` lines:

```bash
DATABASE_URL=mysql://USERNAME:PASSWORD@HOST:PORT/DATABASE_NAME
```

Hosted platforms (Replit and most others) inject `DATABASE_URL` for you, and it wins if both
forms are present.

> ⚠️ **The catch with `DATABASE_URL`:** special characters in the password must be
> percent-encoded, or you get a confusing "Access denied". A password like `Ayan@1012` has to
> be written `Ayan%401012` — and likewise `:` → `%3A`, `/` → `%2F`, `#` → `%23`. The separate
> `MYSQL_*` variables have no such rule, which is why they're the safer choice locally.

Then load it into your terminal before starting anything:

```bash
set -a && source .env && set +a
```

(You'll need to run that line once in each new terminal window. On Windows, set the variables
however your shell prefers.)

### Step 4 — Set up the database tables

You don't need to do this manually — **the API server creates all its tables automatically
the first time it starts.** Skip to Step 5.

If you ever want to push schema changes by hand during development:

```bash
pnpm --filter @workspace/db run push
```

---

## 5. Starting the app

You need **two terminal windows** running at the same time — one for the backend, one for the
website. Run both from the project root:

```bash
# Terminal 1 — backend,  https://maveai.voicemeetme.net:8677
pnpm run dev:api

# Terminal 2 — frontend, https://maveai.voicemeetme.net:8678
pnpm run dev:web
```

That's the whole thing. Both scripts load `.env` themselves, so you do **not** need to run
`set -a && source .env && set +a` first.

### Terminal 1 — the backend (API server)

```bash
pnpm run dev:api
```

You should see something like:

```
Running pending DB migrations
DB migrations complete
Loaded TLS certificate  sslDir: ".../Omni-Channel-Bot/ssl"
Server listening  port: 8677  protocol: "https"
```

✅ Test it: open <https://maveai.voicemeetme.net:8677/api/healthz>.

### Terminal 2 — the website (dashboard)

```bash
pnpm run dev:web
```

Then open <https://maveai.voicemeetme.net:8678> in your browser.

### The long form

`dev:api` and `dev:web` are thin wrappers. Use these instead if you'd rather be explicit, or
need to change a port for a single run:

```bash
# Backend — equivalent to `pnpm run dev:api`
set -a && source .env && set +a
pnpm --filter @workspace/api-server run dev

# Frontend — equivalent to `pnpm run dev:web`
set -a && source .env && set +a
PORT=8678 BASE_PATH=/ pnpm --filter @workspace/dashboard run dev
```

The backend takes its port from `PORT` in `.env` (8677). The dashboard needs `PORT` and
`BASE_PATH` passed on the command line, because `PORT` in `.env` belongs to the backend.

The dashboard forwards its own `/api` path to the API server, so the browser only ever talks to
one origin and the session cookie stays first-party. `API_PROXY_TARGET` decides where that
forward goes (see below).

### HTTPS

Both servers serve TLS from the **`ssl/` folder at the root of this repository** — and nowhere
else. Drop your Let's Encrypt files there:

```
ssl/privkey.pem      # private key           (required)
ssl/fullchain.pem    # certificate + chain   (cert.pem is used if this is missing)
```

Those files are gitignored — never commit the private key. Renew them by replacing the files
and restarting both servers.

- Set `SSL_DIR` to read them from somewhere else.
- Set `ENABLE_HTTPS=false` to run plain HTTP instead — useful behind a load balancer that
  already terminates TLS, or for a laptop with no certificates.

The API server serves HTTPS automatically whenever it finds that folder, and marks the session
cookie `Secure` when it does.

### Logging in

The very first startup creates a default company and admin account for you:

| Field | Value |
|---|---|
| **Email** | `admin@voxagent.local` |
| **Password** | `voxagent` |

🔒 **Change this password before anyone else can reach the app.**

---

## 6. Optional extras

### Load 5 sample bot personalities

Gives you a Hotel Receptionist, and four other ready-made personas to play with instead of a blank screen:

```bash
pnpm --filter @workspace/scripts run seed-personas
```

Safe to run twice — it skips personas that already exist.

### Run the mobile app

```bash
PORT=8081 pnpm --filter @workspace/mobile run dev
```

Then scan the QR code with the **Expo Go** app on your phone. (Designed for the Replit
environment, so it may need tweaking to reach a laptop backend.)

### Watch the product explainer video

```bash
PORT=4000 BASE_PATH=/ pnpm --filter @workspace/video run dev
```

### Open the UI component sandbox

```bash
PORT=8082 pnpm --filter @workspace/mockup-sandbox run dev
```

---

## 7. Taking a tour of the dashboard

Once logged in, the left sidebar gives you:

| Page | What you do there |
|---|---|
| **Dashboard** | Live numbers: calls today, 24-hour call volume chart, why calls ended |
| **Call Log** | Every call, with filters. Hang up a live call, or dial an outbound one |
| **Bot Network** | Add/edit/delete your AI agents and see which are online |
| **Persona Engine** | Build the bot's personality — warmth, formality, phrases it must never say |
| **Configuration** | Conversation pacing, and the AI fallback chain (try GPT → if it fails, try Gemini…) |
| **Knowledge Base** | Q&A the bot has learned, sorted into L1/L2/L3 tiers by how often it's used |
| **Flow Editor** | Drag-and-drop the conversation flow |
| **Email Agent** | Connect a Microsoft 365 mailbox so the bot can read and reply to email |
| **Messaging Hub** | Send WhatsApp / Telegram / email, with a delivery log |
| **Calendar** | Pick free slots and send meeting invites |
| **Providers** | Store your OpenAI/Gemini/etc. API keys (encrypted in the database) |
| **Model Catalog** | Browse which AI models are available to pick from |
| **Users** | Add teammates and set their role — *owner-only page* |

**Roles**, from least to most powerful: `ANALYST` → `SUPERVISOR` → `ADMIN` → `OWNER`.

---

## 8. Every setting explained

| Variable | Required? | What it does |
|---|---|---|
| `MYSQL_HOST` `MYSQL_PORT` `MYSQL_USER` `MYSQL_PASSWORD` `MYSQL_DATABASE` | ✅ **Yes**\* | Where your MySQL database lives, as separate values. No percent-encoding needed. |
| `DATABASE_URL` | ✅ **Yes**\* | Same thing as one URI: `mysql://user:pw@host:3306/db`. Takes priority over the `MYSQL_*` vars. |
| `PORT` | ✅ **Yes** | Which port the app listens on — `8677` for the API server, `8678` for the dashboard. Both *crash on purpose* if this is missing. |
| `BACKEND_URL` | Recommended | The API server's public address, e.g. `https://maveai.voicemeetme.net:8677/`. |
| `FRONTEND_URL` | Recommended | The dashboard's public address. Also the only origin CORS accepts; unset means "reflect any origin", which is dev-only. |
| `API_PROXY_TARGET` | Optional | Where the dashboard's `/api` proxy actually dials. Defaults to `BACKEND_URL`; point it at `https://localhost:8677` when the public hostname doesn't resolve to the machine running the API. |
| `SSL_DIR` | Optional | Folder holding `privkey.pem` + `fullchain.pem`. Defaults to the repo's `ssl/`. |
| `ENABLE_HTTPS` | Optional | `false` forces plain HTTP even with certificates present. |
| `SESSION_SECRET` | ✅ In production | Signs the login cookie. Falls back to an insecure default in dev. |
| `PROVIDER_KEY_SECRET` | ✅ In production | Encrypts your stored AI API keys (AES-256). Without it, production refuses to save keys. |
| `BASE_PATH` | ✅ For the dashboard | The URL prefix the site is served from. Use `/`. |
| `NODE_ENV` | Recommended | `development` gives pretty colour logs; `production` tightens cookie security. |
| `LOG_LEVEL` | Optional | `debug`, `info`, `warn`, `error`. Defaults to `info`. |
| `OPENAI_API_KEY` | Optional | Only if you want the bot to actually think using OpenAI. |
| `GEMINI_API_KEY` | Optional | Same, for Google Gemini. |
| `ANTHROPIC_API_KEY` | Optional | Same, for Claude. |
| `DEEPGRAM_API_KEY` | Optional | Speech-to-text (turning phone audio into words). |
| `OLLAMA_API_URL` | Optional | Point at a local Ollama server to run models on your own machine. |

\* Supply **one** of the two forms — the five `MYSQL_*` variables, or a single `DATABASE_URL`.
You don't need both.

You can also add AI keys through the **Providers** page in the UI instead of env vars — those
get encrypted and stored in the database, which is the preferred way.

---

## 9. Handy commands

```bash
# ── Everyday ─────────────────────────────────────────────
pnpm install                                        # install/refresh dependencies
pnpm run dev:api                                    # start the backend  (https, :8677)
pnpm run dev:web                                    # start the website  (https, :8678)

# ── Checking your work ───────────────────────────────────
pnpm run typecheck                                  # check the whole repo for type errors
pnpm run build                                      # typecheck + build everything for production
pnpm --filter @workspace/api-server run test        # run the backend test suite (needs a database)

# ── Database ─────────────────────────────────────────────
pnpm --filter @workspace/db run push                # push schema changes (dev only)
pnpm --filter @workspace/db run generate            # create a new migration file

# ── After editing the API contract ───────────────────────
pnpm --filter @workspace/api-spec run codegen       # regenerate hooks + validation from openapi.yaml

# ── Sample data ──────────────────────────────────────────
pnpm --filter @workspace/scripts run seed-personas
```

---

## 10. When things go wrong

**"Use pnpm instead"**
You ran `npm install`. Run `pnpm install`.

**"No database configuration found."**
The variable isn't loaded in *this* terminal. Run `set -a && source .env && set +a` again.

**"PORT environment variable is required but was not provided."**
Same thing — the API server needs `PORT`, and the dashboard needs both `PORT` and `BASE_PATH`.
`pnpm run dev:api` / `pnpm run dev:web` set them for you.

**"ENABLE_HTTPS is set but no TLS material was found"**
`ssl/privkey.pem` is missing (or `SSL_DIR` points at the wrong folder). Put the certificates in
the repo's `ssl/` folder, or set `ENABLE_HTTPS=false` to run over plain HTTP.

**Pages spin forever, or the browser reports a proxy error**
The dashboard can't reach the API server. Check Terminal 1 is up, then check `API_PROXY_TARGET`
— if the public hostname in `BACKEND_URL` resolves to a *different* machine, set
`API_PROXY_TARGET=https://localhost:8677`.

**Logged out immediately after logging in**
The session cookie is marked `Secure` whenever HTTPS is on, so the browser drops it on a plain
`http://` page. Open the site over `https://`.

**"Migration failed — aborting startup"**
MySQL isn't running, or your settings point at a database that doesn't exist. Check both with:

```bash
mysql -u root -p -e "SHOW DATABASES;"     # is MySQL up? is `voxagent` listed?
```

**"Access denied for user ..."**
The username or password is wrong. If you're using `DATABASE_URL`, remember special
characters in the password must be percent-encoded (`p@ss` → `p%40ss`) — switching to the
separate `MYSQL_*` variables avoids that trap entirely.

**"Client does not support authentication protocol requested by server"**
An old MySQL client/driver against MySQL 8. This project uses `mysql2`, which handles MySQL 8's
default `caching_sha2_password` fine — if you hit this, you're on an unusually old MySQL build.

**The dashboard loads but every page is empty / keeps logging me out**
You skipped the Vite proxy fix in [Step 5](#terminal-2--the-website-dashboard). The website can't reach the backend.

**Typecheck complains that `@workspace/db` "has no exported members"**
The shared libraries must be built before the apps that use them:

```bash
pnpm run typecheck:libs      # then re-run your command
```

The top-level `pnpm run typecheck` already does this in the right order.

**Tailwind: "Cannot apply unknown utility class `dark`"**
In Tailwind v4, `dark` is a *variant* (`dark:bg-black`), not something you can `@apply`. Put
the `dark` class on the `<html>` element instead.

---

## 11. How it all fits together

```
        Your browser
             │
             ▼
   ┌───────────────────┐        ┌──────────────────────┐
   │   Dashboard       │  /api  │     API Server       │
   │   React + Vite    │ ─────► │     Express 5        │
   │   https :8678     │ proxy  │     https :8677      │
   └───────────────────┘        └──────────┬───────────┘
       ▲                                    ▲
       └──── TLS from ssl/ ─────────────────┘
                                           │
                            ┌──────────────┼──────────────┐
                            ▼              ▼              ▼
                     ┌────────────┐  ┌───────────┐  ┌───────────┐
                     │   MySQL 8  │  │ OpenAI /  │  │ MS Graph  │
                     │  (Drizzle) │  │ Gemini /  │  │ (email)   │
                     │            │  │ Ollama…   │  │           │
                     └────────────┘  └───────────┘  └───────────┘
```

**The golden rule of this codebase:** `lib/api-spec/openapi.yaml` is the single source of
truth. Change it, run `codegen`, and both the backend's validation rules *and* the frontend's
data-fetching code are regenerated to match. Don't hand-edit anything inside a `generated/`
folder — your changes will be wiped.

### A few MySQL quirks, if you're editing the backend

The database layer is MySQL, and MySQL is missing a couple of things other databases have.
If you write new queries, these will bite you:

- **There is no `RETURNING`.** You can't ask MySQL to hand back the row you just wrote. Use
  the `selectOne()` helper in [db-returning.ts](artifacts/api-server/src/lib/db-returning.ts):
  write first, then read the row back. For deletes, read *before* you delete.
- **There is no array column type.** Lists like a bot's supported languages are stored as
  JSON instead. MySQL also refuses to put a default value on a JSON or long-text column, so
  those defaults are filled in by JavaScript (`$defaultFn`) rather than by the database.
- **Times are pinned to UTC.** [index.ts](lib/db/src/index.ts) runs `SET time_zone = '+00:00'`
  on every connection. Without it, timestamps the database generates itself would silently be
  written in your machine's local time and read back as if they were UTC.
- **Table names are case-sensitive on Linux.** Stick to the existing lowercase naming so the
  same schema works on a Mac and on a deployed Linux server.

---

## 12. Deploying

The project is wired for **Replit** (see `.replit` and each `artifacts/*/.replit-artifact/artifact.toml`).
Replit's router serves the dashboard at `/` and the API at `/api`, which is why no proxy is
needed there.

To deploy anywhere else:

1. `pnpm run build`
2. Serve `artifacts/dashboard/dist/public` as a static site, with a rewrite sending all unknown paths to `index.html`
3. Run `node artifacts/api-server/dist/index.mjs` with `NODE_ENV=production`, `PORT`, `DATABASE_URL`, `SESSION_SECRET`, and `PROVIDER_KEY_SECRET` set
4. Point `/api/*` on your web server at the API process

Migrations run automatically on boot, before the server accepts any traffic.

**TLS in production.** Copy `privkey.pem` + `fullchain.pem` into the deployment's `ssl/` folder
(or set `SSL_DIR`) and the API server serves HTTPS itself — no extra flags. If a load balancer
or reverse proxy already terminates TLS, set `ENABLE_HTTPS=false` so the app speaks plain HTTP
behind it, and make sure the proxy sets `X-Forwarded-Proto` so login cookies still get `Secure`.

**DNS has to point at the box.** The hostname in `BACKEND_URL` / `FRONTEND_URL` must resolve to
the machine actually running these processes. When it doesn't — split-horizon DNS, or a laptop
behind NAT — the dashboard's `/api` proxy dials the wrong host and every page fails; set
`API_PROXY_TARGET=https://localhost:8677` to send that hop over loopback instead.

---

## 13. Before you go live — a short security checklist

- [ ] Change the `admin@voxagent.local` password
- [ ] Set a real, random `SESSION_SECRET` (32+ characters)
- [ ] Set a real, random `PROVIDER_KEY_SECRET` — otherwise stored AI keys use a known dev seed
- [ ] Set `NODE_ENV=production` so login cookies become `secure` + `sameSite: strict` (the `secure` flag is also set automatically whenever HTTPS is on)
- [ ] Set `FRONTEND_URL` — without it, CORS reflects *any* origin, which is a dev-only default
- [ ] Keep `ssl/privkey.pem` out of git (the `ssl/` folder is already in `.gitignore`) and re-check it after every certificate renewal
- [ ] Rotate the default webhook secret (`voxagent-webhook-secret-default`) used to accept incoming call events
- [ ] Never commit your `.env` file
# omni-channel-bot
