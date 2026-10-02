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
| `Campaña` | `campaign` | Tabla y eje del grafico |
| `Coste` | `cost` | KPI, grafico y tabla |
| `% Δ` despues de Coste | `costDelta` | Tabla |
| `CTR` | `ctr` | KPI, grafico y tabla |
| `% Δ` despues de CTR | `ctrDelta` | Tabla |
| `Clics` | `clicks` | KPI, grafico y tabla |
| `% Δ` despues de Clics | `clicksDelta` | Tabla |
| `Conv` | `conversions` | KPI, grafico y tabla |
| `% Δ` despues de Conv | `conversionsDelta` | Tabla |
| `Cos/con` | `costPerConversion` | KPI, grafico y tabla |
| `% Δ` despues de Cos/con | `costPerConversionDelta` | Tabla |
| Rango de fechas del informe | `period` (por mes) | Fecha de corte de Proyecciones |
| `Presupuesto` de campanas habilitadas | `dailyBudget` (por mes) | Presupuesto de Proyecciones |
| `Estado de la campaña` | `status` (por campana) | Proyeccion por campana |
| `Presupuesto` (tipo diario) | `dailyBudget` (por campana) | Proyeccion por campana |

## Palabras clave (informe de palabras clave de busqueda)

| Columna del informe | Campo JSON | Uso |
| --- | --- | --- |
| `Palabra clave` | `keyword` | Fila del cuadro de la campana |
| `Tipo de concordancia` | `matchType` | Debajo de la palabra clave; junto con ella identifica la fila mes a mes |
| `Campaña` | `campaign` | Un cuadro por campana |
| `Grupo de anuncios` | `adGroup` | Una palabra clave en varios grupos se suma en una fila |
| `Estado de palabras clave` | `state` | Guardado (Habilitado / Detenido) |
| `Estado` / `Motivos del estado` | `status` / `reasons` | Columna Estado; "campaña detenida" en todas = campana detenida |
| `Impr.` / `Clics` / `Costo` / `Conversiones` | `impressions` / `clicks` / `cost` / `conversions` | Base de todos los indicadores |
| `% impr. parte sup. búsqueda` | `topShare` (texto, p. ej. `< 10%`) | Columna Perdidas x ranking |
| `% impr. perdidas de la Búsqueda (ranking)` | `lostRank` (texto) | Columna Perdidas x ranking |

CTR, CPC, tasa y costo por conversion no se guardan: se calculan de las sumas. Las filas `Total: ...` se ignoran.

## Archivos clave

- `js/objectives.js`: logica de gasto publicitario, KPIs, grafico y tabla de resultados.
- `js/projections.js`: proyeccion al cierre y simulador de objetivo; lee `AquariusDashboard.snapshot()`.
- `js/keywords.js`: analisis de palabras clave y boton Actualizar (lee las hojas de Drive desde el navegador).
- `data/aquarius-lima-retail-2026.json`: fuente normalizada.
- `data/aquarius-palabras-clave-2026.json`: informe de palabras clave normalizado (`scripts/sync-keywords.py`).
- `scripts/import-aquarius-data.py`: importador CSV/XLSX.
- `scripts/build.js`: build estatico con data Aquarius incrustada.
