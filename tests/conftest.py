"""
Shared fixtures and helpers for the Personal Contact Book test suite.

Test modules
------------
* ``test_pages.py``         - served HTML for the four routes (HTTP level)
* ``test_contacts_api.py``  - /api health, config and the CRUD lifecycle
* ``test_ui_flows.py``      - browser interactions on the contacts page
* ``test_responsive.py``    - mobile / desktop layout behaviour
* ``test_accessibility.py`` - headings, accessible names, focus, motion

Ground rules honoured by everything in this file
------------------------------------------------
* The dev servers on :3000 (Node) and :8000 (Python) are assumed to be up.
  Nothing here starts or stops a process; a dead server is reported, not fixed.
* Another agent is editing the frontend while this suite runs, so page loads
  and API calls retry once (API retries a few times) before failing.
* Assertions target stable element ids, roles, text and behaviour - never
  colours, spacing or class names that the ongoing redesign may change.
* Every helper that can create a contact removes it again on teardown.
* All files are ASCII only (no emoji).
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
import uuid

import pytest
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:3000"
API_BASE = BASE_URL + "/api"

# path -> (nav data-tab, page heading / title prefix)
ROUTES = (
    ("/", "contacts", "Contacts"),
    ("/favorites", "favorites", "Favorites"),
    ("/groups", "groups", "Groups"),
    ("/settings", "settings", "Settings"),
)

# The dev server live-reloads the browser whenever a file under public/
# changes. Another agent is editing the UI right now, so the reload channel is
# neutralised: a stub EventSource means /__livereload is never even requested.
# The opening splash is skipped as well so tests never sit through the 2.5s
# intro (tests still wait for #intro to disappear, see settle()).
INIT_SCRIPT = r"""
try {
  window.EventSource = class EventSourceStub {
    constructor() { this.readyState = 0; this.withCredentials = false; }
    addEventListener() {}
    removeEventListener() {}
    close() {}
  };
  sessionStorage.setItem('cb-intro', '1');
} catch (err) {}
"""

# Console errors caused by the sandbox network (blocked font CDN), not by the
# app itself. Everything else counts as a failure.
IGNORED_ERROR_MARKERS = ("fonts.googleapis.com", "fonts.gstatic.com")

# Code point ranges that are treated as emoji by the "no emoji" checks.
EMOJI_RANGES = (
    (0x1F000, 0x1FAFF),  # emoticons, symbols, transport, supplemental
    (0x2600, 0x27BF),  # misc symbols + dingbats
    (0x2300, 0x23FF),  # misc technical (watch, keyboard, ...)
    (0x2B00, 0x2BFF),  # misc symbols and arrows
    (0xFE0F, 0xFE0F),  # variation selector-16
)


# --------------------------------------------------------------------- HTTP
def http(method, path, payload=None, *, retries=4, base_url=BASE_URL):
    """Issue an HTTP request, retrying transient 5xx / connection failures.

    Returns ``(status, body)`` where ``body`` is parsed JSON when possible and
    the decoded text otherwise. Never raises for HTTP error statuses.
    """
    url = path if path.startswith("http") else base_url + path
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"} if data is not None else {}
    last = None

    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=25) as res:
                raw = res.read()
                return res.status, _decode(raw)
        except urllib.error.HTTPError as exc:
            raw = exc.read() or b""
            # 500/502 usually means uvicorn was mid-restart or the proxy lost
            # the backend for a moment - worth one more try.
            if exc.code in (500, 502, 503, 504) and attempt < retries - 1:
                last = exc
                time.sleep(1.0)
                continue
            return exc.code, _decode(raw)
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
            last = exc
            if attempt < retries - 1:
                time.sleep(1.0)
                continue
            raise

    raise RuntimeError(f"request to {url} failed: {last}")


def _decode(raw):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return raw.decode("utf-8", "replace")


def api(method, path, payload=None, **kwargs):
    """``http()`` scoped to the /api prefix (as the browser sees it)."""
    return http(method, API_BASE + path, payload, **kwargs)


def emoji_characters(text):
    """Return every emoji-looking character found in *text*."""
    return sorted({ch for ch in text if any(lo <= ord(ch) <= hi for lo, hi in EMOJI_RANGES)})


def real_console_errors(errors):
    """Console/page errors that are the app's fault (not the sandbox's)."""
    return [e for e in errors if not any(marker in e for marker in IGNORED_ERROR_MARKERS)]


# ---------------------------------------------------------------- contacts
class ContactHelper:
    """A uniquely named contact that is always removed again."""

    def __init__(self, token):
        self.token = token
        self.name = "Autotest " + token
        self.company = "Acme " + token
        self.email = token + "@example.test"
        self.id = None
        self.record = None

    def create(self, **fields):
        payload = {
            "name": self.name,
            "company": self.company,
            "email": self.email,
            "phone": "+1 555 0100",
        }
        payload.update(fields)
        status, body = api("POST", "/contacts", payload)
        assert status == 201, f"creating the test contact failed: {status} {body}"
        self.id = body["id"]
        self.record = body
        return body

    def ensure(self):
        """Create the contact through the API unless it already exists."""
        if self.record is None:
            self.create()
        return self.record

    def cleanup(self):
        """Delete every contact carrying this run's unique token."""
        problems = []
        status, rows = api("GET", "/contacts?q=" + self.token)
        if status != 200 or not isinstance(rows, list):
            problems.append(f"leftover search returned {status}: {rows!r}")
        else:
            for row in rows:
                try:
                    deleted, _ = api("DELETE", "/contacts/%s" % row["id"])
                    if deleted not in (200, 204):
                        problems.append(f"delete of {row['id']} returned {deleted}")
                except Exception as exc:  # noqa: BLE001 - reported below
                    problems.append(f"delete of {row['id']} failed: {exc}")
        if problems:
            raise AssertionError(
                "test contact was not cleaned up (never leave data behind): "
                + "; ".join(problems)
            )


# ------------------------------------------------------------------- browser
def _wire_console(page, errors):
    def on_console(msg):
        if msg.type == "error":
            errors.append("console.error: " + msg.text)

    page.on("console", on_console)
    page.on("pageerror", lambda err: errors.append("pageerror: " + str(err)))


def make_page(browser, width, height, *, touch=False, errors=None):
    """Create an isolated context + page with the test init script applied."""
    context = browser.new_context(
        viewport={"width": width, "height": height},
        has_touch=touch,
        is_mobile=touch,
    )
    page = context.new_page()
    page.add_init_script(INIT_SCRIPT)
    if errors is not None:
        _wire_console(page, errors)
    return context, page


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as playwright:
        instance = playwright.chromium.launch()
        yield instance
        instance.close()


@pytest.fixture()
def base_url():
    return BASE_URL


@pytest.fixture()
def console_errors():
    return []


@pytest.fixture()
def page(browser, console_errors):
    context, pg = make_page(browser, 1440, 900, errors=console_errors)
    yield pg
    context.close()


@pytest.fixture()
def mobile_page(browser, console_errors):
    context, pg = make_page(browser, 390, 844, touch=True, errors=console_errors)
    yield pg
    context.close()


@pytest.fixture()
def contact():
    helper = ContactHelper("cb" + uuid.uuid4().hex[:12])
    try:
        yield helper
    finally:
        helper.cleanup()


# ---------------------------------------------------------- page navigation
def settle(page, timeout=8000):
    """Wait until a freshly loaded page is interactive (intro splash gone)."""
    page.wait_for_selector("#intro", state="detached", timeout=timeout)


def ready_heading(page, label, timeout=15000):
    page.wait_for_function(
        """(label) => [...document.querySelectorAll('h1, h2, h3')]
             .some(h => (h.textContent || '').trim().toLowerCase()
                 .includes(label.toLowerCase()))""",
        label,
        timeout=timeout,
    )


def open_page(page, path, *, ready=None, attempts=2, timeout=20000):
    """Load a route, retrying once when the server is mid-edit."""
    url = BASE_URL + path
    last = None
    for _ in range(attempts):
        try:
            response = page.goto(url, wait_until="load", timeout=timeout)
            status = response.status if response else "no response"
            if status != 200:
                last = f"HTTP {status} for {url}"
            elif page.locator("#search-shell").count() == 0:
                last = "the shared header did not render for " + url
            else:
                settle(page)
                if ready is not None:
                    ready(page)
                return
        except Exception as exc:  # noqa: BLE001 - retried, then reported
            last = exc
        time.sleep(0.75)
    raise AssertionError(f"could not open {url}: {last}")


def goto_route(page, path, **kwargs):
    return open_page(page, path, **kwargs)


def open_contacts(page, path="/"):
    """Load a route and wait for the contact list's first render."""
    return open_page(page, path, ready=wait_for_contacts)


def nav_link(page, tab):
    """The visible navigation anchor for *tab* (top nav or bottom nav)."""
    for selector in ('header a[data-tab="%s"]' % tab, 'nav a[data-tab="%s"]' % tab):
        links = page.locator(selector)
        for index in range(links.count()):
            link = links.nth(index)
            if link.is_visible():
                return link
    raise AssertionError('no visible navigation link for tab "%s"' % tab)


def click_nav(page, tab, path, *, ready=None, attempts=2, timeout=20000):
    """Navigate by clicking a nav anchor (never page.goto), retrying once."""
    expected = (BASE_URL + path).rstrip("/") or BASE_URL
    last = None
    for _ in range(attempts):
        try:
            link = nav_link(page, tab)
            with page.expect_navigation(wait_until="load", timeout=timeout):
                link.click()
            landed = page.url.split("?")[0].rstrip("/") or BASE_URL
            if landed != expected:
                last = f"landed on {page.url}, expected {expected}"
            else:
                settle(page)
                if ready is not None:
                    ready(page)
                return
        except Exception as exc:  # noqa: BLE001 - retried, then reported
            last = exc
        time.sleep(0.75)
    raise AssertionError(f"clicking the {tab} nav link ({path}) failed: {last}")


def assert_active_nav(page, tab):
    """Exactly one item per <nav> landmark is marked current for *tab*."""
    per_nav = page.evaluate(
        """() => [...document.querySelectorAll('nav')].map(nav =>
             [...nav.querySelectorAll('[aria-current="page"]')]
               .map(el => el.getAttribute('data-tab') || ''))"""
    )
    assert per_nav, "the page exposes no <nav> landmark at all"
    for tabs in per_nav:
        assert tabs == [tab], (
            f'expected exactly one aria-current="page" item for "{tab}" in each '
            f"nav, got {tabs!r}"
        )


# --------------------------------------------------------------- list / modal
def wait_for_contacts(page, timeout=20000):
    """Wait until the list finished its first render (hint left 'Loading')."""
    page.wait_for_function(
        """() => {
             const hint = document.querySelector('#result-hint');
             if (!hint) return false;
             const text = (hint.textContent || '').trim();
             return text.length > 0 && !/^loading/i.test(text);
           }""",
        timeout=timeout,
    )


def wait_for_list_reload(page, timeout=15000):
    """Wait for a create/edit/delete to re-render the list.

    ``#loading`` is shown while the fresh list is fetched and hidden again
    once ``render()`` has run, i.e. once ``state.contacts`` is up to date.
    """
    try:
        page.wait_for_selector("#loading", state="visible", timeout=3000)
    except Exception:  # noqa: BLE001 - the reload may already be finished
        pass
    page.wait_for_selector("#loading", state="hidden", timeout=timeout)


def wait_for_toast(page, timeout=10000):
    page.wait_for_function(
        """() => {
             const root = document.querySelector('#toast-root');
             return !!(root && (root.textContent || '').trim());
           }""",
        timeout=timeout,
    )


def modal_open(page, selector):
    return page.locator(selector).evaluate(
        "el => el.classList.contains('open')"
    )


def wait_modal(page, selector, *, opened=True, timeout=10000):
    page.wait_for_function(
        """([selector, opened]) => {
             const el = document.querySelector(selector);
             return !!el && el.classList.contains('open') === opened;
           }""",
        [selector, opened],
        timeout=timeout,
    )


def entry_locator(page, name):
    """The contact entry (card or row) for *name* inside #contact-grid."""
    grid = page.locator("#contact-grid")
    for selector in (
        '[data-id]:has-text("%s")' % name,
        'article:has-text("%s")' % name,
        'li:has-text("%s")' % name,
    ):
        found = grid.locator(selector)
        if found.count():
            return found.first
    markup = grid.text_content() or ""
    raise AssertionError(f'no contact entry for "{name}" in #contact-grid: {markup[:300]!r}')


def entry_exists(page, name):
    return page.locator('#contact-grid [data-id]:has-text("%s")' % name).count() > 0


def open_detail(page, name, *, touch=False, attempts=2):
    """Open the detail popup for *name* (view button first, row as fallback)."""
    last = None
    for _ in range(attempts):
        entry = entry_locator(page, name)
        targets = []
        view = entry.locator('[data-action="view"]')
        if view.count():
            targets.append(view.first)
        targets.append(entry)
        for target in targets:
            try:
                if touch:
                    target.tap()
                else:
                    target.click()
                wait_modal(page, "#detail-modal", opened=True, timeout=5000)
                actual = page.locator("#detail-name").inner_text().strip()
                assert actual == name, f'detail popup shows "{actual}", expected "{name}"'
                return entry
            except Exception as exc:  # noqa: BLE001 - one more attempt below
                last = exc
        time.sleep(0.75)
    raise AssertionError(f'could not open the detail popup for "{name}": {last}')
