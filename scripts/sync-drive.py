#!/usr/bin/env python3
"""Sincroniza el gasto publicitario de Aquarius desde la carpeta de Google Drive.

La carpeta guarda un informe de campana de Google Ads por mes, como hoja de
calculo de Google (Aquarius GA - <mes> <ano>) o como CSV. Este script los
descarga (las hojas se exportan a CSV), los normaliza y actualiza
data/aquarius-lima-retail-2026.json sin tocar las series diarias ya cargadas.
Lee los numeros en formato espanol (99,46 y 1.894) o ingles (99.46 y 1,894).

Descubrimiento de archivos, en orden:

1. Apps Script de Aquarius (scripts/apps-script/sincronizar-aquarius.gs), si hay
   AQ_DRIVE_SCRIPT_URL y AQ_DRIVE_READ_KEY: lee las carpetas privadas con la
   cuenta duena y devuelve cada hoja ya exportada como CSV.
2. API de Drive, si hay API key (AQ_DRIVE_API_KEY, GOOGLE_API_KEY o apiKey en
   data/drive-config.json).
3. Vista publica de la carpeta, solo si sigue compartida por enlace.
4. data/drive-manifest.json, la ultima lista conocida de archivos.

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
    "cpc medio": ("cpc", "number"),
    "ctr": ("ctr", "percent"),
    "tipo de campana": ("type", "text"),
    "conversiones": ("conversions", "number"),
    "conv.": ("conversions", "number"),
    "costo/conv.": ("costPerConversion", "number"),
    "coste/conv.": ("costPerConversion", "number"),
}
# Columnas que no van a cada campana sino al presupuesto diario del mes.
BUDGET_COLUMNS = {
    "presupuesto": "budget",
    "nombre del presupuesto": "budgetName",
    "tipo de presupuesto": "budgetType",
    "estado de la campana": "status",
}
# El rango del informe puede venir como "1 de agosto de 2026" o "1 ago 2026".
MONTH_PREFIX = {name[:3]: number for name, number in MONTH_BY_NAME.items()}
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


# Google Sheets en espanol exporta 99,46 y 1.894; el CSV de Google Ads en ingles, 99.46 y 1,894.
# Una coma seguida de uno o dos digitos solo existe en el formato espanol: decide como leer el archivo.
DECIMAL_COMMA = re.compile(r"^-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}%?$")
DOT_THOUSANDS = re.compile(r"^-?\d{1,3}(?:\.\d{3})+$")
DOT_DECIMAL = re.compile(r"^-?\d+\.\d{1,2}%?$")


def uses_decimal_comma(rows):
    """True si el informe viene con coma decimal (formato espanol)."""
    cells = [cell.strip() for row in rows for cell in row]
    if any(DECIMAL_COMMA.match(cell) for cell in cells):
        return True
    # Sin decimales a la vista, un 1.894 sin ningun 9.39 tambien delata el formato espanol.
    return any(DOT_THOUSANDS.match(cell) for cell in cells) and not any(DOT_DECIMAL.match(cell) for cell in cells)


def parse_number(value, comma=False):
    text = str(value or "").strip()
    if not text or text in {"--", "-"} or text.startswith("<"):
        return None
    cleaned = re.sub(r"[^\d,.\-]", "", text)
    cleaned = cleaned.replace(".", "").replace(",", ".") if comma else cleaned.replace(",", "")
    if not cleaned or cleaned in {"-", ".", "-."}:
        return None
    try:
        number = float(cleaned)
    except ValueError:
        return None
    return int(number) if number.is_integer() else number


def parse_percent(value, comma=False):
    number = parse_number(value, comma)
    return None if number is None else number / 100


def parse_int(value, comma=False):
    number = parse_number(value, comma)
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


def period_from_text(text):
    """Lee el rango del informe: 1 de agosto de 2026 - 31 de agosto de 2026."""
    found = re.findall(r"\b(\d{1,2})\s+(?:de\s+)?([a-z]{3})[a-z]*\.?\s+(?:de\s+)?(\d{4})", normalize(text))
    dates = [f"{int(year):04d}-{MONTH_PREFIX[month]:02d}-{int(day):02d}"
             for day, month, year in found if month in MONTH_PREFIX]
    return {"start": dates[0], "end": dates[-1]} if len(dates) >= 2 else None


def add_budget(budgets, entry, row, positions, comma=False):
    """Anota estado y presupuesto diario de la campana y lo suma al del mes si esta habilitada."""
    def cell(field):
        position = positions.get(field)
        return row[position].strip() if position is not None and position < len(row) else ""

    status = cell("status")
    kind = normalize(cell("budgetType"))
    # Un presupuesto total de campana no es diario.
    amount = parse_number(cell("budget"), comma) if not kind or kind.startswith("diari") else None
    if status:
        entry["status"] = status
    if amount is None:
        return
    entry["dailyBudget"] = amount
    # Una campana detenida no gasta en lo que queda del mes; un presupuesto compartido se cuenta una vez.
    if status and not normalize(status).startswith("habilitad"):
        return
    shared = cell("budgetName")
    budgets[f"budget:{shared}" if shared not in ("", "--") else f"campaign:{entry['campaign']}"] = amount


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


def script_reader():
    """URL del Web App y clave de lectura del Apps Script, o None si falta alguna."""
    url = os.environ.get("AQ_DRIVE_SCRIPT_URL", "").strip()
    key = os.environ.get("AQ_DRIVE_READ_KEY", "").strip()
    return (url, key) if url and key else None


# CSV que ya entrego el Apps Script al listar la carpeta, por id de archivo.
_SCRIPT_CSV = {}


def list_with_script(folder_id, reader):
    """Le pide la carpeta al Apps Script (sin subcarpetas). La clave va en el cuerpo del POST, nunca en la URL."""
    url, key = reader
    body = urllib.parse.urlencode({"action": "leer", "carpeta": folder_id, "clave": key}).encode("utf-8")
    request = urllib.request.Request(url, data=body, headers={
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
    })
    # Apps Script responde con una redireccion a la respuesta; urllib la sigue con GET, sin el cuerpo.
    with urllib.request.urlopen(request, timeout=TIMEOUT * 4) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not payload.get("ok"):
        raise ValueError(payload.get("error") or "respuesta sin ok")
    files = []
    for item in payload.get("files", []):
        _SCRIPT_CSV[item["id"]] = item.get("csv") or ""
        files.append({"id": item["id"], "name": item["name"], "modifiedTime": item.get("modifiedTime")})
    return files


def script_csv(file_id):
    """El CSV que entrego el Apps Script para este archivo, o None si no paso por ahi."""
    text = _SCRIPT_CSV.get(file_id)
    return text.lstrip("\ufeff") if text is not None else None


def list_with_api(folder_id, key):
    query = urllib.parse.urlencode({
        "q": f"'{folder_id}' in parents and trashed = false",
        "key": key,
        "fields": "files(id,name,modifiedTime,mimeType)",
        "pageSize": "200",
    })
    payload = json.loads(fetch(f"https://www.googleapis.com/drive/v3/files?{query}"))
    # Las subcarpetas (Keywords, Terminos de busqueda...) no son informes.
    return [
        {"id": item["id"], "name": item["name"], "modifiedTime": item.get("modifiedTime")}
        for item in payload.get("files", [])
        if item.get("mimeType") != "application/vnd.google-apps.folder"
    ]


def list_with_public_view(folder_id):
    """Lee la vista publica de la carpeta, sin las subcarpetas. No necesita credenciales."""
    html = fetch(f"https://drive.google.com/embeddedfolderview?id={folder_id}#list").decode("utf-8", "replace")
    pattern = re.compile(r"id=\"entry-([-\w]{20,})\".*?href=\"([^\"]*)\".*?flip-entry-title\">([^<]+)<", re.S)
    return [{"id": found.group(1), "name": found.group(3).strip(), "modifiedTime": None}
            for found in pattern.finditer(html) if "/folders/" not in found.group(2)]


def list_files(folder_id):
    reader = script_reader()
    if reader:
        try:
            files = list_with_script(folder_id, reader)
            if files:
                return files, "apps script"
        except (urllib.error.URLError, json.JSONDecodeError, KeyError, ValueError) as error:
            print(f"[sync-drive] el Apps Script no entrego la carpeta ({error}); pruebo las otras vias.")
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


def is_report(item):
    """Hojas de calculo de Google (sin extension) o CSV; el resto de la carpeta se ignora."""
    suffix = Path(item["name"]).suffix.lower()
    return suffix == ".csv" or suffix == ""


def download(file_id, name):
    """Baja el CSV o exporta la hoja de calculo como CSV. Devuelve None si Drive no lo entrega."""
    text = script_csv(file_id)
    if text is not None:
        return text
    key = api_key()
    urls = []
    if name.lower().endswith(".csv"):
        if key:
            urls.append(f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media&key={key}")
        urls.append(f"https://drive.google.com/uc?export=download&id={file_id}")
        urls.append(f"https://drive.usercontent.google.com/download?id={file_id}&export=download")
    else:
        if key:
            urls.append(f"https://www.googleapis.com/drive/v3/files/{file_id}/export?mimeType=text/csv&key={key}")
        urls.append(f"https://docs.google.com/spreadsheets/d/{file_id}/export?format=csv")
    last_error = None
    for url in urls:
        try:
            return fetch(url).decode("utf-8-sig", "replace")
        except urllib.error.URLError as error:
            last_error = error
    # Un archivo que falla no frena al resto: su mes queda como estaba.
    print(f"[sync-drive] no se pudo descargar {name}: {last_error}")
    return None


def excluded_campaigns():
    """Campanas de excludeCampaigns en data/drive-config.json (por ejemplo, una ajena a la cuenta)."""
    return {normalize(name) for name in load_config().get("excludeCampaigns") or []}


def parse_campaign_report(text, name, exclude=frozenset()):
    """Normaliza el informe de campana de Google Ads.

    Las campanas de exclude no se guardan: su gasto se descuenta de los totales del mes y queda
    anotado en summary["excluded"] para que el tablero lo avise.
    """
    rows = list(csv.reader(io.StringIO(text)))
    header_index = None
    for index, row in enumerate(rows[:12]):
        plain = [normalize(cell) for cell in row]
        if "campana" in plain and any(cell in {"costo", "coste"} for cell in plain):
            header_index = index
            break
    if header_index is None:
        return None, [], {}, {}
    # Un informe por dia (o por anuncio) tambien trae Campana y Costo, pero repite cada campana una vez por fila.
    if "dia" in (normalize(cell) for cell in rows[header_index]):
        print(f"[sync-drive] {name}: trae la columna Dia; no es el informe de campana (un total por campana).")
        return None, [], {}, {}

    month_id = None
    period = None
    for row in rows[:header_index]:
        month_id = month_id or month_from_text(" ".join(row))
        period = period or period_from_text(" ".join(row))
    month_id = month_id or month_from_text(name)

    columns = {}
    budget_columns = {}
    for position, cell in enumerate(rows[header_index]):
        mapped = COLUMNS.get(normalize(cell))
        if mapped and mapped[0] not in columns:
            columns[mapped[0]] = (position, mapped[1])
        budget_field = BUDGET_COLUMNS.get(normalize(cell))
        if budget_field and budget_field not in budget_columns:
            budget_columns[budget_field] = position

    records = []
    excluded = []
    totals = {}
    budgets = {}
    total_fields = ("cost", "impressions", "clicks", "ctr", "conversions", "costPerConversion")
    comma = uses_decimal_comma(rows[header_index + 1:])
    for row in rows[header_index + 1:]:
        if not row or not any(cell.strip() for cell in row):
            continue
        first = normalize(row[0])
        entry = {}
        for field, (position, kind) in columns.items():
            raw = row[position] if position < len(row) else None
            entry[field] = str(raw or "").strip() if kind == "text" else PARSERS[kind](raw, comma)
        if first.startswith("total"):
            # Total: Campanas filtradas trae los totales del mes ya calculados.
            if first.startswith("total: campanas") or not totals:
                totals = {field: entry.get(field) for field in total_fields}
            continue
        if entry.get("campaign") and normalize(entry["campaign"]) in exclude:
            excluded.append({field: entry.get(field) for field in ("campaign", "cost", "impressions", "clicks", "conversions")})
            continue
        if entry.get("campaign"):
            add_budget(budgets, entry, row, budget_columns, comma)
            records.append(entry)
    names = [normalize(record["campaign"]) for record in records]
    if len(set(names)) < len(names):
        print(f"[sync-drive] {name}: repite campanas ({len(names)} filas, {len(set(names))} campanas); "
              "no es el informe de campana.")
        return None, [], {}, {}
    # Los totales del informe incluyen las campanas excluidas; la suma de las campanas guardadas, no.
    report_totals = bool(totals)
    if not totals and records:
        # Sin fila Total en el informe, los totales del mes son la suma de sus campanas (nunca los de antes).
        def total(field):
            values = [record.get(field) for record in records]
            return None if any(value is None for value in values) else round(sum(values), 2)
        totals = {field: total(field) for field in ("cost", "impressions", "clicks", "conversions")}
        totals["ctr"] = totals["clicks"] / totals["impressions"] if totals["impressions"] else None
        totals["costPerConversion"] = round(totals["cost"] / totals["conversions"], 2) if totals["conversions"] else None
    if excluded and report_totals:
        # Se descuentan las campanas excluidas y se recalculan los cocientes.
        for field in ("cost", "impressions", "clicks", "conversions"):
            if totals.get(field) is not None:
                totals[field] = round(totals[field] - sum(item.get(field) or 0 for item in excluded), 2)
        totals["ctr"] = totals["clicks"] / totals["impressions"] if totals.get("impressions") else None
        totals["costPerConversion"] = round(totals["cost"] / totals["conversions"], 2) if totals.get("conversions") else None
    summary = {
        "period": period,
        "dailyBudget": round(sum(budgets.values()), 2) if budgets else None,
        "excluded": excluded or None,
    }
    return month_id, records, totals, summary


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


def store_report(months, month_id, records, totals, summary, source_name, file_id=None):
    """Guarda un informe ya normalizado en su mes y reemplaza lo que hubiera de ese mes."""
    month = months.setdefault(month_id, {"id": month_id, "label": month_label(month_id), "records": []})
    month["label"] = month.get("label") or month_label(month_id)
    month["sourceFile"] = source_name
    if file_id:
        month["driveFileId"] = file_id
    else:
        month.pop("driveFileId", None)
    month["records"] = records
    if totals:
        month["totals"] = totals
    # El rango da la fecha de corte de Proyecciones; el presupuesto es el vigente al exportar.
    for key, value in summary.items():
        if value is None:
            month.pop(key, None)
        else:
            month[key] = value


def finish_document(document, months):
    """Ordena los meses, recalcula las variaciones y deja el ultimo mes como el del filtro."""
    document["months"] = sorted(months.values(), key=lambda month: month["id"])
    apply_deltas(document["months"])
    document["defaultMonth"] = document["months"][-1]["id"] if document["months"] else None
    document["schemaVersion"] = 3
    document["status"] = "ok"
    mirror_legacy_month(document)


def import_file(path, check):
    """Carga un informe de campana local, por ejemplo el del mes en curso que aun no esta en Drive.

    Queda en el JSON como cualquier mes: la sincronizacion con Drive lo conserva hasta que la carpeta
    traiga un CSV del mismo mes, que entonces lo reemplaza.
    """
    text = path.read_text(encoding="utf-8-sig")
    month_id, records, totals, summary = parse_campaign_report(text, path.name, excluded_campaigns())
    if not month_id or not records:
        print(f"[sync-drive] {path.name} no parece un informe de campana.")
        return 1
    document = load_document()
    before = comparable(document)
    months = {month["id"]: month for month in document["months"]}
    store_report(months, month_id, records, totals, summary, path.name)
    finish_document(document, months)
    changed = comparable(document) != before
    if check:
        print("[sync-drive] hay cambios." if changed else "[sync-drive] sin cambios.")
        return 0
    (BACKUPS.parent / path.name).write_text(text, encoding="utf-8")
    DATA.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[sync-drive] {month_label(month_id)}: {len(records)} campanas desde {path.name}")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Sincroniza el gasto publicitario desde Google Drive.")
    parser.add_argument("--check", action="store_true", help="Informa si hay cambios sin escribir el JSON")
    parser.add_argument("--folder", help="ID de la carpeta de Drive")
    parser.add_argument("--file", type=Path, help="Importa un informe de campana local en vez de leer Drive")
    args = parser.parse_args()

    if args.file:
        return import_file(args.file, args.check)

    config = load_config()
    folder_id = args.folder or config.get("folderId")
    if not folder_id:
        print("[sync-drive] falta folderId en data/drive-config.json")
        return 1

    files, origin = list_files(folder_id)
    csv_files = [item for item in files if is_report(item)]
    if not csv_files:
        print(f"[sync-drive] la carpeta no devolvio informes (origen: {origin}).")
        return 1
    print(f"[sync-drive] {len(csv_files)} informes en la carpeta (origen: {origin}).")

    document = load_document()
    before = comparable(document)
    months = {month["id"]: month for month in document["months"]}
    BACKUPS.mkdir(parents=True, exist_ok=True)
    exclude = excluded_campaigns()

    loaded = {}
    for item in sorted(csv_files, key=lambda entry: entry["name"]):
        text = download(item["id"], item["name"])
        if text is None:
            continue
        month_id, records, totals, summary = parse_campaign_report(text, item["name"], exclude)
        if not month_id or not records:
            print(f"[sync-drive] omito {item['name']}: no parece un informe de campana.")
            continue
        # Dos informes del mismo mes: gana el que llega mas lejos en el mes.
        end = (summary.get("period") or {}).get("end") or ""
        if month_id in loaded and loaded[month_id][0] >= end:
            print(f"[sync-drive] omito {item['name']}: {month_label(month_id)} ya viene en {loaded[month_id][1]}.")
            continue
        loaded[month_id] = (end, item["name"])
        store_report(months, month_id, records, totals, summary, item["name"], item["id"])
        # La copia cruda va como CSV aunque en Drive sea una hoja de calculo (sin convertir los saltos de linea).
        backup = item["name"] if item["name"].lower().endswith(".csv") else f"{item['name']}.csv"
        (BACKUPS / backup).write_text(text, encoding="utf-8", newline="")
        print(f"[sync-drive] {month_label(month_id)}: {len(records)} campanas")

    finish_document(document, months)
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
