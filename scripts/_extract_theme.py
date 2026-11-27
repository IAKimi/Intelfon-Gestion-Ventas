from pathlib import Path
import re

base = Path(r"C:\Users\angel\Downloads\_iakimi_template_extract\unzipped\word")
theme = (base / "theme" / "theme1.xml").read_text(encoding="utf-8")
print("=== COLORS ===")
for m in re.finditer(r'srgbClr val="([A-Fa-f0-9]+)"', theme):
    print(m.group(1))
print("=== FONTS ===")
for m in re.finditer(r'typeface="([^"]+)"', theme):
    print(m.group(1))
print("=== HEADER2 ===")
h2 = (base / "header2.xml").read_text(encoding="utf-8")
print(" ".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", h2)))
# highlight colors in document
doc = (base / "document.xml").read_text(encoding="utf-8")
fills = set(re.findall(r'w:fill="([A-Fa-f0-9]+)"', doc))
colors = set(re.findall(r'w:val="([A-Fa-f0-9]{6})"', doc))
print("=== FILLS ===", fills)
print("=== VAL COLORS sample ===", list(colors)[:40])
# shading / theme color refs
print("themeColor", set(re.findall(r'w:themeColor="([^"]+)"', doc)))
