"""Regression: inactive removed duplicates must not discard an entire month."""
import importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location('sync_drive', Path(__file__).with_name('sync-drive.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
header = 'Informe de campaña\n1 de octubre de 2026 - 24 de octubre de 2026\nEstado de la campaña,Campaña,Presupuesto,Tipo de presupuesto,Costo,Impr.,Clics,Conversiones\n'
rows = 'Eliminada,Duplicada,0,Diariamente,0,0,0,0\nHabilitada,Duplicada,30,Diariamente,"123,45",100,10,2\n'
result = module.parse_campaign_report(header + rows, 'Octubre 2026')
assert result[0] and len(result[1]) == 1
assert result[1][0]['cost'] == 123.45
assert result[3]['dailyBudget'] == 30
# An ambiguous duplicate with historical activity must still be rejected.
result = module.parse_campaign_report(header + rows.replace('0,0,0,0\n', '1,1,1,1\n'), 'Octubre 2026')
assert result[0] is None
# Removed campaigns with real activity and unique names must not lose their data.
result = module.parse_campaign_report(header + 'Eliminada,Anterior,0,Diariamente,"10,00",5,1,1\n', 'Octubre 2026')
assert result[0] and result[1][0]['cost'] == 10
print('OK: inactive removed duplicates skipped; real activity and ambiguity guard preserved.')
