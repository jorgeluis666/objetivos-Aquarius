# Mapeo Aquarius Lima Retail 2026

## Objetivo

Adaptar el dashboard original de Amador a Aquarius con lectura de gasto publicitario. El panel conserva la arquitectura estatica del proyecto, pero cambia marca, clave, visual y modelo de datos.

## Identidad

- Marca principal: Aquarius
- Password: `Aquarius2026`
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

## Archivos clave

- `js/objectives.js`: logica de gasto publicitario, KPIs, grafico y tabla de resultados.
- `data/aquarius-lima-retail-2026.json`: fuente normalizada.
- `scripts/import-aquarius-data.py`: importador CSV/XLSX.
- `scripts/build.js`: build estatico con data Aquarius incrustada.
