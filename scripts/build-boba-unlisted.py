#!/usr/bin/env python3
"""Regenerate the unlisted Boba Bracket pages (round 1 plan and app spec).

Reuses the Boba Bracket page template, adds noindex and drops the Tools back-link.
Usage: python3 scripts/build-boba-unlisted.py
"""
import pathlib
import re
import runpy

import markdown

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGES = [
    ("boba-bracket-round-1", "Boba Bracket Round 1", "Organizer plan for round 1 of the Boba Bracket."),
    ("boba-bracket-app-spec", "Boba Bracket App Spec", "Spec for the blind ranking app used at the Boba Bracket."),
]

base = runpy.run_path(str(ROOT / "scripts" / "build-boba-bracket.py"))
BASE_DESC = '<meta name="description" content="Profiles of 28 Metro Vancouver bubble tea shops, the classic milk tea to order at each, and five ways to split them into a taste-test bracket.">'
assert BASE_DESC in base["TEMPLATE"]


def template(title: str, desc: str) -> str:
    t = (
        base["TEMPLATE"]
        .replace("<title>Boba Bracket - Benjamin Liu</title>",
                 f'<title>{title} - Benjamin Liu</title>\n  <meta name="robots" content="noindex, nofollow">')
        .replace(BASE_DESC, f'<meta name="description" content="{desc}">')
        .replace('    <a href="/#tools" class="back-link">&larr; Back to Tools</a>\n', "")
    )
    assert "noindex" in t and "Back to Tools" not in t
    return t


def build() -> None:
    for slug, title, desc in PAGES:
        src = ROOT / "data" / f"{slug}.md"
        out = ROOT / "food" / f"{slug}.html"
        html = markdown.markdown(src.read_text(encoding="utf-8"), extensions=["tables", "sane_lists"])
        html = html.replace("<table>", '<div class="table-wrap"><table>').replace("</table>", "</table></div>")
        html = re.sub(r'<a href="(https?://[^"]+)">', r'<a href="\1" target="_blank" rel="noopener">', html)
        out.write_text(template(title, desc).format(body=html), encoding="utf-8")
        print(f"Wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    build()
