"""Tests des utilitaires de téléchargement (sans réseau externe)."""

import hashlib
import http.server
import json
import sys
import tempfile
import threading
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))

import download  # noqa: E402


def start_server(payload: bytes, etag: str):
    """Serveur minimal qui honore If-None-Match, comme data.assemblee-nationale.fr."""

    class Handler(http.server.BaseHTTPRequestHandler):
        requests: list[dict] = []

        def do_GET(self):
            Handler.requests.append({key.lower(): value for key, value in self.headers.items()})
            if self.headers.get("If-None-Match") == Handler.etag:
                self.send_response(304)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Length", str(len(Handler.payload)))
            self.send_header("ETag", Handler.etag)
            self.send_header("Last-Modified", "Sat, 12 Sep 2026 10:25:35 GMT")
            self.end_headers()
            self.wfile.write(Handler.payload)

        def log_message(self, *args):
            pass

    Handler.payload = payload
    Handler.etag = etag
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, Handler


def manifest_entry(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))["sources"][0]


class TestDownload(unittest.TestCase):
    def test_checksums(self):
        payload = b"abc" * 1000
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "blob.bin"
            path.write_bytes(payload)
            md5, sha = download.checksums(path)
        self.assertEqual(md5, hashlib.md5(payload).hexdigest())
        self.assertEqual(sha, hashlib.sha256(payload).hexdigest())

    def test_sources_unicite_et_https(self):
        files = [source["file"] for source in download.SOURCES]
        self.assertEqual(len(files), len(set(files)), "un même fichier ne peut pas avoir deux entrées")
        for source in download.SOURCES:
            self.assertTrue(source["url"].startswith("https://"), source["url"])
            self.assertTrue(source["name"] and source["page"])

    def test_conditional_headers(self):
        self.assertEqual(download.conditional_headers(None), {})
        self.assertEqual(download.conditional_headers({}), {})
        self.assertEqual(download.conditional_headers({"etag": None, "last_modified": None}), {})
        entry = {"etag": '"abc"', "last_modified": "Sat, 12 Sep 2026 10:25:35 GMT"}
        self.assertEqual(download.conditional_headers(entry), {
            "If-None-Match": '"abc"',
            "If-Modified-Since": "Sat, 12 Sep 2026 10:25:35 GMT",
        })


class TestSync(unittest.TestCase):
    """Parcours complet 200 → 304 → réédition identique → contenu modifié."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.server, self.handler = start_server(b"premiere version", '"v1"')
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.source = {
            "name": "test",
            "file": "blob.bin",
            "url": f"http://127.0.0.1:{self.server.server_port}/blob.bin",
            "page": "https://exemple.test",
        }
        originals = (download.SOURCES, download.RAW, download.MANIFEST, download.time)
        self.addCleanup(self._restore, originals)
        download.SOURCES = [self.source]
        download.RAW = self.root / "raw"
        download.MANIFEST = self.root / "manifest.json"
        download.time = types.SimpleNamespace(sleep=lambda seconds: None)

    @staticmethod
    def _restore(originals):
        download.SOURCES, download.RAW, download.MANIFEST, download.time = originals

    def test_sync_conditionnel(self):
        first = download.sync()
        self.assertTrue(first["changed"])
        dest = self.root / "raw" / "blob.bin"
        self.assertEqual(dest.read_bytes(), b"premiere version")
        entry = manifest_entry(download.MANIFEST)
        self.assertEqual(entry["etag"], '"v1"')
        self.assertEqual(entry["sha256"], hashlib.sha256(b"premiere version").hexdigest())
        self.assertEqual(len(self.handler.requests), 1)
        retrieved = entry["retrieved_at"]

        second = download.sync()
        self.assertFalse(second["changed"], "304 : rien à reconstruire")
        self.assertEqual(len(self.handler.requests), 2)
        self.assertEqual(self.handler.requests[1].get("if-none-match"), '"v1"')
        self.assertEqual(manifest_entry(download.MANIFEST)["retrieved_at"], retrieved)

        forced = download.sync(force=True)
        self.assertTrue(forced["changed"], "--force : retéléchargement inconditionnel")
        self.assertNotIn("if-none-match", self.handler.requests[2])
        self.assertEqual(len(self.handler.requests), 3)

        self.handler.etag = '"v1b"'
        third = download.sync()
        self.assertFalse(third["changed"], "réédition à contenu identique")
        entry3 = manifest_entry(download.MANIFEST)
        self.assertEqual(entry3["etag"], '"v1b"')
        self.assertEqual(entry3["retrieved_at"], retrieved, "date d'audit conservée")
        self.assertEqual(dest.read_bytes(), b"premiere version")

        self.handler.payload = b"deuxieme version, plus longue"
        self.handler.etag = '"v2"'
        fourth = download.sync()
        self.assertTrue(fourth["changed"])
        self.assertEqual(dest.read_bytes(), self.handler.payload)
        entry4 = manifest_entry(download.MANIFEST)
        self.assertEqual(entry4["etag"], '"v2"')
        self.assertNotEqual(entry4["sha256"], entry["sha256"])


if __name__ == "__main__":
    unittest.main()
