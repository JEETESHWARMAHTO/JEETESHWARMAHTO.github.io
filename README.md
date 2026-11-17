# Personal Contact Book

A multi-page web contact manager: **FastAPI (Python) backend + Node.js/Tailwind frontend**, Supabase Postgres storage with an offline SQLite fallback, and a liquid-glass dark UI.

Add, search, view, edit and delete contacts - name, phone, email, company, address, notes and a photo - through four pages: **Contacts, Favorites, Groups and Settings**. This is a multi-page app, not a single page: `frontend/server.js` renders each route from a shared shell plus one page file, and every page loads only what it needs (the Contacts script never ships on Settings, Favorites and Groups ship no page script at all). The Node dev server serves the pages, proxies `/api/*` to the Python API, and live-reloads the browser as files change.

## Features

- **Contacts CRUD with photos** - add (name required), view in a popup, edit, delete with confirmation. Photos are picked in the form and resized client-side to a 320px JPEG.
- **Expanding search** - the search icon in the header top-right expands into a field and searches name, phone, email, company, address and notes as you type.
- **Four pages** - Contacts (`/`), Favorites (`/favorites`), Groups (`/groups`), Settings (`/settings`). Favorites and Groups currently show placeholder panels; their API endpoints are already live.
- **Mobile rows / desktop grid** - one column of card rows on phones, two on tablets, three to four on desktop.
- **Google-Contacts-inspired calm dark palette** - deep navy neutrals, a single Google-blue accent, and colourful gradient avatars for contacts without a photo.
- **Liquid-glass styling** - frosted glass panels, buttons and nav, 3D tilt cards, an opening splash and a WebGL mesh-gradient background.
- **Live reload** - edits under `frontend/public/` push over SSE: CSS hot-swaps in place, everything else reloads the page (with a warning if you are mid-edit in a form).
- **Offline SQLite fallback** - zero-config local store with a demo seed when Supabase is not configured.
- Add-contact FAB in the lower-left corner that expands on hover (Contacts page); top pill nav on desktop, bottom tab bar on mobile, active state rendered by the server.

## Project structure

```
contact-book/
├── README.md
├── .gitignore
├── backend/                  # Python API (FastAPI)
│   ├── app.py                # Routes: health, config, contacts CRUD, favorites, groups
│   ├── repository.py         # Storage facade: Supabase when configured, SQLite otherwise
│   ├── store_supabase.py     # Postgres via Supabase REST (PostgREST)
│   ├── store_sqlite.py       # Local offline store (search, favorite + group filters)
│   ├── database.py           # SQLite schema, in-place upgrades, demo seed
│   ├── schemas.py            # Pydantic models (incl. favorite, group)
│   ├── requirements.txt      # fastapi, uvicorn
│   ├── .env.example          # documented environment variable names
│   └── data/contacts.db      # created automatically (gitignored)
│
├── frontend/                 # Node dev server + Tailwind CSS + vanilla JS
│   ├── server.js             # Page router + static files + /api proxy + SSE live reload
│   │                         #   + automatic CSS rebuild + API auto-start
│   ├── package.json          # dev, css, css:build scripts
│   ├── src/input.css         # Design tokens, liquid glass, nav, intro  <- theme lives here
│   └── public/
│       ├── layout.html       # Shared document shell (head, sprite, orbs, slots, scripts)
│       ├── css/styles.css    # Build output (regenerated, gitignored)
│       ├── partials/
│       │   ├── header.html   # Sticky header: logo, desktop nav, expanding search, API banner
│       │   ├── nav-bottom.html  # Mobile bottom tab bar
│       │   └── modals.html   # Add/edit, detail and delete-confirm popups
│       ├── pages/
│       │   ├── contacts.html # Stats, contact grid, empty and error states
│       │   ├── favorites.html  # Placeholder panel
│       │   ├── groups.html     # Placeholder panel
│       │   └── settings.html # Google account, auto-sync, storage status
│       └── js/
│           ├── shared.js     # CB helpers, API client, search, live reload
│           ├── contacts.js   # Contacts CRUD + popups + 3D tilt
│           ├── settings.js   # Health readout + Google OAuth (Supabase)
│           └── shader-bg.js  # WebGL mesh-gradient background + opening animation
│
├── scripts/
│   ├── keep-alive.ps1        # Keeps the API (:8000) and web (:3000) processes alive
│   ├── enable-google-auth.ps1  # Turns on the Supabase Google provider
│   ├── check-pages.ps1       # Route + API smoke test
│   └── screenshots.py        # Playwright captures (desktop / tablet / mobile)
│
├── tests/                    # Playwright + pytest suite
└── screenshots/              # Output of scripts/screenshots.py
```

Pages are rendered server-side: `server.js` merges `layout.html` with the shared partials and the matching file in `pages/`, then fills the `{{title}}`, `{{page}}`, `{{content}}`, `{{modals}}`, `{{fab}}`, `{{page_script}}` and `{{head_extra}}` slots plus the `{{active:name}}` / `{{current:name}}` nav markers. Unknown paths get a plain 404 page, not the app shell.

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

`npm run dev` also auto-starts the Python API and rebuilds the Tailwind CSS whenever `src/` or `public/` change, so one command brings the whole stack up. Open **http://localhost:3000** - edits hot-reload in the browser. The browser talks only to `:3000`; `/api/*` is proxied to the Python API on `:8000`.

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
| repo root    | `python -m pytest`                             | Test suite (`tests/`)                   |

## API

All routes return JSON; errors use FastAPI's `{"detail": ...}` shape. The OpenAPI schema is at `http://localhost:8000/docs`.

| Method | Route                     | Description                                            |
| ------ | ------------------------- | ------------------------------------------------------ |
| GET    | `/api/health`             | Status, active storage backend, contact count          |
| GET    | `/api/config`             | Browser config: Supabase URL, publishable anon key, `authEnabled`, storage |
| GET    | `/api/contacts`           | List/search. Query: `q` (text), `favorite` (true/false), `group` (label) |
| POST   | `/api/contacts`           | Create a contact (201)                                 |
| GET    | `/api/contacts/favorites` | Only contacts marked as favorite                       |
| GET    | `/api/contacts/groups`    | Group summary: `[{"group": "Work", "count": 4}, ...]` (empty group shown as `Ungrouped`) |
| GET    | `/api/contacts/{id}`      | View one contact (404 if missing)                      |
| PUT    | `/api/contacts/{id}`      | Partial update - only provided fields change           |
| DELETE | `/api/contacts/{id}`      | Delete (204, 404 if missing)                           |

`/api/contacts/favorites` and `/api/contacts/groups` are matched before `/api/contacts/{id}`, so they are not treated as numeric ids. In `?group=`, `Ungrouped` is accepted and mapped to the empty group.

## Storage and Google sign-in

- **Primary**: Supabase Postgres (project ref `pqpsxlvultufslfzuxlf`) when `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are set.
- **Fallback**: local SQLite at `backend/data/contacts.db`, so the app works offline with zero config (demo contacts are seeded on first run).
- `GET /api/health` reports the active store (`storage` field), which Settings > Storage also displays.
- Environment variables are read from the process environment - on Windows set them at **user scope** (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`) so manual runs and `keep-alive.ps1` both pick them up. `backend/.env.example` documents the names; the service key is server-side only.

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
- Palette direction: calm dark neutrals (deep navy surface, soft blue-grey text) with a single Google-blue accent, plus Google Contacts-style avatar colours for the initials gradients.
- The visual design pass is ongoing; expect token and component tweaks.

## Testing

```powershell
# from the repo root - API + browser suite in tests/
python -m pytest

# one-time: download the Playwright browser
python -m playwright install chromium

# UI screenshots (app must be running on :3000)
python scripts\screenshots.py
```

`screenshots.py` captures all four routes at desktop (1440x900), tablet (834x1112) and mobile (390x844) into `screenshots/`, and exits non-zero if the browser reports console or page errors. `scripts\check-pages.ps1` is the fast route smoke test when you do not want a browser.

## Roadmap

1. **Activate Google OAuth** - run `enable-google-auth.ps1`, register the redirect URI, then sign-in works end to end.
2. **Per-user data after sign-in** - scope contacts to the signed-in account and sync them across devices.
3. **Deployment** - host the API and the frontend; keep secrets in environment variables, never in the repository.

## Notes

- **Windows: npm** - npm is installed as `npm.cmd`; if PowerShell execution policy blocks the `npm` shim, call `npm.cmd install` / `npm.cmd run dev` explicitly.
- **Windows: spawning `.cmd`** - Node >= 18.20/20.12 refuses to spawn `.cmd` files directly (CVE-2024-27980, `EINVAL`), so `server.js` routes the Tailwind CLI through `shell: true` on win32. Any script that spawns `npm.cmd`/`tailwindcss.cmd` must do the same.
- **No git on this machine** - repositories are pulled as source archives rather than cloned, so there is no `git` command and no remotes to push to.
- **Secrets stay in environment variables** (user scope on Windows) or a gitignored `.env` - never in the repository; `.env.example` holds names only.
- Responsive: one column on phones, two on tablets, three to four on desktop; hover tilt is disabled on touch and `prefers-reduced-motion` is respected.
- The background is a WebGL mesh gradient (paper-design style) ported to vanilla JS, with an opening animation (once per session) and grain texture.
