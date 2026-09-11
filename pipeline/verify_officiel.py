import re
import sys
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
for numero in (3824, 218):
    url = f"https://www.assemblee-nationale.fr/dyn/17/scrutins/{numero}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    html = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"\s+", " ", text)
    for label in ("Pour l'adoption", "Contre", "Abstention", "Nombre de votants"):
        m = re.search(re.escape(label) + r"\s*:?\s*(\d+)", text)
        print(numero, label, "=", m.group(1) if m else "?")
    print()
