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

El Excel recibido, `Aquarius - Dashboard Lima Retail_Visión General_Tabla.csv.xlsx`, contiene la tabla de resultados de pauta digital:

- `Campaña`
- `Coste`
- `% Δ`
- `CTR`
- `Clics`
- `Conv`
- `Cos/con`

El dashboard refleja esas filas en la tabla de resultados y en el grafico por campana.

## Importar nueva data

Cuando llegue una fuente retail valida:

```bash
python scripts/import-aquarius-data.py "ruta/al/archivo.xlsx"
```

El importador actualiza `data/aquarius-lima-retail-2026.json`.

## Build

```bash
npm.cmd run build
```

El build incrusta los assets en `dist/index.html`. Si Windows bloquea `dist/data`, el script mantiene actualizado el HTML y muestra una advertencia.
