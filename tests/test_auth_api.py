"""
API-level checks for email/password auth and per-user data separation.

Creates throwaway accounts against Supabase Auth (auto-confirm), proves two
users cannot see each other's contacts, and pins the token rules:
valid token = scoped data, garbage token = 401, no token = shared dev data.
"""

import uuid

from conftest import http

PW = "TestPass123!"


def _signup():
    email = "apitest+%s@example.com" % uuid.uuid4().hex[:10]
    status, body = http("POST", "/api/auth/signup", {"email": email, "password": PW})
    assert status == 200, f"signup returned HTTP {status}: {body}"
    return email, body


def _login(email, password=PW):
    return http("POST", "/api/auth/login", {"email": email, "password": password})


def _auth(token):
    return {"Authorization": "Bearer %s" % token}


def test_signup_login_and_user_profile():
    email, signup = _signup()
    assert signup.get("user", {}).get("email") == email, f"signup echoed the wrong user: {signup}"
    session = signup.get("session") or {}
    assert session.get("access_token"), f"signup did not return a session: {signup}"

    status, body = _login(email)
    assert status == 200, f"login returned HTTP {status}: {body}"
    token = body["access_token"]
    assert body["user"]["email"] == email

    status, me = http("GET", "/api/auth/user", headers=_auth(token))
    assert status == 200, f"/api/auth/user returned HTTP {status}: {me}"
    assert me["email"] == email, f"profile email mismatch: {me}"


def test_login_with_wrong_password_is_401():
    email, _ = _signup()
    status, body = _login(email, "Definitely-Wrong-1")
    assert status == 401, f"expected 401 for a wrong password, got {status}: {body}"
    assert "incorrect" in str(body.get("detail", "")).lower(), (
        f"wrong-password error is not human readable: {body}"
    )


def test_short_password_rejected():
    status, body = http(
        "POST",
        "/api/auth/signup",
        {"email": "short+%s@example.com" % uuid.uuid4().hex[:8], "password": "short1"},
    )
    assert status == 400, f"expected 400 for a short password, got {status}: {body}"
    assert "8" in str(body.get("detail", "")), f"error does not mention the length: {body}"


def test_duplicate_signup_is_409():
    email, _ = _signup()
    status, body = http("POST", "/api/auth/signup", {"email": email, "password": PW})
    assert status == 409, f"expected 409 for a duplicate email, got {status}: {body}"
    assert "already exists" in str(body.get("detail", "")).lower(), f"unexpected message: {body}"


def test_bad_token_is_401_and_no_token_still_works():
    status, body = http("GET", "/api/contacts", headers=_auth("not.a.real.token"))
    assert status == 401, f"expected 401 for a garbage token, got {status}: {body}"
    assert "sign in again" in str(body.get("detail", "")).lower(), (
        f"401 detail is not the agreed message: {body}"
    )

    # no token at all keeps working (shared dev data, backwards compatible)
    status, rows = http("GET", "/api/contacts")
    assert status == 200, f"tokenless list returned HTTP {status}"
    assert isinstance(rows, list), f"tokenless list is not a list: {rows!r}"


def test_users_cannot_see_each_others_contacts():
    email_a, _ = _signup()
    email_b, _ = _signup()
    _, login_a = _login(email_a)
    _, login_b = _login(email_b)
    tok_a = login_a["access_token"]
    tok_b = login_b["access_token"]

    marker = "Isolation " + uuid.uuid4().hex[:8]
    status, created = http(
        "POST",
        "/api/contacts",
        {"name": marker, "phone": "+1 555", "email": "iso@example.com"},
        headers=_auth(tok_a),
    )
    assert status == 201, f"create returned HTTP {status}: {created}"
    assert created.get("user_id"), f"created contact has no user_id: {created}"

    try:
        # B's list must not contain A's private contact
        status, rows = http("GET", "/api/contacts", headers=_auth(tok_b))
        assert status == 200, f"B's list returned HTTP {status}"
        names = [r.get("name") for r in rows]
        assert marker not in names, "user B can see user A's private contact"

        # fetching it directly is a 404 (no existence leak, not a 403)
        status, body = http(
            "GET", "/api/contacts/%s" % created["id"], headers=_auth(tok_b)
        )
        assert status == 404, f"expected 404 for the other user's row, got {status}: {body}"

        # A still sees their own contact
        status, rows = http("GET", "/api/contacts", headers=_auth(tok_a))
        assert status == 200
        assert marker in [r.get("name") for r in rows], "user A lost their own contact"
    finally:
        http("DELETE", "/api/contacts/%s" % created["id"], headers=_auth(tok_a))


def test_refresh_rotates_the_session():
    email, _ = _signup()
    _, login = _login(email)
    old_refresh = login["refresh_token"]

    status, body = http("POST", "/api/auth/refresh", {"refresh_token": old_refresh})
    assert status == 200, f"refresh returned HTTP {status}: {body}"
    assert body.get("access_token"), f"refresh returned no access token: {body}"

    status, me = http("GET", "/api/auth/user", headers=_auth(body["access_token"]))
    assert status == 200, f"new token rejected by /api/auth/user: {status} {me}"
    assert me.get("email") == email


def test_favorites_and_groups_work_for_signed_in_users():
    email, _ = _signup()
    _, login = _login(email)
    token = login["access_token"]

    status, favs = http("GET", "/api/contacts/favorites", headers=_auth(token))
    assert status == 200, f"scoped favorites returned HTTP {status}: {favs}"
    assert isinstance(favs, list)

    status, groups = http("GET", "/api/contacts/groups", headers=_auth(token))
    assert status == 200, f"scoped groups returned HTTP {status}: {groups}"
    assert isinstance(groups, list)
    for entry in groups:
        assert "group" in entry and "count" in entry, f"unexpected group shape: {entry}"
