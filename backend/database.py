"""
SQLite data layer - local device storage (offline fallback).

Supabase / Postgres is the primary store when SUPABASE_URL + a key are
configured (see supabase_store.py). This module stays as the zero-config
fallback so the app also works fully offline.
"""
import os
import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATABASE_PATH = os.environ.get("CONTACT_BOOK_DB", str(DATA_DIR / "contacts.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS contacts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    phone      TEXT    NOT NULL DEFAULT '',
    email      TEXT    NOT NULL DEFAULT '',
    company    TEXT    NOT NULL DEFAULT '',
    address    TEXT    NOT NULL DEFAULT '',
    notes      TEXT    NOT NULL DEFAULT '',
    avatar     TEXT    NOT NULL DEFAULT '',
    favorite   INTEGER NOT NULL DEFAULT 0,
    "group"    TEXT    NOT NULL DEFAULT '',
    user_id    TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_name  ON contacts(name);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
"""


def get_connection() -> sqlite3.Connection:
    """Open a connection to the local SQLite database."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db() -> None:
    """Create tables if needed and upgrade older schemas in place."""
    with get_connection() as conn:
        conn.executescript(SCHEMA)
        # Databases created before the avatar photo column existed.
        columns = {row[1] for row in conn.execute("PRAGMA table_info(contacts)")}
        if "avatar" not in columns:
            conn.execute(
                "ALTER TABLE contacts ADD COLUMN avatar TEXT NOT NULL DEFAULT ''"
            )
        # Databases created before favorites / groups existed.
        if "favorite" not in columns:
            conn.execute(
                "ALTER TABLE contacts ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0"
            )
        if "group" not in columns:
            conn.execute(
                "ALTER TABLE contacts ADD COLUMN \"group\" TEXT NOT NULL DEFAULT ''"
            )
        # Databases created before per-user rows existed (null = shared row).
        if "user_id" not in columns:
            conn.execute("ALTER TABLE contacts ADD COLUMN user_id TEXT")
        conn.commit()


def seed_demo_contacts() -> bool:
    """Insert a few sample contacts on first run so the UI is not empty."""
    with get_connection() as conn:
        count = conn.execute("SELECT COUNT(*) AS c FROM contacts").fetchone()["c"]
        if count:
            return False
        conn.executemany(
            """INSERT INTO contacts (name, phone, email, company, address, notes,
                                      avatar, favorite, "group")
               VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)""",
            [
                ("Aarav Sharma", "+91 98765 43210", "aarav.sharma@example.com",
                 "Nova Labs", "Bengaluru, IN", "Met at the 2026 dev meetup.",
                 1, "Work"),
                ("Emily Carter", "+1 415 555 0134", "emily.carter@example.com",
                 "Northwind Studio", "San Francisco, US",
                 "Design lead - prefers email.", 0, "Work"),
                ("Kenji Watanabe", "+81 90 1234 5678", "kenji.w@example.com",
                 "Sakura Systems", "Tokyo, JP", "Quarterly check-in call.",
                 0, "Clients"),
                ("Maya Sharma", "+91 98123 45678", "maya.sharma@example.com",
                 "", "Pune, IN", "Aarav's sister - birthday in June.",
                 1, "Family"),
            ],
        )
        conn.commit()
        return True
