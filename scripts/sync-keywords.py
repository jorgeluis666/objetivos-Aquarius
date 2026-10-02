#!/usr/bin/env python3
"""Sincroniza el informe de palabras clave de Aquarius desde Google Drive.

La carpeta "Google Ads Aquarius Keywords" guarda una hoja de calculo por mes con el
informe de palabras clave de busqueda de Google Ads (Aquarius KW <mes> <ano>). Este
script exporta cada hoja como CSV, la normaliza y actualiza
data/aquarius-palabras-clave-2026.json. Tambien acepta CSV sueltos en la carpeta.

Descubrimiento de archivos, en el mismo orden que scripts/sync-drive.py:

1. API de Drive, si hay API key (AQ_DRIVE_API_KEY, GOOGLE_API_KEY o apiKey en
   data/drive-config.json).
2. Vista publica de la carpeta, que no necesita credenciales mientras siga
   compartida por enlace.
3. data/keywords-manifest.json, la ultima lista conocida de archivos.

Uso:

    python scripts/sync-keywords.py            # sincroniza
    python scripts/sync-keywords.py --check    # solo informa si hay cambios
    python scripts/sync-keywords.py --file "Aquarius KW octubre 2026.csv"
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


def parse_count(value):
    """Enteros con separador de miles.

    Al pasar el CSV a hoja de calculo, Sheets leyo "1,290" como 1.29 y lo exporta "1,29":
    se pierden los ceros finales. El grupo despues de la coma siempre tiene tres digitos,
    asi que se completa con ceros ("1,29" -> 1290, "1,2" -> 1200).
    """
    text = str(value or "").strip()
    match = re.fullmatch(r"(\d{1,3}(?:,\d{3})*),(\d{1,2})", text)
    if match:
        text = f"{match.group(1)},{match.group(2).ljust(3, '0')}"
    return drive.parse_int(text)


PARSERS = dict(drive.PARSERS, share=parse_share, count=parse_count)


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
            value = str(raw or "").strip() if kind == "text" else PARSERS[kind](raw)
            if value not in (None, ""):
                entry[field] = value
        if not entry.get("keyword") or not entry.get("campaign"):
            continue
        for field in NUMERIC:
            entry.setdefault(field, 0)
        keywords.append(entry)
    return month_id, keywords, period


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
    key = drive.api_key()
    file_id = item["id"]
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


def import_file(path, check):
    """Carga un informe de palabras clave local; la proxima sincronizacion lo reemplaza si Drive trae el mes."""
    text = path.read_text(encoding="utf-8-sig")
    month_id, keywords, period = parse_keyword_report(text, path.name)
    if not month_id or not keywords:
        print(f"[sync-keywords] {path.name} no parece un informe de palabras clave.")
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
    args = parser.parse_args()

    if args.file:
        return import_file(args.file, args.check)

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
