#!/usr/bin/env python3
"""Importa la tabla de resultados publicitarios de Aquarius al JSON del dashboard."""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "aquarius-lima-retail-2026.json"

EXPECTED_HEADERS = ["Campaña", "Coste", "% Δ", "CTR", "% Δ", "Clics", "% Δ", "Conv", "% Δ", "Cos/con", "% Δ"]
FIELDS = [
    "campaign",
    "cost",
    "costDelta",
    "ctr",
    "ctrDelta",
    "clicks",
    "clicksDelta",
    "conversions",
    "conversionsDelta",
    "costPerConversion",
    "costPerConversionDelta",
]
NUMERIC_FIELDS = set(FIELDS) - {"campaign"}


def normalize(text: object) -> str:
    value = str(text or "").strip().lower()
    replacements = str.maketrans("áéíóúüñδ", "aeiouund")
    return re.sub(r"\s+", " ", value.translate(replacements))


def parse_number(value: object) -> float | int | None:
    text = str(value or "").strip()
    if not text or text == "-":
        return None
    cleaned = re.sub(r"(s/|%)", "", text, flags=re.I).replace(",", "").strip()
    try:
        number = float(cleaned)
    except ValueError:
        return None
    if not math.isfinite(number):
        return None
    return int(number) if number.is_integer() else number


def read_csv(path: Path) -> tuple[list[str], list[list[object]]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.reader(handle))
    if not rows:
        return [], []
    return [str(cell or "").strip() for cell in rows[0]], rows[1:]


def read_xlsx(path: Path) -> tuple[list[str], list[list[object]]]:
    try:
        from openpyxl import load_workbook
    except ImportError as exc:
        raise SystemExit("Para leer .xlsx instala openpyxl o exporta la fuente como CSV.") from exc
    workbook = load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.active
    rows = list(sheet.iter_rows(values_only=True))
    if not rows:
        return [], []
    headers = [str(cell or "").strip() for cell in rows[0]]
    return headers, [list(row) for row in rows[1:] if any(value not in (None, "") for value in row)]


def read_source(path: Path) -> tuple[list[str], list[list[object]]]:
    if path.suffix.lower() == ".csv":
        return read_csv(path)
    if path.suffix.lower() in {".xlsx", ".xlsm"}:
        return read_xlsx(path)
    raise SystemExit("Formato no soportado. Usa .csv, .xlsx o .xlsm.")


def compatible(headers: list[str]) -> bool:
    if len(headers) < len(EXPECTED_HEADERS):
        return False
    return all(normalize(headers[index]) == normalize(expected) for index, expected in enumerate(EXPECTED_HEADERS))


def build_payload(path: Path, headers: list[str], rows: list[list[object]]) -> dict[str, object]:
    records = []
    for source in rows:
        record = {}
        for index, field in enumerate(FIELDS):
            value = source[index] if index < len(source) else None
            record[field] = parse_number(value) if field in NUMERIC_FIELDS else str(value or "").strip()
        if record.get("campaign"):
            records.append(record)
    return {
        "brand": "Aquarius",
        "dashboard": "Gasto Publicitario",
        "moduleSubtitle": "Branding y ventas",
        "status": "ok",
        "sourceFile": path.name,
        "receivedHeaders": headers,
        "records": records,
    }


def build_incompatible(path: Path, headers: list[str]) -> dict[str, object]:
    return {
        "brand": "Aquarius",
        "dashboard": "Gasto Publicitario",
        "moduleSubtitle": "Branding y ventas",
        "status": "incompatible",
        "sourceFile": path.name,
        "reason": "El archivo no contiene la tabla de resultados esperada para gasto publicitario.",
        "receivedHeaders": headers,
        "expectedHeaders": EXPECTED_HEADERS,
        "records": [],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Normaliza la tabla de resultados publicitarios de Aquarius.")
    parser.add_argument("source", type=Path, help="Archivo fuente .csv, .xlsx o .xlsm")
    parser.add_argument("--output", type=Path, default=OUTPUT, help="Ruta JSON de salida")
    args = parser.parse_args()

    headers, rows = read_source(args.source)
    payload = build_payload(args.source, headers, rows) if compatible(headers) else build_incompatible(args.source, headers)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    status = f"{len(payload['records'])} registros" if payload["status"] == "ok" else "incompatible"
    print(f"[aquarius-import] escrito {args.output} ({status})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
