# Personal Contact Book

A multi-page web contact manager: **FastAPI (Python) backend + Node.js/Tailwind frontend**, Supabase Postgres storage with an offline SQLite fallback, email/password accounts that keep each user's contacts separate, and a light cream glass UI that installs as a PWA on mobile.

Add, search, view, edit and delete contacts - name, phone, email, company, address, notes and a photo - through seven routes: **Contacts, Favorites, Groups, Settings** plus the **Welcome, Sign in and Create account** pages. This is a multi-page app, not a single page: `frontend/server.js` renders each route from a shared shell plus one page file, and every page loads only what it needs (the Contacts script never ships on Settings, the auth pages ship no page script at all). The Node dev server serves the pages, proxies `/api/*` to the Python API, and live-reloads the browser as files change.

Source: **https://github.com/JEETESHWARMAHTO/contact-book**

## Features

- **Accounts with separate data** - sign up / sign in with email and password (Supabase Auth, auto-confirm for this first phase). Signed-in users only ever read and write their own rows (Postgres RLS via `user_id`); signed-out visitors keep working against the shared dev data.
- **Welcome + auth pages** - a proper welcome page at `/welcome`, `/login` and `/signup` in a bare shell (no app nav), with client-side validation and human error messages. First-time visitors to `/` are routed through the welcome page once.
- **Contacts CRUD with photos** - add (name required), view in a popup, edit, delete with confirmation. Photos are picked in the form and resized client-side to a 320px JPEG.
- **Expanding search** - the search icon in the header expands into a field and searches name, phone, email, company, address and notes as you type.
- **Favorites and Groups pages** - Favorites lists starred contacts from `GET /api/contacts/favorites` with a star toggle on every entry; Groups shows chips with counts from `GET /api/contacts/groups` and filters on click. The add/edit form carries a favorite toggle and a group field.
- **Mobile rows / desktop grid** - one column of card rows on phones (edit/delete reachable by tap, never hover-only), two on tablets, three to four on desktop.
- **Cream glassmorphism** - warm ivory background, dark warm-grey ink, a single Google-blue accent, frosted white glass panels with soft shadows, Google Contacts-style avatar colours.
- **PWA** - installable on mobile: `manifest.webmanifest`, a service worker that caches static assets (never the API or live-reload stream), and real PNG icons (192/512/maskable/apple-touch) generated from the app logo. Settings carries an "Install app" button.
- **Live reload** - edits under `frontend/public/` push over SSE: CSS hot-swaps in place, everything else reloads the page (with a warning if you are mid-edit in a form).
- **Offline SQLite fallback** - zero-config local store with a demo seed when Supabase is not configured.
- Add-contact FAB, top pill nav on desktop, bottom tab bar on mobile, active state rendered by the server.

## Project structure

```
contact-book/
├── README.md
├── .gitignore
├── backend/                  # Python API (FastAPI)
│   ├── app.py                # Routes: health, config, contacts CRUD, favorites, groups, auth
│   ├── repository.py         # Storage facade: Supabase when configured, SQLite otherwise
│   ├── store_supabase.py     # Postgres via Supabase REST (PostgREST), JWT + RLS scoping
│   ├── store_sqlite.py       # Local offline store (search, favorite/group filters, user scoping)
│   ├── database.py           # SQLite schema, in-place upgrades, demo seed
│   ├── schemas.py            # Pydantic models (favorite, group, auth credentials)
│   ├── requirements.txt      # fastapi, uvicorn
│   ├── .env.example          # documented environment variable names
│   └── data/contacts.db      # created automatically (gitignored)
│
├── frontend/                 # Node dev server + Tailwind CSS + vanilla JS
│   ├── server.js             # Page router (7 routes + 404) + static + /api proxy + SSE reload
│   │                         #   + automatic CSS rebuild + API auto-start + bare auth shells
│   ├── package.json          # dev, css, css:build scripts
│   ├── src/input.css         # Design tokens, glass components, nav, intro  <- theme lives here
│   └── public/
│       ├── layout.html       # Shared document shell (head, sprite, orbs, slots, scripts)
│       ├── manifest.webmanifest  # PWA manifest (install metadata)
│       ├── sw.js             # Service worker: cached statics, live API
│       ├── icons/            # PNG app icons (192, 512, maskable, apple-touch)
│       ├── css/styles.css    # Build output (regenerated, gitignored)
│       ├── partials/
│       │   ├── header.html   # Sticky header: logo, nav, search, auth slot, API banner
│       │   ├── nav-bottom.html  # Mobile bottom tab bar
│       │   └── modals.html   # Add/edit (with favorite + group), detail, delete-confirm
│       ├── pages/
│       │   ├── contacts.html # Stats, contact grid, empty and error states
│       │   ├── favorites.html  # Starred contacts with star toggle
│       │   ├── groups.html     # Group chips with counts + filtered list
│       │   ├── settings.html # Account card, install app, storage status, Google OAuth
│       │   ├── welcome.html  # Landing page (features + CTAs)
│       │   ├── login.html    # Email/password sign in
│       │   └── signup.html   # Email/password account creation
│       └── js/
│           ├── shared.js     # CB helpers, API client, search, live reload
│           ├── auth.js       # Session store, JWT on every /api call, auto-refresh, auth forms
│           ├── contacts.js   # Contacts CRUD + popups + favorites/groups + 3D tilt
│           ├── settings.js   # Health readout + install prompt + Google OAuth
│           └── shader-bg.js  # WebGL mesh-gradient background + opening animation
│
├── scripts/
│   ├── keep-alive.ps1        # Keeps the API (:8000) and web (:3000) processes alive
│   ├── enable-email-auth.ps1 # Re-applies Supabase email/password + autoconfirm config
│   ├── enable-google-auth.ps1  # Turns on the Supabase Google provider
│   ├── check-pages.ps1       # Route + API smoke test (all 7 routes)
│   └── screenshots.py        # Playwright captures (7 routes x 3 viewports)
│
├── tests/                    # pytest suite: pages, API, UI flows, responsive, a11y, auth
└── screenshots/              # Output of scripts/screenshots.py (gitignored)
```

Pages are rendered server-side: `server.js` merges `layout.html` with the shared partials and the matching file in `pages/`, then fills the `{{title}}`, `{{page}}`, `{{content}}`, `{{modals}}`, `{{fab}}`, `{{page_script}}` and `{{head_extra}}` slots plus the `{{active:name}}` / `{{current:name}}` nav markers. The auth routes are rendered in "bare" mode: their header and bottom-nav includes are stripped. Unknown paths get a plain 404 page, not the app shell.

## Run it (Windows)

```powershell
# Backend -> http://localhost:8000 (OpenAPI docs at /docs)
cd C:\Users\jeete\contact-book\backend
pip install -r requirements.txt
python -m uvicorn app:app --reload --port 8000

# Frontend -> http://localhost:3000
cd C:\Users\jeete\contact-book\frontend
npm install          # if PowerShell blocks npm, run: npm.cmd install
npm run dev
```

`npm run dev` also auto-starts the Python API and rebuilds the Tailwind CSS whenever `src/` or `public/` change, so one command brings the whole stack up. Open **http://localhost:3000** - first visit goes through the welcome page, edits hot-reload in the browser. The browser talks only to `:3000`; `/api/*` is proxied to the Python API on `:8000`.

| Port | What                                   |
| ---- | -------------------------------------- |
| 3000 | Web app (Node dev server)              |
| 8000 | Python API, interactive docs at `/docs` |

To keep both processes running unattended:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\keep-alive.ps1
```

It checks every 10 seconds and restarts anything that stops listening (injecting the Supabase environment variables), logging to `scripts/keep-alive.log`.

### Commands

| Where        | Command                                        | What it does                            |
| ------------ | ---------------------------------------------- | --------------------------------------- |
| `frontend`   | `npm run dev`                                  | Dev server + proxy + live reload + CSS rebuild + API auto-start |
| `frontend`   | `npm run css:build`                            | One-shot minified CSS build             |
| `backend`    | `python -m uvicorn app:app --reload --port 8000` | Python API (`--reload` for dev)       |
| repo root    | `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\keep-alive.ps1` | Keeps API + web alive on localhost |
| repo root    | `.\scripts\check-pages.ps1`                    | Route + `/api/health` + `/api/config` smoke test |
| repo root    | `python scripts\screenshots.py`                | Playwright screenshots into `screenshots/` |
| repo root    | `python -m pytest`                             | Test suite (`tests/`, 61 tests)         |

## API

All routes return JSON; errors use FastAPI's `{"detail": ...}` shape. The OpenAPI schema is at `http://localhost:8000/docs`.

| Method | Route                     | Description                                            |
| ------ | ------------------------- | ------------------------------------------------------ |
| GET    | `/api/health`             | Status, active storage backend, contact count          |
| GET    | `/api/config`             | Browser config: Supabase URL, publishable anon key, `authEnabled`, storage |
| GET    | `/api/contacts`           | List/search. Query: `q` (text), `favorite` (true/false), `group` (label) |
| POST   | `/api/contacts`           | Create a contact (201); signed-in users get `user_id` set |
| GET    | `/api/contacts/favorites` | Only contacts marked as favorite                       |
| GET    | `/api/contacts/groups`    | Group summary: `[{"group": "Work", "count": 4}, ...]` (empty group shown as `Ungrouped`) |
| GET    | `/api/contacts/{id}`      | View one contact (404 if missing or owned by another user) |
| PUT    | `/api/contacts/{id}`      | Partial update - only provided fields change           |
| DELETE | `/api/contacts/{id}`      | Delete (204, 404 if missing or owned by another user)  |
| POST   | `/api/auth/signup`        | `{email, password}` -> `{user, session}` (password min 8 chars; 409 if the email exists) |
| POST   | `/api/auth/login`         | `{email, password}` -> `{access_token, refresh_token, expires_in, user}` (401 on bad credentials) |
| POST   | `/api/auth/refresh`       | `{refresh_token}` -> a fresh session (tokens rotate)   |
| POST   | `/api/auth/logout`        | Ends the session (always 200)                          |
| GET    | `/api/auth/user`          | `Authorization: Bearer <jwt>` -> `{id, email, created_at}` (401 without a valid token) |

`/api/contacts/favorites` and `/api/contacts/groups` are matched before `/api/contacts/{id}`, so they are not treated as numeric ids. In `?group=`, `Ungrouped` is accepted and mapped to the empty group.

## Accounts and data separation

- **Sign-up/sign-in** go through the FastAPI routes above, which call Supabase Auth with the publishable anon key only. Email/password is enabled with auto-confirm, so new accounts work immediately without an email inbox (first-phase product decision).
- **Row scoping**: `public.contacts` has a `user_id uuid` column and RLS policies (`user_id = auth.uid() OR user_id IS NULL`). With a valid `Authorization: Bearer <jwt>` the API passes that token to PostgREST, so Postgres enforces the scope on every read and write; creates stamp `user_id`.
- **No token** keeps the original behaviour (service key, shared dev data), so the app and the test suite work without an account.
- **Invalid/expired token** is a `401 {"detail":"Sign in again to continue"}` - the API never silently falls back to admin mode. The browser client (`js/auth.js`) stores the session in `localStorage`, attaches the JWT to every `/api/*` call, and transparently refreshes once on expiry.
- The JWT is verified against Supabase (`/auth/v1/user`, cached ~60s in-process); no signatures are hand-rolled, and no passwords or tokens are ever logged.

## Storage and Google sign-in

- **Primary**: Supabase Postgres (project ref `pqpsxlvultufslfzuxlf`) when `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are set.
- **Fallback**: local SQLite at `backend/data/contacts.db`, so the app works offline with zero config (demo contacts are seeded on first run).
- `GET /api/health` reports the active store (`storage` field), which Settings > Storage also displays.
- Environment variables are read from the process environment - on Windows set them at **user scope** (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_ACCESS_TOKEN`) so manual runs and `keep-alive.ps1` both pick them up. `backend/.env.example` documents the names; the service key is server-side only.
- Email/password auth config can be re-applied any time with `.\scripts\enable-email-auth.ps1` (Management API, needs `SUPABASE_ACCESS_TOKEN`).

**Google sign-in** is wired in the UI (Settings page, Supabase Auth OAuth) but the provider is off until you enable it:

```powershell
.\scripts\enable-google-auth.ps1 -ClientId "xxxx.apps.googleusercontent.com" -ClientSecret "GOCSPX-..."
```

The script reads `SUPABASE_ACCESS_TOKEN` + `SUPABASE_URL` from your user environment, PATCHes the project's auth config, and prints this redirect URI to register in Google Cloud Console (APIs & Services > Credentials > your OAuth client > **Authorized redirect URIs**):

```
https://pqpsxlvultufslfzuxlf.supabase.co/auth/v1/callback
```

Then restart the Python API so `/api/config` reports `authEnabled: true`.

**Key handling**: `GET /api/config` exposes only the publishable anon key (designed for the browser) plus `authEnabled`. The service key never leaves the Python process and is never sent to the browser.

## Design and theme

- The theme lives in **`frontend/src/input.css`**: a Tailwind v4 `@theme` token block (colours, fonts) plus the component layer (glass panels, buttons, nav, search, FAB, modals, intro).
- To restyle: edit the tokens in `@theme`, then run `npm run css:build` - or just save, since the dev server rebuilds CSS automatically.
- Palette: warm cream/ivory background (`#F7F4EC` to `#FDFCF9`), dark warm-grey ink, one Google-blue accent (`#1a73e8`), frosted white glass panels, Google Contacts-style avatar colours for initials.

## Testing

```powershell
# from the repo root - API + browser suite in tests/
python -m pytest

# one-time: download the Playwright browser
python -m playwright install chromium

# UI screenshots (app must be running on :3000)
python scripts\screenshots.py
```

The suite (61 tests) covers: all routes render with the shared shell and no stray template tokens, the full contacts CRUD API, browser flows (create/edit/delete/search/nav) with zero console errors, mobile rows and tap-reachable actions, accessibility basics (headings, accessible names, focus visibility, reduced motion), and the auth API (signup/login/refresh, wrong-password 401, duplicate-email 409, garbage token 401, and two users unable to see each other's contacts).

`screenshots.py` captures all seven routes at desktop (1440x900), tablet (834x1112) and mobile (390x844) into `screenshots/`, and exits non-zero if the browser reports console or page errors. `scripts\check-pages.ps1` is the fast route smoke test when you do not want a browser.

## Source repository

```
https://github.com/JEETESHWARMAHTO/contact-book
```

```powershell
git clone https://github.com/JEETESHWARMAHTO/contact-book.git
cd contact-book
cd frontend; npm install; cd ..
cd backend; pip install -r requirements.txt; cd ..
```

Secrets are never in the repository: they live in user-scope environment variables (or a gitignored `.env`), and `.env.example` holds names only.

## Roadmap

1. **Activate Google OAuth** - run `enable-google-auth.ps1`, register the redirect URI, then Google sign-in works next to email/password.
2. **Cross-device sync for signed-in users** - the per-user scoping is live; next is pushing edits across sessions.
3. **Deployment** - host the API and the frontend; keep secrets in environment variables, never in the repository.

## Notes

- **Windows: npm** - npm is installed as `npm.cmd`; if PowerShell execution policy blocks the `npm` shim, call `npm.cmd install` / `npm.cmd run dev` explicitly.
- **Windows: spawning `.cmd`** - Node >= 18.20/20.12 refuses to spawn `.cmd` files directly (CVE-2024-27980, `EINVAL`), so `server.js` routes the Tailwind CLI through `shell: true` on win32. Any script that spawns `npm.cmd`/`tailwindcss.cmd` must do the same.
- **Git** - installed via winget; the repository is initialized with `main` as the default branch and pushed to GitHub (remote `origin`).
- **Secrets stay in environment variables** (user scope on Windows) or a gitignored `.env` - never in the repository; `.env.example` holds names only.
- Responsive: one column on phones, two on tablets, three to four on desktop; hover tilt is disabled on touch and `prefers-reduced-motion` is respected.
- The background is a WebGL mesh gradient ported to vanilla JS, with an opening animation (once per session) and grain texture.
