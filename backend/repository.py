"""
Repository facade - picks the active storage backend.

Priority:
  1. Supabase / Postgres (when SUPABASE_URL + SUPABASE_SERVICE_KEY are set)
  2. Local SQLite fallback (offline / zero config)

Both stores expose identical function signatures, so routes never change.

Optional user context (see the "auth" section in app.py):
  user_id    - scope reads/writes to one user's rows (null = shared rows)
  user_token - the user's JWT; Supabase uses it as the PostgREST bearer so
               RLS applies. Both default to None (unscoped dev access).
"""
from typing import Optional

import store_sqlite
import store_supabase


def _backend():
    return store_supabase if store_supabase.configured() else store_sqlite


def storage_name() -> str:
    """Human-readable name of the active storage backend."""
    return _backend().storage_name()


def list_contacts(
    query: str = "",
    favorite: Optional[bool] = None,
    group: Optional[str] = None,
    user_id: Optional[str] = None,
    user_token: Optional[str] = None,
) -> list[dict]:
    """List contacts, optionally filtered by search, favorite flag or group."""
    return _backend().list_contacts(
        query, favorite, group, user_id=user_id, user_token=user_token
    )


def list_favorites(
    user_id: Optional[str] = None, user_token: Optional[str] = None
) -> list[dict]:
    """List only the contacts marked as favorites."""
    return _backend().list_favorites(user_id=user_id, user_token=user_token)


def list_groups(
    user_id: Optional[str] = None, user_token: Optional[str] = None
) -> list[dict]:
    """List every group with its contact count."""
    return _backend().list_groups(user_id=user_id, user_token=user_token)


def get_contact(
    contact_id: int,
    user_id: Optional[str] = None,
    user_token: Optional[str] = None,
):
    """View a single contact by id."""
    return _backend().get_contact(contact_id, user_id=user_id, user_token=user_token)


def create_contact(
    data: dict,
    user_id: Optional[str] = None,
    user_token: Optional[str] = None,
) -> dict:
    """Add a new contact."""
    return _backend().create_contact(data, user_id=user_id, user_token=user_token)


def update_contact(
    contact_id: int,
    data: dict,
    user_id: Optional[str] = None,
    user_token: Optional[str] = None,
):
    """Update an existing contact (only provided fields change)."""
    return _backend().update_contact(
        contact_id, data, user_id=user_id, user_token=user_token
    )


def delete_contact(
    contact_id: int,
    user_id: Optional[str] = None,
    user_token: Optional[str] = None,
) -> bool:
    """Delete a contact."""
    return _backend().delete_contact(contact_id, user_id=user_id, user_token=user_token)


def count_contacts() -> int:
    """Total number of stored contacts."""
    return _backend().count_contacts()
