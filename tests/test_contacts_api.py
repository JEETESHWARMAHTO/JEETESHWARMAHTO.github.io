"""
API-level checks against /api (through the Node proxy on :3000).

Covers health, browser config and one full create / read / update / search /
delete lifecycle using a uniquely named contact that is removed on teardown.
"""

import urllib.parse

from conftest import api, http


def test_health_reports_storage(base_url):
    status, body = http("GET", "/api/health")
    assert status == 200, f"/api/health returned HTTP {status}"
    assert body.get("status") == "ok", f"unexpected health payload: {body}"
    assert isinstance(body.get("storage"), str) and body["storage"].strip(), (
        f"health does not report the active storage backend: {body}"
    )
    assert isinstance(body.get("contacts"), int), f"health does not report a contact count: {body}"


def test_config_exposes_supabase_and_auth_flag(base_url):
    status, body = http("GET", "/api/config")
    assert status == 200, f"/api/config returned HTTP {status}"
    assert "supabaseUrl" in body, f"/api/config is missing supabaseUrl: {body}"
    assert "authEnabled" in body, f"/api/config is missing authEnabled: {body}"
    assert isinstance(body["authEnabled"], bool), (
        f"authEnabled must be a boolean, got {type(body['authEnabled'])}: {body['authEnabled']!r}"
    )
    # The value itself is not asserted: Google sign-in may be on or off.


def test_contact_crud_lifecycle(contact):
    # --- create (unique name comes from the contact fixture)
    created = contact.ensure()
    contact_id = created["id"]
    assert created["name"] == contact.name

    # --- read back by id
    status, fetched = http("GET", "/api/contacts/%d" % contact_id)
    assert status == 200, f"read by id returned HTTP {status}"
    assert fetched["id"] == contact_id
    assert fetched["name"] == contact.name

    # --- update
    new_company = "Edited " + contact.token
    status, updated = http(
        "PUT",
        "/api/contacts/%d" % contact_id,
        {"company": new_company, "phone": "+1 555 0199"},
    )
    assert status == 200, f"update returned HTTP {status}: {updated}"
    assert updated["company"] == new_company, f"company was not updated: {updated}"
    assert updated["phone"] == "+1 555 0199", f"phone was not updated: {updated}"
    assert updated["name"] == contact.name, "update must not touch unprovided fields"

    status, reread = http("GET", "/api/contacts/%d" % contact_id)
    assert status == 200
    assert reread["company"] == new_company, f"read-back does not show the update: {reread}"

    # --- search by the unique term finds exactly this contact
    status, hits = http("GET", "/api/contacts?q=" + urllib.parse.quote(contact.token))
    assert status == 200, f"search returned HTTP {status}"
    assert isinstance(hits, list), f"search did not return a list: {hits!r}"
    assert len(hits) == 1, (
        f"search for the unique term matched {len(hits)} contacts, expected exactly 1: "
        f"{[h.get('name') for h in hits]}"
    )
    assert hits[0]["id"] == contact_id
    assert hits[0]["name"] == contact.name

    # --- delete
    status, _ = http("DELETE", "/api/contacts/%d" % contact_id)
    assert status in (200, 204), f"delete returned HTTP {status}"

    # --- reading it again must be a 404
    status, body = http("GET", "/api/contacts/%d" % contact_id)
    assert status == 404, f"deleted contact still readable (HTTP {status}): {body}"

    # --- and it must be gone from search as well
    status, hits = http("GET", "/api/contacts?q=" + urllib.parse.quote(contact.token))
    assert status == 200
    assert hits == [], f"deleted contact still shows up in search: {hits}"


def test_read_of_missing_contact_is_404(base_url):
    status, body = http("GET", "/api/contacts/999999999")
    assert status == 404, f"expected 404 for a missing id, got {status}: {body}"


def test_create_rejects_an_empty_name(base_url):
    status, body = http("POST", "/api/contacts", {"name": ""})
    assert status in (400, 422), f"creating a contact without a name returned HTTP {status}"
    assert api  # keeps the imported helper referenced for readability
