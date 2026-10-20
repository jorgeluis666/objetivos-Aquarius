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
| `Tipo de campaña` | `type` (por campana) | Guardado (hoy todas son de Busqueda) |
| `Prom. CPC` / `CPC medio` | `cpc` | Guardado; el CPC se recalcula como inversion / clics |
| Campanas de `excludeCampaigns` | `excluded` (por mes) | No entran como campana; su gasto sale de los totales y Gasto Publicitario lo avisa |

Los informes llegan como hoja de calculo de Google (`Aquarius GA - <mes> <año>`, carpeta Google files - Aquarius)
o como CSV; los numeros se leen en formato espanol (`99,46`, `1.894`) o ingles (`99.46`, `1,894`).

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

## Leads (CRM de feedback, hoja privada)

| Columna de la hoja | Uso |
| --- | --- |
| `id` | Identidad del lead (la crea el tablero o el Web App) |
| `fecha` | Mes del lead (AAAA-MM-DD) |
| `plataforma` / `campana` | Google Ads, Meta Ads u Otro; nombre tecnico de la campana del informe |
| `canal` | Formulario web, WhatsApp, Llamada, Correo, Otro |
| `estado` | Nuevo, Contactado, Calificado, Cotizado, Venta, Perdido, No valido |
| `monto` | Monto vendido (solo en Venta) |
| `referencia` / `nota` | Texto corto, sin telefonos ni correos |
| `creado` / `actualizado` | Marcas de tiempo del Web App |

Los leads no se guardan en `data/`: viven en la hoja privada (`scripts/apps-script/crm-leads.gs`).

## Archivos clave

- `js/objectives.js`: Gasto Publicitario: pestanas de mes y Anual, periodo con KPIs, grafico de la cuenta,
  distribucion y cuadro por campana y ranking de palabras clave; expone `AquariusDashboard` (`snapshot()`).
- `js/projections.js`: proyeccion al cierre y simulador de objetivo; lee `AquariusDashboard.snapshot()`.
- `js/leads.js`: CRM de feedback del cliente (pestana Leads) e indicadores de leads reales por campana.
- `scripts/apps-script/crm-leads.gs`: Web App de la hoja privada donde se guardan los leads.
- `js/keywords.js`: analisis de palabras clave y boton Actualizar (lee las hojas de Drive desde el navegador).
- `data/aquarius-lima-retail-2026.json`: fuente normalizada.
- `data/aquarius-palabras-clave-2026.json`: informe de palabras clave normalizado (`scripts/sync-keywords.py`).
- `scripts/import-aquarius-data.py`: importador CSV/XLSX.
- `scripts/build.js`: build estatico con data Aquarius incrustada.
