"""Retiene el ultimo informe disponible de cada domingo, con su hora de captura."""
import json
import os
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def capture(data, keywords, archive):
    saved = {entry['month']['period']['end']: entry for entry in archive.get('snapshots', [])}
    keyword_months = {month['id']: month for month in keywords.get('months', [])}
    for month in data.get('months', []):
        period = month.get('period', {})
        end = period.get('end', '')
        if not end or period.get('start') != month['id'] + '-01' or date.fromisoformat(end).weekday() != 6:
            continue
        previous = saved.get(end)
        # No cambiar la hora si solo se sincronizaron archivos de otros meses.
        kw = keyword_months.get(month['id'])
        if kw and kw.get('period') != period:
            kw = None
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
