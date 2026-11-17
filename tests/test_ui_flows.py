"""
End-to-end browser flows on the contacts page (Playwright, sync API).

Covers: clean first load, the FAB -> form -> create flow, detail popup, edit,
delete with confirmation, search filter + clear, and switching routes by
clicking the navigation links.

Everything asserts on stable element ids, roles and text only.
"""

from conftest import (
    BASE_URL,
    ROUTES,
    assert_active_nav,
    click_nav,
    entry_exists,
    entry_locator,
    http,
    open_contacts,
    open_detail,
    open_page,
    ready_heading,
    real_console_errors,
    wait_for_contacts,
    wait_for_list_reload,
    wait_for_toast,
    wait_modal,
)


def test_page_loads_contacts_without_console_errors(page, console_errors):
    open_contacts(page, "/")

    hint = page.locator("#result-hint").inner_text().strip()
    assert hint, "the result hint never got a value"
    assert not hint.lower().startswith("loading"), f"the list is still loading: {hint!r}"

    banner = page.locator("#api-banner")
    assert banner.count() == 0 or not banner.is_visible(), (
        "the API-offline banner is visible although the list loaded"
    )

    errors = real_console_errors(console_errors)
    assert errors == [], "the page logged errors while loading:\n" + "\n".join(errors)


def test_fab_opens_the_contact_form(page):
    open_contacts(page, "/")

    page.click("#fab-add")
    wait_modal(page, "#form-modal", opened=True)

    assert page.locator("#form-modal").is_visible(), "#form-modal is open but not visible"
    title = page.locator("#form-title").inner_text().strip()
    assert "new" in title.lower(), f"the form title for a fresh contact is {title!r}"
    assert page.locator("#f-name").is_visible(), "the name field is not shown"


def test_creating_a_contact_shows_it_and_a_toast(page, contact):
    open_contacts(page, "/")
    name = contact.name  # created through the UI, removed by the fixture

    page.click("#fab-add")
    wait_modal(page, "#form-modal", opened=True)
    page.fill("#f-name", name)
    page.fill("#f-company", contact.company)
    page.click("#form-submit")

    toast = wait_for_toast(page)
    assert "added" in toast.lower(), f"unexpected toast after creating a contact: {toast!r}"

    wait_modal(page, "#form-modal", opened=False)
    wait_for_list_reload(page)
    page.wait_for_selector(
        '#contact-grid [data-id]:has-text("%s")' % name, timeout=15000
    )
    entry = entry_locator(page, name)
    assert name in entry.inner_text(), "the new contact entry does not show its name"


def test_detail_popup_shows_the_contact_name(page, contact):
    contact.ensure()
    open_contacts(page, "/")

    open_detail(page, contact.name)
    shown = page.locator("#detail-name").inner_text().strip()
    assert shown == contact.name, f"detail popup shows {shown!r}, expected {contact.name!r}"
    assert page.locator("#detail-modal").is_visible()


def test_edit_updates_the_contact(page, contact):
    contact.ensure()
    new_company = "Edited " + contact.token
    open_contacts(page, "/")

    open_detail(page, contact.name)
    page.click("#detail-edit")
    wait_modal(page, "#detail-modal", opened=False)
    wait_modal(page, "#form-modal", opened=True)

    title = page.locator("#form-title").inner_text().strip()
    assert "edit" in title.lower(), f"the form title in edit mode is {title!r}"
    assert page.locator("#f-name").input_value() == contact.name, (
        "the edit form is not pre-filled with the contact"
    )

    page.fill("#f-company", new_company)
    page.click("#form-submit")

    toast = wait_for_toast(page)
    assert "updated" in toast.lower(), f"unexpected toast after editing: {toast!r}"

    wait_modal(page, "#form-modal", opened=False)
    wait_for_list_reload(page)

    open_detail(page, contact.name)
    company = page.locator("#detail-company").inner_text().strip()
    assert new_company in company, f"detail still shows company {company!r}, expected {new_company!r}"


def test_delete_asks_for_confirmation_then_removes_the_contact(page, contact):
    contact.ensure()
    open_contacts(page, "/")

    open_detail(page, contact.name)
    page.click("#detail-delete")
    wait_modal(page, "#confirm-modal", opened=True)

    message = page.locator("#confirm-message").inner_text()
    assert contact.name in message, (
        f"the confirmation does not name the contact: {message!r}"
    )

    # Cancelling must keep the contact.
    page.click("#confirm-no")
    wait_modal(page, "#confirm-modal", opened=False)
    assert entry_exists(page, contact.name), "the contact disappeared after cancelling"

    # Confirming must remove it.
    page.click("#detail-delete")
    wait_modal(page, "#confirm-modal", opened=True)
    page.click("#confirm-yes")
    wait_modal(page, "#confirm-modal", opened=False)
    wait_modal(page, "#detail-modal", opened=False)
    wait_for_list_reload(page)
    page.wait_for_function(
        """([name]) => ![...document.querySelectorAll('#contact-grid [data-id]')]
             .some(el => (el.textContent || '').includes(name))""",
        arg=[contact.name],
        timeout=15000,
    )
    assert not entry_exists(page, contact.name), "the deleted contact is still listed"

    status, body = http("GET", "/api/contacts/%d" % contact.id)
    assert status == 404, f"the contact is still readable after deletion (HTTP {status}): {body}"


def test_search_filters_to_the_new_contact_and_clearing_restores(page, contact):
    contact.ensure()
    open_contacts(page, "/")
    wait_for_contacts(page)

    original_count = page.locator("#contact-grid [data-id]").count()
    assert original_count >= 1, "no contacts were listed before searching"

    toggle = page.locator("#search-toggle")
    if toggle.get_attribute("aria-expanded") != "true":
        toggle.click()
        page.wait_for_function(
            "() => document.querySelector('#search-toggle')"
            ".getAttribute('aria-expanded') === 'true'"
        )
    page.fill("#search-input", contact.name)

    page.wait_for_function(
        """([name]) => {
             const hint = document.querySelector('#result-hint');
             if (!hint || !/result/i.test(hint.textContent || '')) return false;
             const entries = [...document.querySelectorAll('#contact-grid [data-id]')];
             return entries.length === 1
               && (entries[0].textContent || '').includes(name);
           }""",
        arg=[contact.name],
        timeout=20000,
    )
    hint = page.locator("#result-hint").inner_text().strip()
    assert "1 result" in hint.lower(), f"unexpected result hint while searching: {hint!r}"
    assert page.locator('#contact-grid [data-id]:has-text("%s")' % contact.name).count() == 1

    # Clearing the search must bring the full list back.
    page.click("#search-clear")
    page.wait_for_function(
        """() => {
             const hint = document.querySelector('#result-hint');
             return !!hint && !/result/i.test(hint.textContent || '');
           }""",
        timeout=20000,
    )
    page.wait_for_function(
        """([count]) => document.querySelectorAll('#contact-grid [data-id]').length >= count""",
        arg=[original_count],
        timeout=20000,
    )
    assert entry_exists(page, contact.name), "the contact is missing after clearing the search"
    hint = page.locator("#result-hint").inner_text().strip()
    assert contact.token not in hint, f"the hint still shows the query: {hint!r}"


def test_nav_links_switch_between_the_four_routes(page):
    open_page(page, "/", ready=lambda p: ready_heading(p, "Contacts"))
    assert_active_nav(page, "contacts")

    for path, tab, label in ROUTES[1:]:
        click_nav(page, tab, path, ready=lambda p, l=label: ready_heading(p, l))
        assert page.url.split("?")[0].rstrip("/") == (BASE_URL + path).rstrip("/"), (
            f"clicking the {tab} link landed on {page.url}"
        )
        assert_active_nav(page, tab)
        ready_heading(page, label)

    # And back to the first tab, so every nav link is exercised.
    click_nav(page, "contacts", "/", ready=lambda p: ready_heading(p, "Contacts"))
    assert_active_nav(page, "contacts")
    assert page.url.split("?")[0].rstrip("/") == BASE_URL
