import copy
import json
import tempfile
import unittest
from pathlib import Path

from durable_state import restore, save
from publish_catalog import atomic_write, encoded, load_catalog, publish


class DurableStateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.public, self.saved, self.work = root / "public", root / "saved", root / "work"
        self.catalog = json.loads((Path(__file__).parents[1] / "catalog-contract.example.json").read_text())
        self.catalog["generatedAt"] = "2026-10-20T00:00:00Z"
        scope = self.catalog["coverage"][0]
        scope["courseCount"] = len(self.catalog["courses"])
        scope["sectionCount"] = sum(len(c["sections"]) for c in self.catalog["courses"])
        publish(self.catalog, self.public)
        atomic_write(self.work / "catalog.json", encoded(self.catalog))
        self.state = {"schemaVersion": 1, "queries": {"1272|col|CSE|teacher": {
            "checkedAt": "2026-10-20T00:00:00Z", "scopeFingerprint": "a" * 64}}}
        atomic_write(self.work / "discovery-state.json", encoded(self.state))

    def test_saved_names_and_search_progress_survive_total_cache_loss(self):
        save(self.public / "catalog-index.json", self.saved, self.work)
        import shutil
        shutil.rmtree(self.work)
        restore(self.public / "catalog-index.json", self.saved, self.work)
        self.assertEqual(self.catalog["courses"], load_catalog(self.work / "catalog.json")["courses"])
        self.assertEqual(self.state, json.loads((self.work / "discovery-state.json").read_text()))

    def test_new_published_results_replace_older_cache_and_its_completion_state(self):
        save(self.public / "catalog-index.json", self.saved, self.work)
        newer = copy.deepcopy(self.catalog)
        newer["generatedAt"] = "2026-10-22T00:00:00Z"
        newer["courses"][0]["sections"][0]["instructors"] = [{"id": "new", "name": "New Teacher", "role": "PI"}]
        publish(newer, self.public)
        old = json.loads((self.work / "discovery-state.json").read_text())
        old["queries"]["1272|col|CSE|obsolete"] = next(iter(self.state["queries"].values()))
        atomic_write(self.work / "discovery-state.json", encoded(old))
        restore(self.public / "catalog-index.json", self.saved, self.work)
        self.assertEqual("New Teacher", load_catalog(self.work / "catalog.json")["courses"][0]["sections"][0]["instructors"][0]["name"])
        self.assertNotIn("1272|col|CSE|obsolete", json.loads((self.work / "discovery-state.json").read_text())["queries"])

    def test_partial_or_unpublished_work_cannot_overwrite_durable_state(self):
        save(self.public / "catalog-index.json", self.saved, self.work)
        before = (self.saved / "instructor-queries.json").read_bytes()
        self.catalog["courses"][0]["title"] = "Unverified work"
        atomic_write(self.work / "catalog.json", encoded(self.catalog))
        with self.assertRaisesRegex(ValueError, "verified published catalog"):
            save(self.public / "catalog-index.json", self.saved, self.work)
        self.assertEqual(before, (self.saved / "instructor-queries.json").read_bytes())

    def test_corrupt_disposable_cache_recovers_from_durable_files(self):
        save(self.public / "catalog-index.json", self.saved, self.work)
        (self.work / "catalog.json").write_text("broken cache")
        restore(self.public / "catalog-index.json", self.saved, self.work)
        self.assertEqual(self.catalog["courses"], load_catalog(self.work / "catalog.json")["courses"])

    def test_saved_status_excludes_private_error_text_and_session_data(self):
        atomic_write(self.work / "collection.json", encoded({"discovery": {"failures": [{
            "campus": "col", "subject": "CSE", "attemptedAt": "2026-10-20T00:00:00Z",
            "error": "/Users/private/path ICSID=private-token"}]}}))
        save(self.public / "catalog-index.json", self.saved, self.work)
        status = (self.saved / "status.json").read_text()
        self.assertNotIn("private-token", status)
        self.assertNotIn("/Users/", status)
        self.assertIn("queries remain pending", status)


if __name__ == "__main__":
    unittest.main()
