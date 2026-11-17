"""
Capture the Contact Book UI at three viewports for visual review.

    python scripts/screenshots.py [--base http://localhost:3000] [--out screenshots]

Requires: pip install playwright && playwright install chromium
"""
import argparse
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

VIEWPORTS = [
    ("desktop", 1440, 900),
    ("tablet", 834, 1112),
    ("mobile", 390, 844),
]

ROUTES = ["/", "/favorites", "/groups", "/settings"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:3000")
    parser.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "screenshots"))
    args = parser.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    errors = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        for name, width, height in VIEWPORTS:
            page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=2)
            page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

            for route in ROUTES:
                slug = "contacts" if route == "/" else route.strip("/")
                page.goto(f"{args.base}{route}", wait_until="networkidle")
                page.wait_for_timeout(2600)  # let the intro splash finish
                target = out / f"{slug}-{name}.png"
                page.screenshot(path=str(target), full_page=False)
                print(f"saved {target.name}")
            page.close()

        browser.close()

    if errors:
        print("\nconsole/page errors:")
        for err in dict.fromkeys(errors):
            print(" -", err)
        return 1

    print("\nno console errors")
    return 0


if __name__ == "__main__":
    sys.exit(main())
