"""
Browser checks for the welcome / login / signup pages.

Pins the bare-shell rendering (no app header or nav on auth pages), the form
contracts auth.js binds to, the error surface for bad credentials, and the
first-visit routing rule that sends a fresh browser through /welcome once.
"""

import uuid

from conftest import BASE_URL, settle


def _goto(page, path):
    page.goto(BASE_URL + path, wait_until="load")
    settle(page)


def test_welcome_page_renders_in_a_bare_shell(page):
    _goto(page, "/welcome")

    heading = page.locator("h1").first
    assert heading.inner_text().strip() == "Contact Book", "welcome page lost its heading"
    assert page.locator('a[href="/signup"]').count() >= 1, "welcome has no signup CTA"
    assert page.locator('a[href="/login"]').count() >= 1, "welcome has no sign-in CTA"

    # bare shell: the app chrome must be stripped server-side
    assert page.locator("#search-shell").count() == 0, "welcome must not show the app header"
    assert page.locator("nav a[data-tab]").count() == 0, "welcome must not show the app nav"
    assert page.locator("#fab-add").count() == 0, "welcome must not show the add-contact FAB"


def test_login_page_has_the_form_and_cross_links(page):
    _goto(page, "/login")

    assert page.locator("#auth-form").count() == 1, "login form is missing"
    assert page.locator("#auth-email").count() == 1, "login email field is missing"
    assert page.locator("#auth-password").count() == 1, "login password field is missing"
    assert page.locator('a[href="/signup"]').count() >= 1, "login does not link to signup"
    assert page.locator('a[href="/welcome"]').count() >= 1, "login does not link back to welcome"
    assert page.locator("#search-shell").count() == 0, "login must render in the bare shell"
    assert page.locator("#auth-error").count() == 1, "login has no error surface"


def test_signup_page_requires_a_password_confirmation(page):
    _goto(page, "/signup")

    assert page.locator("#auth-form").count() == 1, "signup form is missing"
    assert page.locator("#auth-confirm").count() == 1, "signup must ask to confirm the password"
    assert page.locator('a[href="/login"]').count() >= 1, "signup does not link to login"
    assert page.locator("#search-shell").count() == 0, "signup must render in the bare shell"


def test_login_surfaces_the_api_error_for_bad_credentials(page):
    _goto(page, "/login")

    page.fill("#auth-email", "nobody+%s@example.com" % uuid.uuid4().hex[:8])
    page.fill("#auth-password", "WrongPass999")
    page.click("#auth-submit")

    page.wait_for_selector("#auth-error:not(.hidden)", timeout=15000)
    text = page.inner_text("#auth-error").lower()
    assert any(word in text for word in ("incorrect", "invalid", "credentials")), (
        f"bad-login error is not human readable: {text!r}"
    )


def test_first_visit_routes_through_welcome_then_into_the_app(browser):
    """A fresh browser hitting / goes via /welcome once, then straight in."""
    context = browser.new_context(viewport={"width": 1280, "height": 900})
    page = context.new_page()
    # Only skip the intro and live-reload: the welcome flag must stay unset.
    page.add_init_script(
        "try { window.EventSource = class { constructor(){this.readyState=0} "
        "addEventListener(){} removeEventListener(){} close(){} }; "
        "sessionStorage.setItem('cb-intro', '1'); } catch (e) {}"
    )
    try:
        page.goto(BASE_URL + "/", wait_until="load")
        page.wait_for_url("**/welcome", timeout=15000)
        assert page.url.endswith("/welcome"), f"expected /welcome, landed on {page.url}"

        # the flag was set by that visit, so the app now loads directly
        page.goto(BASE_URL + "/", wait_until="load")
        page.wait_for_selector("#search-shell", timeout=15000)
    finally:
        context.close()
