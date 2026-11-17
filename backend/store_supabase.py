"""
Supabase / Postgres storage backend (PostgREST over HTTPS, stdlib only).

Uses SUPABASE_URL + SUPABASE_SERVICE_KEY (server-side secret key - never
exposed to the browser). Falls back to SUPABASE_ANON_KEY if only that is set.

Auth: pass user_token to run the query as that signed-in user - their JWT
becomes the PostgREST bearer so RLS applies, and user_id scopes filters and
inserts. Without a token the service key is used (unscoped dev data).
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Optional

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_KEY", "")
    or os.environ.get("SUPABASE_ANON_KEY", "")
)
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")

TABLE = "contacts"
SEARCH_COLUMNS = ("name", "phone", "email", "company", "address", "notes")


def configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_KEY)


def storage_name() -> str:
    return "supabase (postgres)"


def _request(
    method: str,
    path: str,
    body=None,
    prefer: Optional[str] = None,
    user_token: Optional[str] = None,
):
    """Perform a PostgREST request and return (payload, headers).

    With user_token the request runs as that user (RLS enforced); without it
    the service key is used and every row is visible.
    """
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {
        "apikey": (SUPABASE_ANON_KEY or SUPABASE_KEY) if user_token else SUPABASE_KEY,
        "Authorization": f"Bearer {user_token or SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer

    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=25) as res:
            raw = res.read()
            payload = json.loads(raw) if raw else None
            return payload, {k.lower(): v for k, v in res.headers.items()}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise RuntimeError(f"Supabase request failed ({exc.code}): {detail}") from exc


def _scoped(path: str, user_id: Optional[str]) -> str:
    """Append the user scope filter (own rows + shared null-user rows)."""
    if not user_id:
        return path
    return f"{path}&or=(user_id.eq.{user_id},user_id.is.null)"


def list_contacts(
    query: str = "",
    favorite: Optional[bool] = None,
    group: Optional[str] = None,
    user_id: Optional[str] = None,
    user_token: Optional[str] = None,
) -> list[dict]:
    """Return contacts, optionally filtered by search, favorite flag or group."""
    query = (query or "").strip()
    params = ["select=*"]
    if query:
        like = urllib.parse.quote(f"*{query}*", safe="")
        ors = ",".join(f"{col}.ilike.{like}" for col in SEARCH_COLUMNS)
        params.append(f"or=({ors})")
    if favorite is not None:
        params.append(f"favorite=eq.{str(favorite).lower()}")
    if group is not None:
        params.append(f"group=eq.{urllib.parse.quote(group, safe='')}")
    params.append("order=name.asc")
    path = _scoped(f"{TABLE}?" + "&".join(params), user_id)
    rows, _ = _request("GET", path, user_token=user_token)
    return rows or []


def list_favorites(
    user_id: Optional[str] = None, user_token: Optional[str] = None
) -> list[dict]:
    """Return only the contacts marked as favorites."""
    path = _scoped(f"{TABLE}?select=*&favorite=eq.true&order=name.asc", user_id)
    rows, _ = _request("GET", path, user_token=user_token)
    return rows or []


def list_groups(
    user_id: Optional[str] = None, user_token: Optional[str] = None
) -> list[dict]:
    """Return [{"group": name, "count": n}, ...] for every distinct group."""
    path = _scoped(f"{TABLE}?select=group", user_id)
    rows, _ = _request("GET", path, user_token=user_token)
    counts: dict = {}
    for row in rows or []:
        name = row.get("group") or ""
        counts[name] = counts.get(name, 0) + 1
    return [
        {"group": name, "count": counts[name]}
        for name in sorted(counts, key=str.lower)
    ]


def get_contact(
    contact_id: int,
    user_id: Optional[str] = None,
    user_token: Optional[str] = None,
) -> Optional[dict]:
    """Return a single contact by id, or None if it does not exist."""
    path = _scoped(f"{TABLE}?select=*&id=eq.{int(contact_id)}", user_id)
    rows, _ = _request("GET", path, user_token=user_token)
    return rows[0] if rows else None


def create_contact(
    data: dict,
    user_id: Optional[str] = None,
    user_token: Optional[str] = None,
) -> dict:
    """Insert a new contact and return the stored record."""
    if user_id:
        data = {**data, "user_id": user_id}
    rows, _ = _request(
        "POST",
        f"{TABLE}?select=*",
        body=data,
        prefer="return=representation",
        user_token=user_token,
    )
    return rows[0]


def update_contact(
    contact_id: int,
    data: dict,
    user_id: Optional[str] = None,
    user_token: Optional[str] = None,
) -> Optional[dict]:
    """Update the given fields of a contact and return the new record."""
    fields = {k: v for k, v in data.items() if v is not None}
    if not fields:
        return get_contact(contact_id, user_id=user_id, user_token=user_token)
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()

    path = _scoped(f"{TABLE}?id=eq.{int(contact_id)}&select=*", user_id)
    rows, _ = _request(
        "PATCH", path, body=fields, prefer="return=representation", user_token=user_token
    )
    return rows[0] if rows else None


def delete_contact(
    contact_id: int,
    user_id: Optional[str] = None,
    user_token: Optional[str] = None,
) -> bool:
    """Delete a contact. Returns True if a row was removed."""
    path = _scoped(f"{TABLE}?id=eq.{int(contact_id)}&select=id", user_id)
    rows, _ = _request(
        "DELETE", path, prefer="return=representation", user_token=user_token
    )
    return bool(rows)


def count_contacts() -> int:
    """Total number of stored contacts (via Content-Range header)."""
    _, headers = _request("GET", f"{TABLE}?select=id&limit=1", prefer="count=exact")
    content_range = headers.get("content-range", "")
    total = content_range.split("/")[-1] if "/" in content_range else ""
    return int(total) if total.isdigit() else 0
