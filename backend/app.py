"""
Personal Contact Book - Python API server (FastAPI).

Run:
    python -m uvicorn app:app --reload --port 8000

Core features: add, search, view, update, delete contacts, plus
favorites and group filters.
Storage: Supabase/Postgres when SUPABASE_URL + SUPABASE_SERVICE_KEY are
set (primary), local SQLite otherwise (offline fallback).

Auth (email + password via Supabase Auth, browser talks only to /api/*):
    POST /api/auth/signup    {email, password}   -> {user, session}
    POST /api/auth/login     {email, password}   -> {access_token,
                                                     refresh_token,
                                                     expires_in, user}
    POST /api/auth/refresh   {refresh_token}     -> same shape as login
    POST /api/auth/logout    (token ignored)     -> {"ok": true}
    GET  /api/auth/user      Bearer <jwt>        -> {id, email, created_at}
    /api/contacts* accept an optional Authorization: Bearer <jwt>: with a
    valid token rows are scoped to that user (RLS), an invalid token is a
    401, no token keeps the shared dev data (service key). Supabase config:
    scripts/enable-email-auth.ps1; Google sign-in: /api/config and
    scripts/enable-google-auth.ps1.
"""
import json
import os
import re
import time
import urllib.error
import urllib.request
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

import database
import repository
import schemas

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")

_google_cache = {"checked_at": 0.0, "enabled": False}
_token_cache: dict = {}  # access token -> (expires_at, user), pruned at 60s TTL

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def google_provider_enabled() -> bool:
    """Ask Supabase Auth whether the Google provider is switched on (cached 60s)."""
    if not (SUPABASE_URL and SUPABASE_ANON_KEY):
        return False
    if time.time() - _google_cache["checked_at"] < 60:
        return _google_cache["enabled"]

    enabled = False
    req = urllib.request.Request(
        f"{SUPABASE_URL}/auth/v1/authorize?provider=google",
        headers={"apikey": SUPABASE_ANON_KEY},
    )
    try:
        with urllib.request.urlopen(req, timeout=6) as res:
            enabled = res.status in (200, 302)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        enabled = "provider is not enabled" not in body and exc.code not in (400, 404)
    except Exception:
        enabled = False

    _google_cache.update(checked_at=time.time(), enabled=enabled)
    return enabled


# --------------------------------------------------------------------- auth
def _auth_call(method: str, path: str, body=None, token: Optional[str] = None):
    """Call Supabase Auth with the anon key. Returns (status, payload).

    Never raises provider errors to the caller - callers map status/payload
    to readable messages. Passwords and tokens are not logged.
    """
    if not (SUPABASE_URL and SUPABASE_ANON_KEY):
        raise HTTPException(status_code=503, detail="Authentication is not configured")
    headers = {"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        f"{SUPABASE_URL}/auth/v1/{path}", data=data, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            raw = res.read()
            return res.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            return exc.code, json.loads(raw) if raw else {}
        except ValueError:
            return exc.code, {}
    except Exception:
        raise HTTPException(
            status_code=503, detail="Authentication service is unavailable"
        )


def _auth_error(status: int, payload: dict, fallback: str) -> None:
    """Map a Supabase Auth error to a readable API error (no provider dumps)."""
    msg = str(payload.get("msg") or payload.get("error_description") or "").lower()
    code = str(payload.get("error_code") or payload.get("code") or "")
    if code == "user_already_exists" or "already registered" in msg:
        raise HTTPException(
            status_code=409, detail="An account with that email already exists"
        )
    if code == "invalid_credentials" or "invalid login credentials" in msg:
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    if code == "weak_password" or "password should be at least" in msg:
        raise HTTPException(
            status_code=400, detail="Password must be at least 8 characters"
        )
    if status >= 500:
        raise HTTPException(
            status_code=502, detail="Authentication service error, try again"
        )
    raise HTTPException(status_code=400, detail=fallback)


def _check_credentials(payload: schemas.AuthCredentials) -> tuple:
    """Validate email format and password length, return the cleaned values."""
    email = (payload.email or "").strip()
    password = payload.password or ""
    if len(email) > 254 or not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    if len(password) < 8:
        raise HTTPException(
            status_code=400, detail="Password must be at least 8 characters"
        )
    return email, password


def _session(data: dict) -> dict:
    """Normalize a GoTrue session payload to the API session shape."""
    return {
        "access_token": data.get("access_token", ""),
        "refresh_token": data.get("refresh_token", ""),
        "expires_in": data.get("expires_in"),
        "user": data.get("user"),
    }


def _bearer(authorization: Optional[str]) -> Optional[str]:
    """Extract the token from 'Bearer <jwt>'; None when no header was sent."""
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="Sign in again to continue")
    return token.strip()


def _verify_token(token: str) -> dict:
    """Resolve a user JWT via Supabase /auth/v1/user (result cached 60s)."""
    hit = _token_cache.get(token)
    if hit and hit[0] > time.time():
        return hit[1]
    status, user = _auth_call("GET", "user", token=token)
    if status >= 400 or not isinstance(user, dict) or not user.get("id"):
        raise HTTPException(status_code=401, detail="Sign in again to continue")
    if len(_token_cache) > 256:
        _token_cache.clear()
    _token_cache[token] = (time.time() + 60, user)
    return user


def current_token(authorization: Optional[str] = Header(None)) -> Optional[str]:
    """Optional Authorization: Bearer <jwt> dependency for /api/contacts*.

    No header -> None (unscoped dev access via the service key).
    Valid header -> the token (rows scoped by RLS). Invalid/expired -> 401.
    """
    token = _bearer(authorization)
    if token is None:
        return None
    _verify_token(token)
    return token


def _scope(token: Optional[str]) -> tuple:
    """(user_id, user_token) for this request - both None without a token."""
    if not token:
        return None, None
    return _verify_token(token).get("id"), token


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Prepare local storage only when the SQLite fallback is the active store."""
    if repository.storage_name().startswith("sqlite"):
        database.init_db()
        database.seed_demo_contacts()
    yield


app = FastAPI(
    title="Personal Contact Book API",
    version="0.1.0",
    description="Add, search, view and delete contacts. Local-first storage.",
    lifespan=lifespan,
)

# Frontend dev server (Node.js) runs on :3000 -> allow it to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------ health
@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "contact-book-api",
        "storage": repository.storage_name(),
        "contacts": repository.count_contacts(),
    }


# ------------------------------------------------------------------ config
@app.get("/api/config")
def config() -> dict:
    """Public browser config: Supabase project + auth availability.

    Only the anon (publishable) key is exposed - it is designed for the browser.
    The service key never leaves the Python process.
    """
    return {
        "supabaseUrl": SUPABASE_URL,
        "supabaseAnonKey": SUPABASE_ANON_KEY,
        "authEnabled": google_provider_enabled(),
        "provider": "google",
        "storage": repository.storage_name(),
    }


# -------------------------------------------------------------------- auth
@app.post("/api/auth/signup")
def signup(payload: schemas.AuthCredentials) -> dict:
    """Create an account. Returns {user, session}; session is null only when
    Supabase could not confirm the address immediately."""
    email, password = _check_credentials(payload)
    status, data = _auth_call("POST", "signup", {"email": email, "password": password})
    if status >= 400:
        _auth_error(status, data, "Could not create the account")
    if data.get("access_token"):
        return {"user": data.get("user"), "session": _session(data)}
    return {"user": data, "session": None}


@app.post("/api/auth/login")
def login(payload: schemas.AuthCredentials) -> dict:
    """Sign in. Returns {access_token, refresh_token, expires_in, user}."""
    email, password = _check_credentials(payload)
    status, data = _auth_call(
        "POST", "token?grant_type=password", {"email": email, "password": password}
    )
    if status >= 400:
        _auth_error(status, data, "Could not sign in")
    return _session(data)


@app.post("/api/auth/refresh")
def refresh(payload: schemas.AuthRefresh) -> dict:
    """Exchange a refresh token for a new session (same shape as login)."""
    token = (payload.refresh_token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Missing refresh token")
    status, data = _auth_call(
        "POST", "token?grant_type=refresh_token", {"refresh_token": token}
    )
    if status >= 400:
        raise HTTPException(status_code=401, detail="Session expired, sign in again")
    return _session(data)


@app.post("/api/auth/logout")
def logout(authorization: Optional[str] = Header(None)) -> dict:
    """Sign out. Stateless - the browser just drops its tokens."""
    return {"ok": True}


@app.get("/api/auth/user")
def auth_user(authorization: Optional[str] = Header(None)) -> dict:
    """Current user profile {id, email, created_at} for a valid access token."""
    token = _bearer(authorization)
    if token is None:
        raise HTTPException(status_code=401, detail="Sign in again to continue")
    status, user = _auth_call("GET", "user", token=token)
    if status >= 400:
        raise HTTPException(status_code=401, detail="Sign in again to continue")
    return {
        "id": user.get("id"),
        "email": user.get("email"),
        "created_at": user.get("created_at"),
    }


# ------------------------------------------------------------------ contacts
@app.get("/api/contacts", response_model=list[schemas.ContactOut])
def list_contacts(
    q: str = Query("", max_length=100, description="Search name/phone/email/..."),
    favorite: Optional[bool] = Query(None, description="true/false favorites filter"),
    group: Optional[str] = Query(None, max_length=60, description="Group label filter"),
    token: Optional[str] = Depends(current_token),
) -> list[dict]:
    """List all contacts, or filter with ?q=, ?favorite=, ?group=.

    With a Bearer token only that user's rows are returned."""
    # The groups summary shows "" as "Ungrouped", so accept both.
    if group == "Ungrouped":
        group = ""
    user_id, user_token = _scope(token)
    return repository.list_contacts(
        q, favorite, group, user_id=user_id, user_token=user_token
    )


@app.get("/api/contacts/favorites", response_model=list[schemas.ContactOut])
def list_favorites(token: Optional[str] = Depends(current_token)) -> list[dict]:
    """List only the contacts marked as favorites."""
    user_id, user_token = _scope(token)
    return repository.list_favorites(user_id=user_id, user_token=user_token)


@app.get("/api/contacts/groups")
def list_groups(token: Optional[str] = Depends(current_token)) -> list[dict]:
    """Group summary: [{"group": "Work", "count": 4}, ...]."""
    user_id, user_token = _scope(token)
    summary = repository.list_groups(user_id=user_id, user_token=user_token)
    for entry in summary:
        if entry["group"] == "":
            entry["group"] = "Ungrouped"
    return summary


@app.get("/api/contacts/{contact_id}", response_model=schemas.ContactOut)
def read_contact(
    contact_id: int, token: Optional[str] = Depends(current_token)
) -> dict:
    """View a single contact by id (404 for other users' rows)."""
    user_id, user_token = _scope(token)
    contact = repository.get_contact(
        contact_id, user_id=user_id, user_token=user_token
    )
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    return contact


@app.post("/api/contacts", response_model=schemas.ContactOut, status_code=201)
def create_contact(
    payload: schemas.ContactCreate, token: Optional[str] = Depends(current_token)
) -> dict:
    """Add a new contact; owned by the signed-in user when a token is sent."""
    user_id, user_token = _scope(token)
    return repository.create_contact(
        payload.model_dump(), user_id=user_id, user_token=user_token
    )


@app.put("/api/contacts/{contact_id}", response_model=schemas.ContactOut)
def update_contact(
    contact_id: int,
    payload: schemas.ContactUpdate,
    token: Optional[str] = Depends(current_token),
) -> dict:
    """Update an existing contact (only provided fields change)."""
    user_id, user_token = _scope(token)
    contact = repository.update_contact(
        contact_id, payload.model_dump(), user_id=user_id, user_token=user_token
    )
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    return contact


@app.delete("/api/contacts/{contact_id}", status_code=204)
def delete_contact(
    contact_id: int, token: Optional[str] = Depends(current_token)
) -> None:
    """Delete a contact."""
    user_id, user_token = _scope(token)
    if not repository.delete_contact(
        contact_id, user_id=user_id, user_token=user_token
    ):
        raise HTTPException(status_code=404, detail="Contact not found")
