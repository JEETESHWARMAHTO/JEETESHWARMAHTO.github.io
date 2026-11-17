"""
Served-HTML checks for the four routes (HTTP level, no browser).

These assert on the HTML the Node server actually renders: status codes,
titles, the active nav marker, unresolved template tokens, emoji, the shared
SVG sprite and the 404 behaviour.
"""

import re

import pytest

from conftest import ROUTES, emoji_characters, http

TITLE_SUFFIX = "- Contact Book"


def _fetch(path):
    status, body = http("GET", path)
    assert status == 200, f"{path} returned HTTP {status}: {str(body)[:200]}"
    assert isinstance(body, str), f"{path} did not return HTML"
    return body


@pytest.mark.parametrize("path,tab,label", ROUTES)
def test_route_returns_200(path, tab, label):
    status, body = http("GET", path)
    assert status == 200, f"{path} returned HTTP {status}"
    assert isinstance(body, str) and len(body) > 0


@pytest.mark.parametrize("path,tab,label", ROUTES)
def test_title_is_correct(path, tab, label):
    html = _fetch(path)
    match = re.search(r"<title>(.*?)</title>", html, re.S)
    assert match, f"{path} has no <title> element"
    title = match.group(1).strip()
    assert title.startswith(label), f"{path} title is {title!r}, expected it to start with {label!r}"
    assert TITLE_SUFFIX in title, f"{path} title is {title!r}, expected {TITLE_SUFFIX!r}"


@pytest.mark.parametrize("path,tab,label", ROUTES)
def test_exactly_one_nav_item_is_active(path, tab, label):
    """Each <nav> landmark marks exactly one item with aria-current="page"."""
    html = _fetch(path)
    nav_blocks = re.findall(r"<nav\b.*?</nav>", html, re.S | re.I)
    assert nav_blocks, f"{path} serves no <nav> landmark"

    marked_tabs = []
    for block in nav_blocks:
        anchors = re.findall(r"<a\b[^>]*>", block, re.I)
        marked = [a for a in anchors if 'aria-current="page"' in a]
        assert len(marked) == 1, (
            f"{path}: expected exactly one aria-current=\"page\" link in a nav, "
            f"found {len(marked)}"
        )
        tab_match = re.search(r'data-tab="([^"]+)"', marked[0])
        assert tab_match, f"{path}: active link has no data-tab attribute"
        marked_tabs.append(tab_match.group(1))

    assert set(marked_tabs) == {tab}, (
        f"{path}: active tab(s) {marked_tabs} do not match the expected {tab!r}"
    )


@pytest.mark.parametrize("path,tab,label", ROUTES)
def test_no_unresolved_template_tokens(path, tab, label):
    html = _fetch(path)
    leftovers = re.findall(r"\{\{[^}]*\}\}", html)
    assert leftovers == [], f"{path} still contains template tokens: {leftovers}"


@pytest.mark.parametrize("path,tab,label", ROUTES)
def test_no_emoji_in_served_html(path, tab, label):
    html = _fetch(path)
    found = emoji_characters(html)
    assert found == [], f"{path} served HTML contains emoji characters: {found}"


@pytest.mark.parametrize("path,tab,label", ROUTES)
def test_shared_logo_sprite_is_present(path, tab, label):
    html = _fetch(path)
    assert re.search(r"<symbol\b[^>]*\bid=[\"']logo-mark[\"']", html, re.I), (
        f"{path} is missing the shared SVG sprite symbol#logo-mark"
    )
    assert 'href="#logo-mark"' in html or 'href=\'#logo-mark\'' in html, (
        f"{path} does not reference the logo sprite"
    )


def test_unknown_route_returns_404():
    status, body = http("GET", "/no-such-page")
    assert status == 404, f"/no-such-page returned HTTP {status}, expected 404"
    text = body if isinstance(body, str) else str(body)
    assert "404" in text, "the 404 page does not mention 404"
