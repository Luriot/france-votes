"""Tests des utilitaires de téléchargement (sans réseau)."""

import hashlib
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))

import download  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
