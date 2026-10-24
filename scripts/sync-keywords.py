#!/usr/bin/env python3
"""Sincroniza el informe de palabras clave de Aquarius desde Google Drive.

La carpeta "Google Ads Aquarius Keywords" guarda una hoja de calculo por mes con el
informe de palabras clave de busqueda de Google Ads (Aquarius KW <mes> <ano>). Este
script exporta cada hoja como CSV, la normaliza y actualiza
data/aquarius-palabras-clave-2026.json. Tambien acepta CSV sueltos en la carpeta.

Descubrimiento de archivos, en el mismo orden que scripts/sync-drive.py:

1. Apps Script de Aquarius, si hay AQ_DRIVE_SCRIPT_URL y AQ_DRIVE_READ_KEY (las
   carpetas son privadas).
2. API de Drive, si hay API key (AQ_DRIVE_API_KEY, GOOGLE_API_KEY o apiKey en
   data/drive-config.json).
3. Vista publica de la carpeta, solo si sigue compartida por enlace.
4. data/keywords-manifest.json, la ultima lista conocida de archivos.

Uso:

    python scripts/sync-keywords.py            # sincroniza
    python scripts/sync-keywords.py --check    # solo informa si hay cambios
    python scripts/sync-keywords.py --file "Aquarius KW octubre 2026.csv"
    python scripts/sync-keywords.py --file "...csv" --force   # importa aunque no cuadre

Google Ads exporta con el formato del idioma de la cuenta ("6,79" o "6.79"): cada informe se
lee segun el suyo. Si el costo de las palabras clave de un mes supera al de sus campanas, el
informe no se importa (o, al sincronizar, no pisa lo que ya habia) y queda un aviso.
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import io
import json
import re
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

# Los helpers de Drive y del parser (normalize, numeros, meses, fetch) son los mismos
# del gasto publicitario. El archivo lleva guion, asi que se carga por ruta.
_spec = importlib.util.spec_from_file_location("sync_drive", Path(__file__).with_name("sync-drive.py"))
drive = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(drive)

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "aquarius-palabras-clave-2026.json"
MANIFEST = ROOT / "data" / "keywords-manifest.json"
BACKUPS = ROOT / "data" / "csv-backups" / "keywords"

# Encabezados del informe de palabras clave -> campo interno. CTR, CPC, tasa y costo
# por conversion no se guardan: el tablero los calcula de estas sumas, asi que
# cuadran al agrupar por campana o por mes.
COLUMNS = {
    "palabra clave": ("keyword", "text"),
    "tipo de concordancia": ("matchType", "text"),
    "campana": ("campaign", "text"),
    "grupo de anuncios": ("adGroup", "text"),
    "estado de palabras clave": ("state", "text"),
    "estado": ("status", "text"),
    "motivos del estado": ("reasons", "text"),
    "impr.": ("impressions", "count"),
    "impr": ("impressions", "count"),
    "impresiones": ("impressions", "count"),
    "clics": ("clicks", "count"),
    "costo": ("cost", "number"),
    "coste": ("cost", "number"),
    "conversiones": ("conversions", "number"),
    "conv.": ("conversions", "number"),
    "% impr. parte sup. busqueda": ("topShare", "share"),
    "% impr. perdidas de la busqueda (ranking)": ("lostRank", "share"),
}
NUMERIC = ("impressions", "clicks", "cost", "conversions")


def parse_share(value):
    """Las cuotas de impresiones vienen acotadas ("< 10%", "> 90%"): se guardan tal cual."""
    text = str(value or "").strip()
    return None if text in {"", "--", "-"} else text


def parse_count(value, comma=False):
    """Enteros con separador de miles.

    En formato ingles, al pasar el CSV a hoja de calculo Sheets leyo "1,290" como 1.29 y lo
    exporta "1,29": se pierden los ceros finales. El grupo despues de la coma siempre tiene
    tres digitos, asi que se completa con ceros ("1,29" -> 1290, "1,2" -> 1200). En formato
    espanol los miles van con punto ("1.290") y no hay nada que completar.
    """
    text = str(value or "").strip()
    if comma:
        return drive.parse_int(text, True)
    match = re.fullmatch(r"(\d{1,3}(?:,\d{3})*),(\d{1,2})", text)
    if match:
        text = f"{match.group(1)},{match.group(2).ljust(3, '0')}"
    return drive.parse_int(text)


PARSERS = dict(drive.PARSERS, share=lambda value, comma=False: parse_share(value), count=parse_count)

# Coste y porcentajes con decimales: "6,79" y "15,15%" (espanol) o "6.79" y "15.15%" (ingles).
ES_DECIMAL = re.compile(r"^-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}%?$")
EN_DECIMAL = re.compile(r"^-?(?:\d+|\d{1,3}(?:,\d{3})+)\.\d{1,2}%?$")


def uses_decimal_comma(rows, cost_position):
    """True si el informe viene en formato espanol (coma decimal).

    Google Ads exporta con el formato del idioma de la cuenta y una hoja de Sheets con el de
    su configuracion regional. Se decide por la columna Coste y las de porcentaje, que siempre
    traen decimales: los conteos no sirven, porque en ingles Sheets los deja como "1,29".
    """
    es = en = 0
    for row in rows:
        for position, cell in enumerate(row):
            text = cell.strip()
            if position != cost_position and not text.endswith("%"):
                continue
            if ES_DECIMAL.match(text):
                es += 1
            elif EN_DECIMAL.match(text):
                en += 1
    return es > en


def parse_keyword_report(text, name):
    """Normaliza el informe de palabras clave de busqueda de Google Ads."""
    rows = list(csv.reader(io.StringIO(text)))
    header_index = None
    for index, row in enumerate(rows[:12]):
        plain = [drive.normalize(cell) for cell in row]
        if "palabra clave" in plain and "campana" in plain:
            header_index = index
            break
    if header_index is None:
        return None, [], None

    month_id = None
    period = None
    for row in rows[:header_index]:
        month_id = month_id or drive.month_from_text(" ".join(row))
        period = period or drive.period_from_text(" ".join(row))
    month_id = month_id or drive.month_from_text(name)

    columns = {}
    for position, cell in enumerate(rows[header_index]):
        mapped = COLUMNS.get(drive.normalize(cell))
        if mapped and mapped[0] not in columns:
            columns[mapped[0]] = (position, mapped[1])

    comma = uses_decimal_comma(rows[header_index + 1:], columns.get("cost", (None,))[0])
    keywords = []
    for row in rows[header_index + 1:]:
        if not row or not any(cell.strip() for cell in row):
            continue
        # Las filas "Total: ..." resumen la cuenta, no una palabra clave.
        if drive.normalize(row[0]).startswith("total"):
            continue
        entry = {}
        for field, (position, kind) in columns.items():
            raw = row[position] if position < len(row) else None
            value = str(raw or "").strip() if kind == "text" else PARSERS[kind](raw, comma)
            if value not in (None, ""):
                entry[field] = value
        if not entry.get("keyword") or not entry.get("campaign"):
            continue
        for field in NUMERIC:
            entry.setdefault(field, 0)
        keywords.append(entry)
    return month_id, keywords, period


def drop_excluded(keywords, name):
    """Quita las campanas de keywords.excludeCampaigns (por ejemplo, una creada en un hackeo de la cuenta)."""
    excluded = {drive.normalize(campaign) for campaign in
                (drive.load_config().get("keywords") or {}).get("excludeCampaigns", [])}
    kept = [entry for entry in keywords if drive.normalize(entry["campaign"]) not in excluded]
    if len(kept) < len(keywords):
        print(f"[sync-keywords] {name}: excluyo {len(keywords) - len(kept)} filas de campanas excluidas.")
    return kept


CAMPAIGNS = ROOT / "data" / "aquarius-lima-retail-2026.json"
# Las palabras clave son parte del gasto de sus campanas: su costo no puede pasar del de las
# campanas del mes. El margen cubre un informe de palabras clave que llega uno o dos dias mas lejos.
MAX_COST_RATIO = 1.2


def cost_mismatch(month_id, keywords, name):
    """Texto del aviso si el costo de las palabras clave no cuadra con el de las campanas del mes.

    Es el control del formato: un informe leido con los decimales corridos ("6,79" como 679)
    multiplica el costo por cien. Sin informe de campanas de ese mes no hay contra que comparar.
    """
    if not CAMPAIGNS.exists():
        return None
    month = next((item for item in json.loads(CAMPAIGNS.read_text(encoding="utf-8")).get("months", [])
                  if item.get("id") == month_id), None)
    if not month:
        return None
    totals = month.get("totals") or {}
    campaign_cost = totals.get("cost")
    if not isinstance(campaign_cost, (int, float)):
        campaign_cost = sum(float(record.get("cost") or 0) for record in month.get("records") or [])
    keyword_cost = sum(float(entry.get("cost") or 0) for entry in keywords)
    if campaign_cost <= 0 or keyword_cost <= campaign_cost * MAX_COST_RATIO:
        return None
    return (f"{name}: el costo de las palabras clave (S/ {keyword_cost:,.2f}) supera al de las campanas de "
            f"{drive.month_label(month_id)} (S/ {campaign_cost:,.2f}). Revisa el formato de los numeros del "
            "informe (coma o punto decimal) antes de importarlo.")


def warn(message):
    """Aviso en consola y, en GitHub Actions, como anotacion del workflow."""
    print(f"[sync-keywords] AVISO: {message}")
    print(f"::warning::{message}")


def load_document():
    if DATA.exists():
        document = json.loads(DATA.read_text(encoding="utf-8"))
        if isinstance(document.get("months"), list):
            return document
    return {
        "brand": "Aquarius",
        "dashboard": "Analisis de Palabras Clave",
        "schemaVersion": 1,
        "status": "ok",
        "defaultMonth": None,
        "months": [],
    }


def store_report(months, month_id, keywords, period, source_name, file_id=None):
    """Guarda un informe ya normalizado en su mes y reemplaza lo que hubiera de ese mes."""
    month = months.setdefault(month_id, {"id": month_id})
    month["label"] = drive.month_label(month_id)
    month["sourceFile"] = source_name
    if file_id:
        month["driveFileId"] = file_id
    else:
        month.pop("driveFileId", None)
    if period:
        month["period"] = period
    else:
        month.pop("period", None)
    month["keywords"] = keywords


def finish_document(document, months):
    document["months"] = sorted(months.values(), key=lambda month: month["id"])
    document["defaultMonth"] = document["months"][-1]["id"] if document["months"] else None
    document["schemaVersion"] = 1
    document["status"] = "ok"


def list_files(folder_id):
    """Mismo orden que sync-drive.py, con el manifiesto propio de palabras clave."""
    reader = drive.script_reader()
    if reader:
        try:
            files = drive.list_with_script(folder_id, reader)
            if files:
                return files, "apps script"
        except (urllib.error.URLError, json.JSONDecodeError, KeyError, ValueError) as error:
            print(f"[sync-keywords] el Apps Script no entrego la carpeta ({error}); pruebo las otras vias.")
    key = drive.api_key()
    if key:
        try:
            files = drive.list_with_api(folder_id, key)
            if files:
                return files, "api"
        except (urllib.error.URLError, json.JSONDecodeError, KeyError) as error:
            print(f"[sync-keywords] la API de Drive fallo ({error}); uso la vista publica.")
    try:
        files = drive.list_with_public_view(folder_id)
        if files:
            return files, "publica"
    except urllib.error.URLError as error:
        print(f"[sync-keywords] no se pudo leer la carpeta publica ({error}).")
    if MANIFEST.exists():
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        return manifest.get("files", []), "manifiesto"
    return [], "sin fuente"


def is_report(item):
    """Hojas de calculo de Google (sin extension) o CSV; el resto de la carpeta se ignora."""
    suffix = Path(item["name"]).suffix.lower()
    return suffix == ".csv" or suffix == ""


def download(item):
    """Exporta la hoja como CSV (o baja el CSV). Devuelve None si Drive no lo entrega."""
    file_id = item["id"]
    text = drive.script_csv(file_id)
    if text is not None:
        return text
    key = drive.api_key()
    if item["name"].lower().endswith(".csv"):
        urls = [f"https://drive.google.com/uc?export=download&id={file_id}",
                f"https://drive.usercontent.google.com/download?id={file_id}&export=download"]
        if key:
            urls.insert(0, f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media&key={key}")
    else:
        urls = [f"https://docs.google.com/spreadsheets/d/{file_id}/export?format=csv"]
        if key:
            urls.insert(0, f"https://www.googleapis.com/drive/v3/files/{file_id}/export?mimeType=text/csv&key={key}")
    last_error = None
    for url in urls:
        try:
            return drive.fetch(url).decode("utf-8-sig", "replace")
        except urllib.error.URLError as error:
            last_error = error
    print(f"[sync-keywords] no se pudo descargar {item['name']}: {last_error}")
    return None


def backup_name(name):
    return name if name.lower().endswith(".csv") else f"{name}.csv"


def import_file(path, check, force=False):
    """Carga un informe de palabras clave local; la proxima sincronizacion lo reemplaza si Drive trae el mes."""
    text = path.read_text(encoding="utf-8-sig")
    month_id, keywords, period = parse_keyword_report(text, path.name)
    if not month_id or not keywords:
        print(f"[sync-keywords] {path.name} no parece un informe de palabras clave.")
        return 1
    keywords = drop_excluded(keywords, path.name)
    mismatch = cost_mismatch(month_id, keywords, path.name)
    if mismatch and not force:
        warn(f"{mismatch} No se importa; con --force se importa igual.")
        return 1
    document = load_document()
    before = drive.comparable(document)
    months = {month["id"]: month for month in document["months"]}
    store_report(months, month_id, keywords, period, path.name)
    finish_document(document, months)
    changed = drive.comparable(document) != before
    if check:
        print("[sync-keywords] hay cambios." if changed else "[sync-keywords] sin cambios.")
        return 0
    BACKUPS.mkdir(parents=True, exist_ok=True)
    (BACKUPS / backup_name(path.name)).write_text(text, encoding="utf-8")
    DATA.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[sync-keywords] {drive.month_label(month_id)}: {len(keywords)} palabras clave desde {path.name}")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Sincroniza el informe de palabras clave desde Google Drive.")
    parser.add_argument("--check", action="store_true", help="Informa si hay cambios sin escribir el JSON")
    parser.add_argument("--folder", help="ID de la carpeta de Drive")
    parser.add_argument("--file", type=Path, help="Importa un informe de palabras clave local en vez de leer Drive")
    parser.add_argument("--force", action="store_true",
                        help="Importa aunque el costo de las palabras clave no cuadre con el de las campanas")
    args = parser.parse_args()

    if args.file:
        return import_file(args.file, args.check, args.force)

    config = drive.load_config().get("keywords") or {}
    folder_id = args.folder or config.get("folderId")
    if not folder_id:
        print("[sync-keywords] falta keywords.folderId en data/drive-config.json")
        return 1

    files, origin = list_files(folder_id)
    reports = [item for item in files if is_report(item)]
    if not reports:
        print(f"[sync-keywords] la carpeta no devolvio informes (origen: {origin}).")
        return 1
    print(f"[sync-keywords] {len(reports)} archivos en la carpeta (origen: {origin}).")

    document = load_document()
    before = drive.comparable(document)
    months = {month["id"]: month for month in document["months"]}
    BACKUPS.mkdir(parents=True, exist_ok=True)

    loaded = []
    for item in sorted(reports, key=lambda entry: entry["name"]):
        text = download(item)
        if text is None:
            continue
        month_id, keywords, period = parse_keyword_report(text, item["name"])
        if not month_id or not keywords:
            print(f"[sync-keywords] omito {item['name']}: no parece un informe de palabras clave.")
            continue
        keywords = drop_excluded(keywords, item["name"])
        # Un informe que no cuadra con el gasto de las campanas no pisa lo que ya habia de ese mes.
        mismatch = cost_mismatch(month_id, keywords, item["name"])
        if mismatch and not args.force:
            warn(f"{mismatch} Se mantiene lo que ya habia de ese mes.")
            continue
        store_report(months, month_id, keywords, period, item["name"], item["id"])
        (BACKUPS / backup_name(item["name"])).write_text(text, encoding="utf-8")
        loaded.append(item)
        print(f"[sync-keywords] {drive.month_label(month_id)}: {len(keywords)} palabras clave")

    if not loaded:
        print("[sync-keywords] ningun archivo trajo el informe de palabras clave.")
        return 1

    finish_document(document, months)
    changed = drive.comparable(document) != before
    # El navegador vuelve a pedir estas hojas con el boton Actualizar, sin API key.
    document["drive"] = {
        "folderId": folder_id,
        "discovery": origin,
        "lastSync": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "files": [{"id": item["id"], "name": item["name"], "modifiedTime": item.get("modifiedTime")}
                  for item in loaded],
    }

    if args.check:
        print("[sync-keywords] hay cambios." if changed else "[sync-keywords] sin cambios.")
        return 0

    MANIFEST.write_text(json.dumps({"folderId": folder_id, "files": loaded}, ensure_ascii=False, indent=2),
                        encoding="utf-8")
    DATA.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[sync-keywords] {'data actualizada' if changed else 'data sin cambios'}: {DATA}")
    drive.report_to_actions(changed)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
