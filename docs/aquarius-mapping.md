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

## Archivos clave

- `js/objectives.js`: logica de gasto publicitario, KPIs, grafico y tabla de resultados.
- `js/projections.js`: proyeccion al cierre y simulador de objetivo; lee `AquariusDashboard.snapshot()`.
- `data/aquarius-lima-retail-2026.json`: fuente normalizada.
- `scripts/import-aquarius-data.py`: importador CSV/XLSX.
- `scripts/build.js`: build estatico con data Aquarius incrustada.
