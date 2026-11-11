import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('capture', Path(__file__).resolve().parents[1] / 'scripts/capture-report-snapshot.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SnapshotTest(unittest.TestCase):
    def daily(self):
        return {'id': '2026-11', 'period': {'start': '2026-11-01', 'end': '2026-11-09'},
                'records': [{'campaign': 'Search', 'cost': 90}],
                'detail': {'period': {'start': '2026-11-01', 'end': '2026-11-09'},
                           'table': {'columns': ['d', 'campaign', 'cost', 'clicks', 'conversions', 'impressions'],
                                     'campaigns': ['Search'], 'rows': [[d, 0, 10, 5, 1, 100] for d in range(1, 10)]}}}

    def test_daily_closes_sunday_with_impressions_and_excludes_monday(self):
        source = self.daily()
        result = module.daily_cutoff(source, module.date(2026, 11, 9))
        self.assertEqual(result['period']['end'], '2026-11-08')
        self.assertEqual(result['totals']['cost'], 80)
        self.assertEqual(result['totals']['impressions'], 800)
        self.assertEqual(len(result['detail']['table']['rows']), 8)
        self.assertEqual(len(source['detail']['table']['rows']), 9)

    def test_incomplete_or_duplicate_days_preserve_existing_snapshot(self):
        source = self.daily()
        source['detail']['table']['rows'].pop(3)
        self.assertIsNone(module.daily_cutoff(source, module.date(2026, 11, 9)))
        source = self.daily()
        source['detail']['table']['rows'].append(source['detail']['table']['rows'][0])
        self.assertIsNone(module.daily_cutoff(source, module.date(2026, 11, 9)))

    def test_current_sunday_is_not_a_closed_day(self):
        result = module.daily_cutoff(self.daily(), module.date(2026, 11, 8))
        self.assertEqual(result['period']['end'], '2026-11-01')

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
