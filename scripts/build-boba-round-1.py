#!/usr/bin/env python3
"""Regenerate the unlisted Round 1 page from data/boba-bracket-round-1.md.

Reuses the Boba Bracket page template, adds noindex and drops the Tools back-link.
Usage: python3 scripts/build-boba-round-1.py
"""
import pathlib
import re
import runpy

import markdown

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "boba-bracket-round-1.md"
OUT = ROOT / "food" / "boba-bracket-round-1-8a1e870a.html"

base = runpy.run_path(str(ROOT / "scripts" / "build-boba-bracket.py"))
TEMPLATE = (
    base["TEMPLATE"]
    .replace("<title>Boba Bracket - Benjamin Liu</title>",
             '<title>Boba Bracket Round 1 - Benjamin Liu</title>\n  <meta name="robots" content="noindex, nofollow">')
    .replace('<meta name="description" content="Profiles of 28 Metro Vancouver bubble tea shops, the classic milk tea to order at each, and five ways to split them into a taste-test bracket.">',
             '<meta name="description" content="Organizer plan for round 1 of the Boba Bracket.">')
    .replace('    <a href="/#tools" class="back-link">&larr; Back to Tools</a>\n', "")
)
assert "noindex" in TEMPLATE and "back-link\">&larr;" not in TEMPLATE


def build() -> None:
    html = markdown.markdown(SRC.read_text(encoding="utf-8"), extensions=["tables", "sane_lists"])
    html = html.replace("<table>", '<div class="table-wrap"><table>').replace("</table>", "</table></div>")
    html = re.sub(r'<a href="(https?://[^"]+)">', r'<a href="\1" target="_blank" rel="noopener">', html)
    OUT.write_text(TEMPLATE.format(body=html), encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    build()
