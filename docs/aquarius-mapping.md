# Mapeo Aquarius Lima Retail 2026

## Objetivo

Dashboard estatico de Aquarius con lectura de gasto publicitario: marca, visual y modelo de datos propios.

## Identidad

- Marca principal: Aquarius
- Acceso: clave en el secret `AQ_PAGE_PASSWORD` (el build cifra el tablero; ver README)
- Titulo: `Aquarius | Dashboard Lima Retail 2026`
- Paleta: azules, celestes y tonos agua
- Enfoque: gasto publicitario, branding y ventas

## Campos reflejados

| Fuente Excel | Campo JSON | Uso |
| --- | --- | --- |
| `Campaña` | `campaign` | Distribucion por campana, un cuadro por campana (`campaignLabel()`) |
| `Coste` | `cost` | KPIs del periodo, graficos y distribucion |
| `% Δ` despues de Coste | `costDelta` | Guardado; el tablero compara con el mes calendario anterior |
| `CTR` | `ctr` | Guardado; el CTR se recalcula como clics / impresiones |
| `% Δ` despues de CTR | `ctrDelta` | Guardado (no se muestra) |
| `Clics` | `clicks` | KPIs, CTR, CPC, tasa de conversion y graficos |
| `% Δ` despues de Clics | `clicksDelta` | Guardado (no se muestra) |
| `Conv` | `conversions` | KPIs, costo y tasa de conversion, graficos |
| `% Δ` despues de Conv | `conversionsDelta` | Guardado (no se muestra) |
| `Cos/con` | `costPerConversion` | Guardado; se recalcula como inversion / conversiones |
| `% Δ` despues de Cos/con | `costPerConversionDelta` | Guardado (no se muestra) |
| Rango de fechas del informe | `period` (por mes) | Titulo del periodo, mes en curso y prorrateo de la comparacion; fecha de corte de Proyecciones |
| `Presupuesto` de campanas habilitadas | `dailyBudget` (por mes) | Total de la distribucion; presupuesto de Proyecciones |
| `Estado de la campaña` | `status` (por campana) | Distribucion y cuadro por campana; proyeccion por campana |
| `Presupuesto` (tipo diario) | `dailyBudget` (por campana) | Distribucion y cuadro por campana; proyeccion por campana |

## Palabras clave (informe de palabras clave de busqueda)

| Columna del informe | Campo JSON | Uso |
| --- | --- | --- |
| `Palabra clave` | `keyword` | Fila del cuadro de la campana (Palabras Clave y Gasto Publicitario) y del ranking |
| `Tipo de concordancia` | `matchType` | Debajo de la palabra clave; junto con ella identifica la fila mes a mes |
| `Campaña` | `campaign` | Un cuadro por campana |
| `Grupo de anuncios` | `adGroup` | Una palabra clave en varios grupos se suma en una fila |
| `Estado de palabras clave` | `state` | Guardado (Habilitado / Detenido) |
| `Estado` / `Motivos del estado` | `status` / `reasons` | Columna Estado; "campaña detenida" en todas = campana detenida |
| `Impr.` / `Clics` / `Costo` / `Conversiones` | `impressions` / `clicks` / `cost` / `conversions` | Base de todos los indicadores |
| `% impr. parte sup. búsqueda` | `topShare` (texto, p. ej. `< 10%`) | Columna Perdidas x ranking |
| `% impr. perdidas de la Búsqueda (ranking)` | `lostRank` (texto) | Columna Perdidas x ranking |

CTR, CPC, tasa y costo por conversion no se guardan: se calculan de las sumas. Las filas `Total: ...` se ignoran.
Gasto Publicitario lee este JSON tal como lo publica el build, sin las campanas de `keywords.excludeCampaigns`.

## Archivos clave

- `js/objectives.js`: Gasto Publicitario: pestanas de mes y Anual, periodo con KPIs, grafico de la cuenta,
  distribucion y cuadro por campana y ranking de palabras clave; expone `AquariusDashboard` (`snapshot()`).
- `js/projections.js`: proyeccion al cierre y simulador de objetivo; lee `AquariusDashboard.snapshot()`.
- `js/keywords.js`: analisis de palabras clave y boton Actualizar (lee las hojas de Drive desde el navegador).
- `data/aquarius-lima-retail-2026.json`: fuente normalizada.
- `data/aquarius-palabras-clave-2026.json`: informe de palabras clave normalizado (`scripts/sync-keywords.py`).
- `scripts/import-aquarius-data.py`: importador CSV/XLSX.
- `scripts/build.js`: build estatico con data Aquarius incrustada.
