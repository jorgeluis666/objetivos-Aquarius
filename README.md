# Aquarius | Dashboard Lima Retail 2026

Dashboard de gasto publicitario para Aquarius, adaptado desde la arquitectura original del panel de Amador.

## Acceso

- Password del login: `Aquarius2026`
- Entrada local: `index.html`
- Build publicado: `dist/index.html`

## Modulo principal

- Titulo: `Gasto Publicitario`
- Subtitulo: `Branding y ventas`
- KPIs: coste total, CTR, clics, conversiones y costo por conversion.

## Fuente de datos

La fuente normalizada del dashboard esta en:

`data/aquarius-lima-retail-2026.json`

Desde la version 1.2.0 el JSON guarda la data agrupada por mes:

```json
{
  "defaultMonth": "2026-08",
  "months": [
    {
      "id": "2026-08",
      "label": "Agosto 2026",
      "sourceFile": "...",
      "records": [ /* tabla de campanas */ ],
      "impressions": { "total": 33828, "daily": [ { "date": "2026-08-01", "impressions": 1234 } ] }
    }
  ]
}
```

El filtro `Mes` del dashboard lista cada entrada de `months` y recuerda la ultima
seleccion del usuario. Los meses sin tabla de campanas muestran un aviso y solo
grafican impresiones.

### Formatos aceptados

1. Tabla de resultados por campana (`.csv`, `.xlsx`, `.xlsm`):
   `Campaña | Coste | % Δ | CTR | % Δ | Clics | % Δ | Conv | % Δ | Cos/con | % Δ`
2. Serie temporal de impresiones (`.csv`): `Fecha | Impresiones`

## Importar la data de cada mes

```bash
python scripts/import-aquarius-data.py "ruta/al/archivo.csv" --month 2026-09
```

- `--month AAAA-MM` define el periodo destino. Si el nombre del archivo trae el
  rango de fechas (por ejemplo `...(2026.08.01-2026.08.31).csv`) el mes se
  detecta solo.
- `--label "Setiembre 2026"` cambia la etiqueta visible del filtro.
- La importacion actualiza solo el mes indicado y conserva los meses anteriores.
- Ejecuta el importador una vez por cada archivo: uno para la tabla de campanas y
  otro para la serie de impresiones del mismo mes.

Despues de importar, regenera el build:

## Build

```bash
npm.cmd run build
```

El build incrusta los assets en `dist/index.html`. Si Windows bloquea `dist/data`, el script mantiene actualizado el HTML y muestra una advertencia.
