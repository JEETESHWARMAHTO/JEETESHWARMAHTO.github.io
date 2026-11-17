"""
SQLite storage backend - local offline fallback.

Same function signatures as store_supabase.py so the repository facade
can switch between them without touching routes.

user_id mirrors the Supabase RLS scope: when a user id is given, only that
user's rows plus shared rows (user_id IS NULL) are visible. Without one the
store stays unscoped (dev access). user_token is accepted and ignored -
SQLite has no row-level security.
"""
from typing import Optional

from database import get_connection

SEARCH_COLUMNS = ("name", "phone", "email", "company", "address", "notes")
USER_SCOPE = "(user_id = ? OR user_id IS NULL)"


def storage_name() -> str:
    return "sqlite (local device)"


def list_contacts(
    query: str = "",
    favorite: Optional[bool] = None,
    group: Optional[str] = None,
    user_id: Optional[str] = None,
    user_token: Optional[str] = None,
) -> list[dict]:
    """Return contacts, optionally filtered by search, favorite flag or group."""
    query = (query or "").strip()
    clauses = []
    params: list = []
    if query:
        like = f"%{query}%"
        clauses.append("(" + " OR ".join(f"{col} LIKE ?" for col in SEARCH_COLUMNS) + ")")
        params.extend(like for _ in SEARCH_COLUMNS)
    if favorite is not None:
        clauses.append("favorite = ?")
        params.append(1 if favorite else 0)
    if group is not None:
        clauses.append("\"group\" = ?")
        params.append(group)
    if user_id:
        clauses.append(USER_SCOPE)
        params.append(user_id)

    sql = "SELECT * FROM contacts"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY name COLLATE NOCASE ASC"
    with get_connection() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
    return [dict(row) for row in rows]


def list_favorites(
    user_id: Optional[str] = None, user_token: Optional[str] = None
) -> list[dict]:
    """Return only the contacts marked as favorites."""
    return list_contacts(favorite=True, user_id=user_id)


def list_groups(
    user_id: Optional[str] = None, user_token: Optional[str] = None
) -> list[dict]:
    """Return [{"group": name, "count": n}, ...] for every distinct group."""
    sql = "SELECT \"group\" AS grp, COUNT(*) AS c FROM contacts"
    params: tuple = ()
    if user_id:
        sql += " WHERE " + USER_SCOPE
        params = (user_id,)
    sql += " GROUP BY \"group\" ORDER BY \"group\" COLLATE NOCASE ASC"
    with get_connection() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [{"group": row["grp"], "count": row["c"]} for row in rows]


def get_contact(
    contact_id: int,
    user_id: Optional[str] = None,
    user_token: Optional[str] = None,
) -> Optional[dict]:
    """Return a single contact by id, or None if it does not exist."""
    sql = "SELECT * FROM contacts WHERE id = ?"
    params: list = [contact_id]
    if user_id:
        sql += " AND " + USER_SCOPE
        params.append(user_id)
    with get_connection() as conn:
        row = conn.execute(sql, tuple(params)).fetchone()
    return dict(row) if row else None


def create_contact(
    data: dict,
    user_id: Optional[str] = None,
    user_token: Optional[str] = None,
) -> dict:
    """Insert a new contact and return the stored record."""
    with get_connection() as conn:
        cursor = conn.execute(
            """INSERT INTO contacts (name, phone, email, company, address, notes,
                                      avatar, favorite, "group", user_id)
               VALUES (:name, :phone, :email, :company, :address, :notes,
                       :avatar, :favorite, :group, :user_id)""",
            {
                "name": data["name"],
                "phone": data.get("phone", ""),
                "email": data.get("email", ""),
                "company": data.get("company", ""),
                "address": data.get("address", ""),
                "notes": data.get("notes", ""),
                "avatar": data.get("avatar", ""),
                "favorite": 1 if data.get("favorite") else 0,
                "group": data.get("group", ""),
                "user_id": user_id,
            },
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM contacts WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
    return dict(row)


def update_contact(
    contact_id: int,
    data: dict,
    user_id: Optional[str] = None,
    user_token: Optional[str] = None,
) -> Optional[dict]:
    """Update the given fields of a contact and return the new record."""
    fields = {k: v for k, v in data.items() if v is not None}
    if not fields:
        return get_contact(contact_id, user_id=user_id)

    assignments = ", ".join(f"\"{key}\" = :{key}" for key in fields)
    params = dict(fields)
    params["id"] = contact_id
    sql = (
        f"UPDATE contacts SET {assignments}, updated_at = datetime('now') "
        "WHERE id = :id"
    )
    if user_id:
        sql += " AND " + USER_SCOPE.replace("?", ":user_id")
        params["user_id"] = user_id

    with get_connection() as conn:
        cursor = conn.execute(sql, params)
        conn.commit()
        if cursor.rowcount == 0:
            return None
        row = conn.execute(
            "SELECT * FROM contacts WHERE id = ?", (contact_id,)
        ).fetchone()
    return dict(row)


def delete_contact(
    contact_id: int,
    user_id: Optional[str] = None,
    user_token: Optional[str] = None,
) -> bool:
    """Delete a contact. Returns True if a row was removed."""
    sql = "DELETE FROM contacts WHERE id = ?"
    params: list = [contact_id]
    if user_id:
        sql += " AND " + USER_SCOPE
        params.append(user_id)
    with get_connection() as conn:
        cursor = conn.execute(sql, tuple(params))
        conn.commit()
        return cursor.rowcount > 0


def count_contacts() -> int:
    """Total number of stored contacts."""
    with get_connection() as conn:
        return conn.execute("SELECT COUNT(*) AS c FROM contacts").fetchone()["c"]
