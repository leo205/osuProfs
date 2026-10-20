import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import update_cse_roster as roster


class RosterTests(unittest.TestCase):
    def test_directory_reads_compound_surname_and_next_page(self):
        parser = roster.DirectoryPage("https://cse.osu.edu/directory/faculty?page=0")
        parser.feed('<a href="/people/abushattal.1" title="View full profile for Abu Shattal, Mohammad">Profile</a>'
                    '<a href="?page=1" rel="next" title="Go to next page">Next</a>')
        self.assertEqual("Abu Shattal", parser.people[0]["surname"])
        self.assertEqual("Mohammad Abu Shattal", parser.people[0]["name"])
        self.assertEqual("https://cse.osu.edu/directory/faculty?page=1", parser.next_page)

    def test_history_supplies_course_context_without_inventing_given_names(self):
        identities = {"rubao": {"id": "rubao", "name": "Rubao Lee", "surname": "Lee", "sourceUrls": ["https://cse.osu.edu/people/lee.11875"]},
                      "yoonkyung": {"id": "yoonkyung", "name": "Yoonkyung Lee", "surname": "Lee", "sourceUrls": ["https://cse.osu.edu/people/lee.2272"]}}
        history = {"schemaVersion": 1, "subject": "CSE", "sourceUrl": "https://registrar.osu.edu/report.pdf", "retrievedAt": "2026-10-20T18:00:00Z",
                   "associations": [{"name": "Rubao Lee", "surname": "Lee", "catalogNumbers": ["2421"]},
                                    {"name": "R Lee", "surname": "Lee", "catalogNumbers": ["3521"]}]}
        affinities = {}
        roster.add_history(identities, affinities, {"courses": []}, history)
        self.assertEqual({"rubao": ["2421"]}, affinities)
        self.assertEqual(2, len(identities))

    def test_same_surname_different_given_names_are_not_collapsed(self):
        self.assertFalse(roster.same_person_name({"name": "Ting Zhu", "surname": "Zhu"}, {"name": "Zhihui Zhu", "surname": "Zhu"}))
        self.assertTrue(roster.same_person_name({"name": "Timothy Ellis Carpenter", "surname": "Carpenter"}, {"name": "Timothy Carpenter", "surname": "Carpenter"}))

    def test_source_failure_and_candidate_overflow_leave_existing_files_untouched(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            registry = root / "registry.json"
            registry.write_text(json.dumps({"schemaVersion": 1, "subject": "CSE", "identities": []}))
            catalog = root / "catalog.json"
            catalog.write_text('{"courses": []}')
            history = root / "history.json"
            history.write_text(json.dumps({"schemaVersion": 1, "subject": "CSE", "sourceUrl": "https://registrar.osu.edu/report.pdf", "retrievedAt": "2026-10-20T18:00:00Z", "associations": []}))
            seeds = root / "seeds.txt"
            seeds.write_text("previous\n")
            arguments = ["update_cse_roster.py", "--registry", str(registry), "--catalog", str(catalog), "--history", str(history),
                         "--seeds", str(seeds), "--receipt", str(root / "receipt.json"), "--max-surnames", "1"]
            before = registry.read_bytes(), seeds.read_bytes()
            with patch("sys.argv", arguments), patch.object(roster, "collect_directory", side_effect=RuntimeError("source unavailable")):
                with self.assertRaises(RuntimeError): roster.main()
            self.assertEqual(before, (registry.read_bytes(), seeds.read_bytes()))
            names = [{"name": "Given One", "surname": "One", "profileUrl": "https://cse.osu.edu/people/one.1", "sourceUrl": "https://cse.osu.edu/directory/faculty"},
                     {"name": "Given Two", "surname": "Two", "profileUrl": "https://cse.osu.edu/people/two.1", "sourceUrl": "https://cse.osu.edu/directory/faculty"}]
            with patch("sys.argv", arguments), patch.object(roster, "collect_directory", return_value=(names, [])):
                with self.assertRaises(ValueError): roster.main()
            self.assertEqual(before, (registry.read_bytes(), seeds.read_bytes()))


if __name__ == "__main__":
    unittest.main()
