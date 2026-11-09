"""Retiene el ultimo informe disponible de cada domingo, con su hora de captura."""
import json
import os
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from copy import deepcopy
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def daily_cutoff(month, today):
    """Rebuild a completed Sunday only from a complete, bounded daily capture."""
    detail = month.get('detail', {})
    coverage = detail.get('period', {})
    if coverage.get('start') != month['id'] + '-01':
        return None
    through = date.fromisoformat(coverage['end'])
    end = today - timedelta(days=today.weekday() + 1)
    if end.strftime('%Y-%m') != month['id'] or through < end:
        return None
    table = detail.get('table', {})
    columns = table.get('columns', [])
    fields = ['cost', 'clicks', 'conversions', 'impressions']
    if not all(k in columns for k in ['d', 'campaign'] + fields):
        return None
    names = table.get('campaigns', [])
    groups = {name: {} for name in names}
    for values in table.get('rows', []):
        row = dict(zip(columns, values))
        day, index = row['d'], row['campaign']
        if not isinstance(index, int) or not 0 <= index < len(names) or not isinstance(day, int) or not 1 <= day <= through.day:
            return None
        group = groups[names[index]]
        if day in group or any(not isinstance(row[f], (float, int)) or not math.isfinite(row[f]) or row[f] < 0 for f in fields):
            return None
        group[day] = row
    if not groups or any(set(days) != set(range(1, through.day + 1)) for days in groups.values()):
        return None
    # An active monthly campaign absent from the capture would silently lose metrics.
    if any(r['campaign'] not in groups and any(r.get(f, 0) for f in fields) for r in month.get('records', [])):
        return None
    result = deepcopy(month)
    originals = {r['campaign']: r for r in result.get('records', [])}
    records = []
    for name, days in groups.items():
        record = originals.get(name, {'campaign': name, 'type': 'Buscar'})
        for key in list(record):
            if key.endswith('Delta'):
                del record[key]
        for field in fields:
            record[field] = sum(row[field] for d, row in days.items() if d <= end.day)
        record['cpc'] = record['cost'] / record['clicks'] if record['clicks'] else None
        record['ctr'] = record['clicks'] / record['impressions'] if record['impressions'] else None
        record['costPerConversion'] = record['cost'] / record['conversions'] if record['conversions'] else None
        records.append(record)
    result['records'] = records
    result['totals'] = {f: sum(r[f] for r in records) for f in fields}
    result['totals']['cost'] = round(result['totals']['cost'], 2)
    result['totals']['ctr'] = result['totals']['clicks'] / result['totals']['impressions'] if result['totals']['impressions'] else None
    result['totals']['costPerConversion'] = result['totals']['cost'] / result['totals']['conversions'] if result['totals']['conversions'] else None
    result['period'] = {'start': month['id'] + '-01', 'end': end.isoformat()}
    result['detail']['table']['rows'] = [r for r in table['rows'] if r[columns.index('d')] <= end.day]
    result['detail']['period'] = result['period'].copy()
    result['sourceFile'] = detail.get('sourceFile')
    return result


def capture(data, keywords, archive, today=None):
    today = today or datetime.now(ZoneInfo('America/Lima')).date()
    saved = {entry['month']['period']['end']: entry for entry in archive.get('snapshots', [])}
    keyword_months = {month['id']: month for month in keywords.get('months', [])}
    for month in data.get('months', []):
        month = daily_cutoff(month, today) or month
        period = month.get('period', {})
        end = period.get('end', '')
        if not end or period.get('start') != month['id'] + '-01' or date.fromisoformat(end).weekday() != 6:
            continue
        previous = saved.get(end)
        # No cambiar la hora si solo se sincronizaron archivos de otros meses.
        kw = keyword_months.get(month['id'])
        if kw and kw.get('period') != period:
            kw = None
        if kw is None and previous:
            kw = previous.get('keywords')
        if previous and previous['month'] == month and previous.get('keywords') == kw:
            continue
        saved[end] = {'month': month, 'keywords': kw, 'capturedAt': data.get('drive', {}).get('lastSync')}
    return {'snapshots': [saved[key] for key in sorted(saved)]}


if __name__ == '__main__':
    target = ROOT / 'data/report-snapshots.json'
    archive = json.loads(target.read_text(encoding='utf-8')) if target.exists() else {'snapshots': []}
    updated = capture(json.loads((ROOT / 'data/aquarius-lima-retail-2026.json').read_text(encoding='utf-8')),
                      json.loads((ROOT / 'data/aquarius-palabras-clave-2026.json').read_text(encoding='utf-8')), archive)
    changed = updated != archive
    if changed:
        target.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
            output.write(f'changed={str(changed).lower()}\n')
    print(f'[report-snapshot] {len(updated["snapshots"])} cortes guardados; cambios: {changed}')
