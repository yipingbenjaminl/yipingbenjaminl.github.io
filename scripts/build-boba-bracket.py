#!/usr/bin/env python3
"""Regenerate food/boba-bracket.html from data/boba-bracket.md.

Usage: python3 scripts/build-boba-bracket.py
Requires: pip install markdown
"""
import pathlib
import re

import markdown

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "boba-bracket.md"
OUT = ROOT / "food" / "boba-bracket.html"

TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Boba Bracket - Nov. 22, 2026</title>
  <meta name="description" content="Profiles of 28 Metro Vancouver bubble tea shops, the classic milk tea to order at each, and five ways to split them into a taste-test bracket.">
  <link rel="stylesheet" href="../assets/css/style.css">
  <script src="../assets/js/theme.js"></script>
  <style>
    .doc-page {{ max-width: 960px; margin: 0 auto; padding: 100px 24px 80px; }}
    .back-link {{ display: inline-block; margin-bottom: 24px; color: var(--accent); text-decoration: none; font-size: 0.9rem; }}
    .back-link:hover {{ color: var(--accent-hover); }}
    .doc h1 {{ font-size: 1.9rem; line-height: 1.2; margin-bottom: 6px; }}
    .doc h1 + p {{ color: var(--text-muted); font-size: 0.9rem; margin-bottom: 24px; }}
    .doc h2 {{ font-size: 1.4rem; margin: 48px 0 12px; padding-top: 16px; border-top: 1px solid var(--border); }}
    .doc h3 {{ font-size: 1.1rem; margin: 28px 0 10px; }}
    .doc p {{ margin-bottom: 14px; }}
    .doc ul, .doc ol {{ margin: 0 0 16px 22px; }}
    .doc li {{ margin-bottom: 8px; }}
    .doc a {{ color: var(--accent); }}
    .doc a:hover {{ color: var(--accent-hover); }}
    .table-wrap {{ overflow-x: auto; margin: 8px 0 20px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }}
    .doc table {{ border-collapse: collapse; width: 100%; font-size: 0.875rem; }}
    .doc th, .doc td {{ text-align: left; vertical-align: top; padding: 10px 12px; border-bottom: 1px solid var(--border); }}
    .doc th {{ background: var(--bg-alt); font-weight: 600; white-space: nowrap; }}
    .doc tr:last-child td {{ border-bottom: none; }}
    .doc td:first-child {{ font-weight: 600; }}
    @media (max-width: 640px) {{
      .doc-page {{ padding: 88px 16px 64px; }}
      .doc h1 {{ font-size: 1.5rem; }}
      .doc table {{ font-size: 0.8rem; }}
    }}
  </style>
</head>
<body>
  <nav class="navbar">
    <a href="/" class="nav-logo">BL</a>
    <div class="nav-links">
      <a href="/#about">About</a>
      <a href="/#tools">Tools</a>
      <a href="/#resume">Resume</a>
      <button type="button" class="theme-toggle" data-theme-toggle aria-label="Toggle light and dark theme">☀️</button>
    </div>
  </nav>

  <main class="doc-page">
    <a href="/#tools" class="back-link">&larr; Back to Tools</a>
    <article class="doc">
{body}
    </article>
  </main>

  <footer class="footer">
    <div class="container">
      <p>&copy; 2026 Benjamin Liu</p>
    </div>
  </footer>
</body>
</html>
"""


def build() -> None:
    html = markdown.markdown(SRC.read_text(encoding="utf-8"), extensions=["tables", "sane_lists"])
    html = html.replace("<table>", '<div class="table-wrap"><table>').replace("</table>", "</table></div>")
    # Open external links in a new tab.
    html = re.sub(r'<a href="(https?://[^"]+)">', r'<a href="\1" target="_blank" rel="noopener">', html)
    OUT.write_text(TEMPLATE.format(body=html), encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    build()
