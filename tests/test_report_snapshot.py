import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('capture', Path(__file__).resolve().parents[1] / 'scripts/capture-report-snapshot.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SnapshotTest(unittest.TestCase):
    def test_sunday_retained_when_monday_arrives(self):
        sunday = {'id': '2026-11', 'period': {'start': '2026-11-01', 'end': '2026-11-08'}, 'records': []}
        data = {'months': [sunday], 'drive': {'lastSync': '2026-11-08T23:26:03Z'}}
        keywords = {'months': [dict(sunday, keywords=[])]}
        archive = module.capture(data, keywords, {})
        self.assertEqual(len(archive['snapshots']), 1)
        self.assertIsNotNone(archive['snapshots'][0]['keywords'])
        monday = {'months': [dict(sunday, period={'start': '2026-11-01', 'end': '2026-11-09'})]}
        self.assertEqual(module.capture(monday, {}, archive), archive)
        data['drive']['lastSync'] = '2026-11-09T11:00:00Z'
        self.assertEqual(module.capture(data, keywords, archive), archive)


if __name__ == '__main__':
    unittest.main()
