#!/usr/bin/env python3
"""Sincroniza el gasto publicitario de Aquarius desde la carpeta de Google Drive.

La carpeta guarda un CSV por mes con el informe de campana de Google Ads
(Aquarius <mes> <ano>.csv). Este script los descarga, los normaliza y actualiza
data/aquarius-lima-retail-2026.json sin tocar las series diarias ya cargadas.

Descubrimiento de archivos, en orden:

1. API de Drive, si hay API key (AQ_DRIVE_API_KEY, GOOGLE_API_KEY o apiKey en
   data/drive-config.json).
2. Vista publica de la carpeta, que no necesita credenciales mientras siga
   compartida por enlace.
3. data/drive-manifest.json, la ultima lista conocida de archivos.

Uso:

    python scripts/sync-drive.py            # sincroniza
    python scripts/sync-drive.py --check    # solo informa si hay cambios
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "aquarius-lima-retail-2026.json"
CONFIG = ROOT / "data" / "drive-config.json"
MANIFEST = ROOT / "data" / "drive-manifest.json"
BACKUPS = ROOT / "data" / "csv-backups" / "drive"

TIMEOUT = 45
USER_AGENT = "aquarius-dashboard-sync/1.0"

MONTH_NAMES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre",
]
MONTH_BY_NAME = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "setiembre": 9, "septiembre": 9, "octubre": 10,
    "noviembre": 11, "diciembre": 12,
}

# Encabezados del informe de campana -> campo interno. La columna se busca por
# nombre, asi que el orden del export puede cambiar sin romper la importacion.
COLUMNS = {
    "campana": ("campaign", "text"),
    "costo": ("cost", "number"),
    "coste": ("cost", "number"),
    "impr.": ("impressions", "int"),
    "impr": ("impressions", "int"),
    "impresiones": ("impressions", "int"),
    "clics": ("clicks", "int"),
    "prom. cpc": ("cpc", "number"),
    "ctr": ("ctr", "percent"),
    "conversiones": ("conversions", "number"),
    "conv.": ("conversions", "number"),
    "costo/conv.": ("costPerConversion", "number"),
    "coste/conv.": ("costPerConversion", "number"),
}
DELTA_FIELDS = {
    "cost": "costDelta",
    "ctr": "ctrDelta",
    "clicks": "clicksDelta",
    "conversions": "conversionsDelta",
    "costPerConversion": "costPerConversionDelta",
    "impressions": "impressionsDelta",
}


def normalize(text):
    value = str(text or "").strip().lower()
    return re.sub(r"\s+", " ", value.translate(str.maketrans("\u00e1\u00e9\u00ed\u00f3\u00fa\u00fc\u00f1", "aeiouun")))


def parse_number(value):
    text = str(value or "").strip()
    if not text or text in {"--", "-"} or text.startswith("<"):
        return None
    cleaned = re.sub(r"[^\d,.\-]", "", text).replace(",", "")
    if not cleaned or cleaned in {"-", ".", "-."}:
        return None
    try:
        number = float(cleaned)
    except ValueError:
        return None
    return int(number) if number.is_integer() else number


def parse_percent(value):
    number = parse_number(value)
    return None if number is None else number / 100


def parse_int(value):
    number = parse_number(value)
    return None if number is None else int(round(number))


PARSERS = {"number": parse_number, "int": parse_int, "percent": parse_percent}


def month_label(month_id):
    year, month = month_id.split("-")
    return f"{MONTH_NAMES[int(month) - 1]} {year}"


def month_from_text(text):
    """Lee 1 de agosto de 2026 - 31 de agosto de 2026, o Aquarius agosto 2026."""
    plain = normalize(text)
    match = re.search(r"([a-z]+)\s+(?:de\s+)?(\d{4})", plain)
    if match and match.group(1) in MONTH_BY_NAME:
        return f"{int(match.group(2)):04d}-{MONTH_BY_NAME[match.group(1)]:02d}"
    match = re.search(r"(\d{4})[-_.](\d{2})", plain)
    if match:
        return f"{match.group(1)}-{match.group(2)}"
    return None


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return response.read()


def load_config():
    if CONFIG.exists():
        try:
            return json.loads(CONFIG.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {}


def api_key():
    for name in ("AQ_DRIVE_API_KEY", "GOOGLE_API_KEY"):
        if os.environ.get(name):
            return os.environ[name].strip()
    return str(load_config().get("apiKey") or "").strip()


def list_with_api(folder_id, key):
    query = urllib.parse.urlencode({
        "q": f"'{folder_id}' in parents and trashed = false",
        "key": key,
        "fields": "files(id,name,modifiedTime,mimeType)",
        "pageSize": "200",
    })
    payload = json.loads(fetch(f"https://www.googleapis.com/drive/v3/files?{query}"))
    return [
        {"id": item["id"], "name": item["name"], "modifiedTime": item.get("modifiedTime")}
        for item in payload.get("files", [])
    ]


def list_with_public_view(folder_id):
    """Lee la vista publica de la carpeta. No necesita credenciales."""
    html = fetch(f"https://drive.google.com/embeddedfolderview?id={folder_id}#list").decode("utf-8", "replace")
    pattern = re.compile(r"id=\"entry-([-\w]{20,})\".*?flip-entry-title\">([^<]+)<", re.S)
    return [{"id": found.group(1), "name": found.group(2).strip(), "modifiedTime": None}
            for found in pattern.finditer(html)]


def list_files(folder_id):
    key = api_key()
    if key:
        try:
            files = list_with_api(folder_id, key)
            if files:
                return files, "api"
        except (urllib.error.URLError, json.JSONDecodeError, KeyError) as error:
            print(f"[sync-drive] la API de Drive fallo ({error}); uso la vista publica.")
    try:
        files = list_with_public_view(folder_id)
        if files:
            return files, "publica"
    except urllib.error.URLError as error:
        print(f"[sync-drive] no se pudo leer la carpeta publica ({error}).")
    if MANIFEST.exists():
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        return manifest.get("files", []), "manifiesto"
    return [], "sin fuente"


def download(file_id, name):
    key = api_key()
    urls = []
    if key:
        urls.append(f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media&key={key}")
    urls.append(f"https://drive.google.com/uc?export=download&id={file_id}")
    urls.append(f"https://drive.usercontent.google.com/download?id={file_id}&export=download")
    last_error = None
    for url in urls:
        try:
            return fetch(url).decode("utf-8-sig", "replace")
        except urllib.error.URLError as error:
            last_error = error
    raise SystemExit(f"[sync-drive] no se pudo descargar {name}: {last_error}")


def parse_campaign_report(text, name):
    """Normaliza el informe de campana de Google Ads."""
    rows = list(csv.reader(io.StringIO(text)))
    header_index = None
    for index, row in enumerate(rows[:12]):
        plain = [normalize(cell) for cell in row]
        if "campana" in plain and any(cell in {"costo", "coste"} for cell in plain):
            header_index = index
            break
    if header_index is None:
        return None, [], {}

    month_id = None
    for row in rows[:header_index]:
        month_id = month_id or month_from_text(" ".join(row))
    month_id = month_id or month_from_text(name)

    columns = {}
    for position, cell in enumerate(rows[header_index]):
        mapped = COLUMNS.get(normalize(cell))
        if mapped and mapped[0] not in columns:
            columns[mapped[0]] = (position, mapped[1])

    records = []
    totals = {}
    total_fields = ("cost", "impressions", "clicks", "ctr", "conversions", "costPerConversion")
    for row in rows[header_index + 1:]:
        if not row or not any(cell.strip() for cell in row):
            continue
        first = normalize(row[0])
        entry = {}
        for field, (position, kind) in columns.items():
            raw = row[position] if position < len(row) else None
            entry[field] = str(raw or "").strip() if kind == "text" else PARSERS[kind](raw)
        if first.startswith("total"):
            # Total: Campanas filtradas trae los totales del mes ya calculados.
            if first.startswith("total: campanas") or not totals:
                totals = {field: entry.get(field) for field in total_fields}
            continue
        if entry.get("campaign"):
            records.append(entry)
    return month_id, records, totals


def apply_deltas(months):
    """Calcula el porcentaje de variacion de cada campana contra el mes anterior."""
    previous = {}
    for month in sorted(months, key=lambda item: item["id"]):
        current = {}
        for record in month.get("records", []):
            before = previous.get(record["campaign"])
            for field, delta_field in DELTA_FIELDS.items():
                value = record.get(field)
                old = (before or {}).get(field)
                if before is None or old in (None, 0) or value is None:
                    record[delta_field] = None
                else:
                    record[delta_field] = value / old - 1
            current[record["campaign"]] = record
        previous = current


def load_document():
    if DATA.exists():
        document = json.loads(DATA.read_text(encoding="utf-8"))
        if isinstance(document.get("months"), list):
            return document
    return {
        "brand": "Aquarius",
        "dashboard": "Gasto Publicitario",
        "moduleSubtitle": "Branding y ventas",
        "schemaVersion": 3,
        "status": "ok",
        "defaultMonth": None,
        "months": [],
    }


def mirror_legacy_month(document):
    """Copia el mes por defecto a la raiz, por compatibilidad con builds viejos."""
    default = next((month for month in document["months"] if month["id"] == document.get("defaultMonth")), None)
    if not default:
        document.pop("records", None)
        return
    document["month"] = default["id"]
    document["sourceFile"] = default.get("sourceFile")
    document["receivedHeaders"] = default.get("receivedHeaders", [])
    document["records"] = default.get("records", [])


def comparable(document):
    """El JSON sin la marca de tiempo: sirve para saber si la data cambio."""
    return json.dumps({key: value for key, value in document.items() if key != "drive"},
                      ensure_ascii=False, sort_keys=True)


def main():
    parser = argparse.ArgumentParser(description="Sincroniza el gasto publicitario desde Google Drive.")
    parser.add_argument("--check", action="store_true", help="Informa si hay cambios sin escribir el JSON")
    parser.add_argument("--folder", help="ID de la carpeta de Drive")
    args = parser.parse_args()

    config = load_config()
    folder_id = args.folder or config.get("folderId")
    if not folder_id:
        print("[sync-drive] falta folderId en data/drive-config.json")
        return 1

    files, origin = list_files(folder_id)
    csv_files = [item for item in files if item["name"].lower().endswith(".csv")]
    if not csv_files:
        print(f"[sync-drive] la carpeta no devolvio CSV (origen: {origin}).")
        return 1
    print(f"[sync-drive] {len(csv_files)} CSV en la carpeta (origen: {origin}).")

    document = load_document()
    before = comparable(document)
    months = {month["id"]: month for month in document["months"]}
    BACKUPS.mkdir(parents=True, exist_ok=True)

    for item in sorted(csv_files, key=lambda entry: entry["name"]):
        text = download(item["id"], item["name"])
        month_id, records, totals = parse_campaign_report(text, item["name"])
        if not month_id or not records:
            print(f"[sync-drive] omito {item['name']}: no parece un informe de campana.")
            continue
        month = months.setdefault(month_id, {"id": month_id, "label": month_label(month_id), "records": []})
        month["label"] = month.get("label") or month_label(month_id)
        month["sourceFile"] = item["name"]
        month["driveFileId"] = item["id"]
        month["records"] = records
        if totals:
            month["totals"] = totals
        (BACKUPS / item["name"]).write_text(text, encoding="utf-8")
        print(f"[sync-drive] {month_label(month_id)}: {len(records)} campanas")

    document["months"] = sorted(months.values(), key=lambda month: month["id"])
    apply_deltas(document["months"])
    document["defaultMonth"] = document["months"][-1]["id"] if document["months"] else None
    document["schemaVersion"] = 3
    document["status"] = "ok"
    mirror_legacy_month(document)
    changed = comparable(document) != before
    document["drive"] = {
        "folderId": folder_id,
        "discovery": origin,
        "lastSync": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "files": [{"id": item["id"], "name": item["name"], "modifiedTime": item.get("modifiedTime")}
                  for item in csv_files],
    }

    if args.check:
        print("[sync-drive] hay cambios." if changed else "[sync-drive] sin cambios.")
        return 0

    MANIFEST.write_text(json.dumps({"folderId": folder_id, "files": csv_files}, ensure_ascii=False, indent=2),
                        encoding="utf-8")
    DATA.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[sync-drive] {'data actualizada' if changed else 'data sin cambios'}: {DATA}")
    report_to_actions(changed)
    return 0


def report_to_actions(changed):
    """En GitHub Actions deja changed como salida del paso."""
    output = os.environ.get("GITHUB_OUTPUT")
    if not output:
        return
    with open(output, "a", encoding="utf-8") as handle:
        handle.write("changed=" + ("true" if changed else "false") + chr(10))


if __name__ == "__main__":
    raise SystemExit(main())
