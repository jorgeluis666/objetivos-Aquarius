#!/usr/bin/env python3
"""Trae a data/reglas.json las reglas del Ciclo Mensual de Analisis y Optimizacion.

La raiz editable es la hoja Reglas_Nexus_Aquarius de la carpeta «08 Reglas y
Optimizacion» del Drive de la marca: lo que el equipo cambie ahi manda, y este
script lo baja al repositorio. Antes se editaba a mano.

Esa carpeta tiene la herencia de permisos apagada, porque la carpeta de la marca
esta compartida con cuentas del lado del cliente. Por eso no sirve ni la vista
publica de Drive ni una API key (una API key no autentica a nadie: solo abre
archivos publicos). La unica via es el Web App del Apps Script de LR Suite, que
corre con la cuenta duena de las hojas y va detras de un token:

    AQ_REGLAS_URL     URL del Web App desplegado (termina en /exec)
    AQ_REGLAS_TOKEN   su token (la propiedad TOKEN del script)
    AQ_REGLAS_MARCA   opcional: el nombre de la marca en el maestro, si no es Aquarius

De la hoja viaja solo lo que el tablero evalua: id, metrica, operador, valor y
accion. La columna «Instruccion Estrategica para la IA» NO viaja a este
repositorio: esta escrita para la agencia, habla del cliente en tercera persona
y se queda en LR Suite.

Si el Web App no responde, si el token no cuadra o si el barrido no trae a la
marca, data/reglas.json se queda exactamente como estaba. Un tablero sin reglas
ordena los avisos como siempre, y eso es aceptable; perder las reglas por un
fallo de red no lo es.

Uso:

    python scripts/sync-reglas.py                      # sincroniza
    python scripts/sync-reglas.py --check              # solo informa si hay cambios
    python scripts/sync-reglas.py --barrido copia.json # lee un barrido ya guardado
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "reglas.json"

MARCA = "Aquarius"
PREFIJO = "AQ"
HOJA = f"Reglas_Nexus_{MARCA}"

TIMEOUT = 60
USER_AGENT = "aquarius-dashboard-sync/1.0"

# El orden de los campos es el que lee js/alertas-core.js. La hoja tiene tres columnas mas
# (Semana / Hito, Activar IA e Instruccion Estrategica) que se quedan en LR Suite.
CAMPOS = ("id", "metrica", "operador", "valor", "accion")

COMENTARIO = (
    "Ciclo Mensual de Analisis y Optimizacion. Dice en que parte del mes vamos y, con eso, en que "
    f"orden se leen los avisos del tablero. Lo genera scripts/sync-reglas.py desde la hoja {HOJA} "
    "de la carpeta 08 Reglas y Optimizacion del Drive de la marca (permisos restringidos al "
    "equipo), que es la raiz editable: lo que se cambie ahi manda y no conviene editar este "
    "archivo a mano. La instruccion estrategica de la hoja NO viaja a este archivo: esta escrita "
    "para la agencia y se queda en LR Suite."
)


def normalize(text):
    value = str(text or "").strip().lower()
    return re.sub(r"\s+", " ", value.translate(str.maketrans("áéíóúüñ", "aeiouun")))


def marca():
    """El nombre de la marca tal como esta en el maestro de LR Suite."""
    return os.environ.get(f"{PREFIJO}_REGLAS_MARCA", "").strip() or MARCA


def credenciales():
    """URL y token del Web App, o None si falta alguno."""
    url = os.environ.get(f"{PREFIJO}_REGLAS_URL", "").strip()
    token = os.environ.get(f"{PREFIJO}_REGLAS_TOKEN", "").strip()
    return (url, token) if url and token else None


def pedir_barrido(url, token):
    """Le pide al Web App el barrido de todas las marcas y devuelve el JSON ya leido.

    El token va en la query porque es lo que espera el doGet del Apps Script (el mismo formato con
    el que lo lee LR Suite). Por eso la URL armada es un secreto y no se imprime nunca, ni en los
    mensajes de error: el registro de Actions de este repositorio es publico.
    """
    separador = "&" if "?" in url else "?"
    pedido = urllib.request.Request(
        url + separador + urllib.parse.urlencode({"token": token}),
        headers={"User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(pedido, timeout=TIMEOUT) as respuesta:
        cuerpo = respuesta.read().decode("utf-8", "replace")

    datos = json.loads(cuerpo)
    if not isinstance(datos, dict):
        raise ValueError("el barrido no es un objeto JSON")
    # Un token que no cuadra no llega como error HTTP: el Apps Script responde 200 con
    # {"error": "sin permiso"}. Por eso se mira el cuerpo y no solo el codigo de estado.
    if datos.get("error"):
        raise ValueError(f"respondio \"{datos['error']}\"; revisa {PREFIJO}_REGLAS_URL y {PREFIJO}_REGLAS_TOKEN")
    if not isinstance(datos.get("marcas"), list):
        raise ValueError("el barrido no trae la lista de marcas")
    return datos


def numero(valor):
    """El corte de la regla. Una celda vacia o con texto queda en null, para que el tablero la
    salte en lugar de aplicar un corte inventado."""
    try:
        leido = float(valor)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(leido):
        return None
    return int(leido) if leido.is_integer() else leido


def limpiar(fila):
    """Deja la regla con los cinco campos que viajan al tablero, o None si la fila no es una regla.

    El filtro es el mismo del barrido (id y metrica): una fila sin eso suele ser una nota que
    alguien dejo al pie de la hoja. Las demas se conservan en el orden de la hoja aunque el
    operador no se entienda, porque la semana del ciclo sale de la posicion en la lista.
    """
    if not isinstance(fila, dict):
        return None
    id_regla = str(fila.get("id") or "").strip()
    metrica = str(fila.get("metrica") or "").strip()
    if not id_regla or not metrica:
        return None
    return {
        "id": id_regla,
        "metrica": metrica,
        "operador": str(fila.get("operador") or "").strip(),
        "valor": numero(fila.get("valor")),
        "accion": str(fila.get("accion") or "").strip(),
    }


def reglas_de_marca(barrido):
    """Las reglas de esta marca, sin las columnas internas de la agencia."""
    buscada = normalize(marca())
    entrada = next(
        (item for item in barrido.get("marcas") or []
         if isinstance(item, dict) and normalize(item.get("marca")) == buscada),
        None,
    )
    if entrada is None:
        # Las otras marcas no se nombran: este repositorio es publico y con el su registro de Actions.
        raise ValueError(
            f"el barrido no trae a {marca()} (devolvio {len(barrido.get('marcas') or [])} marcas); "
            f"si en el maestro se llama distinto, ponlo en {PREFIJO}_REGLAS_MARCA"
        )

    reglas = [regla for regla in (limpiar(fila) for fila in entrada.get("reglas") or []) if regla]
    if not reglas:
        raise ValueError(f"la hoja de {marca()} no trae ninguna regla aplicable")
    return reglas


def documento(reglas):
    return {
        "_comentario": COMENTARIO,
        "fuente": HOJA,
        "lastSync": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "reglas": reglas,
    }


def comparable(documento):
    """El documento sin la marca de tiempo: sirve para saber si cambio alguna regla."""
    return json.dumps({clave: valor for clave, valor in documento.items() if clave != "lastSync"},
                      ensure_ascii=False, sort_keys=True)


def volcar(documento):
    """El JSON con una regla por linea, como estaba escrito a mano: un cambio se lee de un golpe."""
    def pareja(clave, valor):
        return f"{json.dumps(clave, ensure_ascii=False)}: {json.dumps(valor, ensure_ascii=False)}"

    cabeza = ",\n".join(f"  {pareja(clave, documento[clave])}"
                        for clave in ("_comentario", "fuente", "lastSync"))
    reglas = ",\n".join("    { " + ", ".join(pareja(campo, regla[campo]) for campo in CAMPOS) + " }"
                        for regla in documento["reglas"])
    return "{\n" + cabeza + ',\n  "reglas": [\n' + reglas + "\n  ]\n}\n"


def guardado():
    """Lo que hay hoy en data/reglas.json, o None si no existe o no se puede leer."""
    if not DATA.exists():
        return None
    try:
        leido = json.loads(DATA.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return leido if isinstance(leido, dict) else None


def reportar(cambio):
    """En GitHub Actions deja changed como salida del paso."""
    salida = os.environ.get("GITHUB_OUTPUT")
    if not salida:
        return
    with open(salida, "a", encoding="utf-8") as archivo:
        archivo.write("changed=" + ("true" if cambio else "false") + "\n")


def main():
    parser = argparse.ArgumentParser(description="Trae las reglas del ciclo mensual desde el Drive de la marca.")
    parser.add_argument("--check", action="store_true", help="Informa si hay cambios sin escribir el JSON")
    parser.add_argument("--barrido", type=Path, help="Lee un barrido ya guardado en vez de llamar al Web App")
    args = parser.parse_args()

    if args.barrido:
        try:
            barrido = json.loads(args.barrido.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            print(f"[sync-reglas] no se pudo leer {args.barrido}: {error}")
            return 1
    else:
        credencial = credenciales()
        if not credencial:
            # Mientras el Web App no este desplegado esto no es un fallo: el archivo se queda como
            # esta y el tablero ordena los avisos como siempre.
            print(f"[sync-reglas] sin {PREFIJO}_REGLAS_URL y {PREFIJO}_REGLAS_TOKEN: "
                  f"{DATA.name} se queda como esta.")
            return 0
        try:
            barrido = pedir_barrido(*credencial)
        except (urllib.error.URLError, OSError, json.JSONDecodeError, ValueError, UnicodeError) as error:
            print(f"[sync-reglas] el Web App no entrego el barrido ({error}); "
                  f"{DATA.name} se queda como esta.")
            return 1

    try:
        reglas = reglas_de_marca(barrido)
    except ValueError as error:
        print(f"[sync-reglas] {error}; {DATA.name} se queda como esta.")
        return 1

    nuevo = documento(reglas)
    anterior = guardado()
    cambio = anterior is None or comparable(nuevo) != comparable(anterior)

    if args.check:
        print("[sync-reglas] hay cambios." if cambio else "[sync-reglas] sin cambios.")
        return 0

    # Se escribe siempre, para que lastSync diga cuando se leyo la hoja de verdad, pero el paso
    # solo informa cambio cuando cambio una regla: asi el workflow no commitea una hora nueva sola.
    DATA.parent.mkdir(parents=True, exist_ok=True)
    DATA.write_text(volcar(nuevo), encoding="utf-8", newline="\n")
    print(f"[sync-reglas] {len(reglas)} reglas desde {HOJA}: "
          f"{'hay cambios' if cambio else 'sin cambios'}.")
    reportar(cambio)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
