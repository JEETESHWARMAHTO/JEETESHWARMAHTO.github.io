"""
Accessibility checks that do not depend on the visual design:

* every page exposes a single h1 (or at least one clear page heading),
* every visible interactive control has an accessible name,
* keyboard focus on the navigation links is visible,
* prefers-reduced-motion is honoured without errors.
"""

import pytest

from conftest import (
    ROUTES,
    open_page,
    real_console_errors,
)

UNNAMED_CONTROLS_JS = """() => {
  const out = [];
  document.querySelectorAll('button, a[href]').forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return;

    let name = (el.getAttribute('aria-label') || '').trim();
    if (!name && el.getAttribute('aria-labelledby')) {
      name = el.getAttribute('aria-labelledby').split(/\\s+/)
        .map(id => ((document.getElementById(id) || {}).textContent) || '')
        .join(' ').trim();
    }
    if (!name) name = (el.textContent || '').trim();
    if (!name) name = (el.getAttribute('title') || '').trim();
    if (!name) {
      const img = el.querySelector('img[alt]');
      if (img) name = (img.getAttribute('alt') || '').trim();
    }
    if (!name) {
      const label = el.id ? document.querySelector('label[for="' + el.id + '"]') : null;
      if (label) name = (label.textContent || '').trim();
    }
    if (!name) {
      out.push((el.id ? '#' + el.id : el.tagName) + ' ' + el.outerHTML.slice(0, 140));
    }
  });
  return out;
}"""


@pytest.mark.parametrize("path,tab,label", ROUTES)
def test_page_has_one_h1_or_a_clear_page_heading(page, path, tab, label):
    open_page(page, path)

    h1s = page.locator("h1")
    if h1s.count() > 1:
        pytest.fail(
            f"{path} renders {h1s.count()} h1 elements: {h1s.all_inner_texts()!r}"
        )
    if h1s.count() == 1:
        text = h1s.first.inner_text().strip()
        assert label.lower() in text.lower(), (
            f"the h1 on {path} is {text!r}; it should name the page ({label})"
        )
        return

    # No h1 at all: the page must still carry one clear heading for its title.
    headings = page.locator("h2, h3")
    texts = [text.strip() for text in headings.all_inner_texts()]
    matching = [text for text in texts if label.lower() in text.lower()]
    assert matching, (
        f"{path} has no h1 and no heading that names the page ({label}); "
        f"headings found: {texts!r}"
    )


@pytest.mark.parametrize("path,tab,label", ROUTES)
def test_visible_controls_have_accessible_names(page, path, tab, label):
    open_page(page, path)
    unnamed = page.evaluate(UNNAMED_CONTROLS_JS)
    assert unnamed == [], (
        f"{path} has visible controls without an accessible name:\n" + "\n".join(unnamed)
    )


def test_navigation_links_have_a_visible_focus_indicator(page):
    open_page(page, "/")

    focused = None
    for _ in range(20):
        page.keyboard.press("Tab")
        info = page.evaluate(
            """() => {
                 const el = document.activeElement;
                 if (!el) return null;
                 return {
                   tag: el.tagName,
                   tab: el.getAttribute('data-tab'),
                   label: (el.getAttribute('aria-label') || el.textContent || '').trim(),
                 };
               }"""
        )
        if info and info["tag"] == "A" and info["tab"]:
            focused = info
            break
    assert focused is not None, "keyboard focus never reached a navigation link"

    styles = page.evaluate(
        """() => {
             const el = document.activeElement;
             const cs = getComputedStyle(el);
             return {
               outlineStyle: cs.outlineStyle,
               outlineWidth: cs.outlineWidth,
               boxShadow: cs.boxShadow,
               focusVisible: el.matches(':focus-visible'),
             };
           }"""
    )
    try:
        outline_px = float(styles["outlineWidth"].replace("px", "").strip() or 0)
    except ValueError:
        outline_px = 0.0
    has_outline = styles["outlineStyle"] not in ("none", "") and outline_px > 0
    has_shadow = styles["boxShadow"] not in ("none", "")

    assert has_outline or has_shadow, (
        f'the focused nav link ({focused["tab"]}) has no visible focus indicator: {styles}'
    )


def test_prefers_reduced_motion_is_respected(page, console_errors):
    page.emulate_media(reduced_motion="reduce")
    open_page(page, "/")

    assert page.evaluate(
        "() => matchMedia('(prefers-reduced-motion: reduce)').matches"
    ), "the prefers-reduced-motion media feature was not applied to the page"

    # The app skips its opening splash when the user asks for less motion.
    assert page.locator("#intro").count() == 0, (
        "the intro splash is still in the document although reduced motion is requested"
    )

    errors = real_console_errors(console_errors)
    assert errors == [], "the page logged errors under reduced motion:\n" + "\n".join(errors)
