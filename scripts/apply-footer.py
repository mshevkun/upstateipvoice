import re
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
new_footer = (root / "partials" / "site-footer.html").read_text(encoding="utf-8").strip()

nested_footer = new_footer.replace('src="images/', 'src="../images/')
nested_footer = nested_footer.replace('srcset="images/', 'srcset="../images/')
nested_footer = nested_footer.replace(", images/", ", ../images/")
nested_footer = re.sub(
    r'href="(?!https://|mailto:|#)([^"]+)"',
    r'href="../\1"',
    nested_footer,
)

files = [
    "index.html",
    "about.html",
    "solutions.html",
    "support.html",
    "privacy.html",
    "acceptable-use-policy.html",
    "privacy-policy/index.html",
    "terms/index.html",
]

pattern = re.compile(
    r'(?:<!-- Root-relative paths.*?-->\s*)?<footer class="site-footer site-footer--figma".*?</footer>',
    re.DOTALL,
)

for rel in files:
    path = root / rel
    text = path.read_text(encoding="utf-8")
    footer = nested_footer if "/" in rel else new_footer
    if not pattern.search(text):
        print("NO MATCH", rel)
        continue
    updated = pattern.sub(footer, text, count=1)
    path.write_text(updated, encoding="utf-8")
    print("updated", rel)
