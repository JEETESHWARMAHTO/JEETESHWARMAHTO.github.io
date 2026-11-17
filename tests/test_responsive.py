"""
Layout behaviour at two viewports: 390x844 (mobile, touch) and 1440x900
(desktop).

These checks are deliberately about behaviour and geometry, not styling:
a contact entry must behave like a horizontal list row on mobile, the right
navigation must be the one that is visible, a tap must open the detail popup
and edit/delete must be reachable by tap (no hover involved).
"""

import re

from conftest import (
    entry_locator,
    open_contacts,
    open_detail,
    wait_for_contacts,
    wait_modal,
)

MOBILE = (390, 844)
DESKTOP = (1440, 900)
MAX_ROW_HEIGHT = 160  # a row is a single line, not a stacked card


def _bottom_nav(page):
    # The bottom navigation is the <nav> that lives outside the <header>.
    return page.locator("//nav[not(ancestor::header)]")


def _visible_control(entry, kind):
    """The first *visible* edit/delete control inside a contact entry.

    A row can carry the same action twice (an always-present footer and a
    collapsed menu), so only the visible one counts.
    """
    matches = entry.locator('[data-action="%s"]' % kind)
    for index in range(matches.count()):
        candidate = matches.nth(index)
        if candidate.is_visible():
            return candidate

    pattern = re.compile(kind, re.I)
    buttons = entry.locator("button")
    for index in range(buttons.count()):
        button = buttons.nth(index)
        if not button.is_visible():
            continue
        name = "%s %s" % (button.get_attribute("aria-label") or "", button.text_content() or "")
        if pattern.search(name):
            return button
    return None


def _inline_actions_visible(entry):
    edit = _visible_control(entry, "edit")
    delete = _visible_control(entry, "delete")
    if edit is not None and delete is not None:
        return edit, delete
    return None, None


def _action_affordance(entry):
    """A row button that would reveal the actions (kebab / more / menu)."""
    buttons = entry.locator("button")
    named = re.compile(r"more|menu|option|action|kebab|expand|edit|delete", re.I)
    for index in range(buttons.count()):
        button = buttons.nth(index)
        action = button.get_attribute("data-action") or ""
        if action in ("view", "edit", "delete"):
            continue
        name = "%s %s" % (button.get_attribute("aria-label") or "", button.text_content() or "")
        if named.search(name):
            return button
    for index in range(buttons.count()):
        button = buttons.nth(index)
        if (button.get_attribute("data-action") or "") in ("view", "edit", "delete"):
            continue
        return button
    return None


def test_mobile_contact_entries_render_as_rows(mobile_page, contact):
    page = mobile_page
    contact.ensure()
    open_contacts(page, "/")
    wait_for_contacts(page)

    entry = entry_locator(page, contact.name)
    box = entry.bounding_box()
    assert box, "the contact entry has no bounding box"

    assert box["width"] > box["height"], (
        "the mobile contact entry is taller than it is wide, so it is still a "
        "stacked card instead of a horizontal list row: %r" % box
    )
    assert box["height"] <= MAX_ROW_HEIGHT, (
        "the mobile contact entry is %.0fpx tall - a list row should stay "
        "under %dpx, not become a multi-line card: %r"
        % (box["height"], MAX_ROW_HEIGHT, box)
    )


def test_mobile_bottom_nav_is_visible(mobile_page, contact):
    page = mobile_page
    open_contacts(page, "/")

    bottom = _bottom_nav(page)
    assert bottom.count() >= 1, "the page has no bottom navigation landmark"
    assert bottom.first.is_visible(), "the bottom navigation is not visible at 390x844"
    assert bottom.first.locator("a[data-tab]").count() >= 4, (
        "the bottom navigation does not expose all four destinations"
    )


def test_mobile_tap_on_a_row_opens_the_detail_popup(mobile_page, contact):
    page = mobile_page
    contact.ensure()
    open_contacts(page, "/")
    wait_for_contacts(page)

    entry = entry_locator(page, contact.name)
    entry.tap()

    try:
        wait_modal(page, "#detail-modal", opened=True, timeout=4000)
    except Exception as exc:  # noqa: BLE001 - reported with diagnostics below
        raise AssertionError(
            "a touch tap on the contact row did not open the detail popup "
            "(only an explicit control inside the row reacts to a tap): %s" % exc
        ) from exc

    shown = page.locator("#detail-name").inner_text().strip()
    assert shown == contact.name, f"detail popup shows {shown!r}, expected {contact.name!r}"


def test_mobile_edit_and_delete_are_reachable_by_tap(mobile_page, contact):
    page = mobile_page
    contact.ensure()
    open_contacts(page, "/")
    wait_for_contacts(page)

    entry = entry_locator(page, contact.name)
    source = "the contact row"

    edit, delete = _inline_actions_visible(entry)
    if edit is None:
        affordance = _action_affordance(entry)
        if affordance is not None:
            affordance.tap()
            page.wait_for_timeout(400)
            edit, delete = _inline_actions_visible(entry)
            source = "the row's action affordance"

    if edit is None:
        # No inline actions: the detail popup opened by a tap on the row has
        # to provide them (still no hover involved).
        open_detail(page, contact.name, touch=True)
        edit = page.locator("#detail-edit")
        delete = page.locator("#detail-delete")
        source = "the detail popup opened by tapping the row"

    assert edit is not None and delete is not None, (
        "no Edit/Delete control could be reached by tapping the contact row"
    )
    assert edit.is_visible(), f"Edit is not visible (reached via {source}) on mobile"
    assert delete.is_visible(), f"Delete is not visible (reached via {source}) on mobile"


def test_desktop_shows_top_nav_and_hides_bottom_nav(page):
    open_contacts(page, "/")

    top = page.locator("header nav")
    assert top.count() >= 1, "the page has no navigation inside the header"
    assert top.first.is_visible(), "the top navigation is not visible at 1440x900"

    bottom = _bottom_nav(page)
    assert bottom.count() >= 1, "the page has no bottom navigation landmark"
    assert not bottom.first.is_visible(), (
        "the bottom navigation is visible on a 1440x900 desktop viewport"
    )
