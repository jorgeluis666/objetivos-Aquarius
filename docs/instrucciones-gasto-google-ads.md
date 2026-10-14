# Gasto Publicitario de Aquarius (Google Ads)

Especificación del módulo **Gasto Publicitario** (`view-obj`, `js/objectives.js`): qué muestra, cómo calcula y qué
decisiones salen de la data de Aquarius. Implementado en la versión 1.13.0.

## 1. Reglas que no se negocian

1. **Diseño de Aquarius**: tokens de `css/dashboard.css` (`--brand:#0284c7`, `--brand-soft`, `--brand-text`, `--ink`,
   `--muted`, `--border`, `--green*`), sus clases (`.panel`, `.panel-head`, `.month-tab`, `.data-table`,
   `.campaign-name`, `.status-pill`, `.objective-pill`, `.no-data`, `.table-empty`, `.empty-state`) y su formato de
   números (`fmtMoney` = `S/ 1,234.56`, `fmtCount`, `fmtDecimal`, `fmtPercent`; sin dato es "-", no cero). Las clases
   propias del módulo empiezan con `gasto-`.
2. **No romper `window.AquariusDashboard`** (`getData`, `applyData`, `render`, `snapshot`) ni el evento
   `aquarius:data-ready`: los usan `js/projections.js` y `js/drive-sync.js`. `snapshot()` devuelve lo mismo que antes
   del módulo (ver README > Proyecciones).
3. **No tocar** los módulos Proyecciones, Palabras Clave ni Usuarios y Claves.
4. Commitear solo lo propio y preguntar antes de hacer push: el push a `main` publica aquarius.limaretail.com.
5. Respetar `keywords.excludeCampaigns` de `data/drive-config.json` en todo lo que lea palabras clave.
6. Subir la versión del cache (`?v=` en `index.html` y `version` en `package.json`) al publicar.

## 2. La data de Aquarius y lo que se decide por ella

| Data | Decisión |
| --- | --- |
| Todas las campañas son de **Búsqueda**, una campaña SKAG por servicio | Los cuadros van **por campaña (servicio)**, con el nombre de `campaignLabel()`. |
| Solo **Conversiones** (contactos), sin valor de conversión | El KPI de resultado es **Conversiones** y su costo, **Costo por conversión**. Se agrega **Tasa de conversión** (conversiones / clics). |
| Serie diaria **solo de impresiones y a nivel cuenta** (`months[].daily.rows`); informe de palabras clave **por mes** (`data/aquarius-palabras-clave-2026.json`); no hay datos de anuncios | Los cuadros por campaña muestran el gráfico **Por mes**. En SKAG el grupo de anuncios es la campaña: el detalle de cada cuadro son sus **palabras clave**, y el ranking del periodo es de **palabras clave**. |
| Cada campaña trae `status` y `dailyBudget` | Estado y presupuesto diario en la distribución y en cada cuadro. |

Los informes de campaña están en la carpeta de Drive **Google files - Aquarius** (`folderId` en
`data/drive-config.json`), una hoja de cálculo por mes (`Aquarius GA - <mes> <año>`) con los números en formato
español. Estado de la data al 14 de octubre de 2026 (el tablero avisa los huecos, no los inventa):

- Enero a Setiembre completos; **Octubre en curso**, del 1 al 13.
- Setiembre traía la campaña **Website traffic-Search-33** (S/ 4,320.20), que no es de Aquarius: está en
  `excludeCampaigns`, su gasto se descuenta del mes y el tablero lo avisa (`months[].excluded`).
- El estado y el presupuesto de cada campaña son los vigentes al exportar: en meses viejos son solo una referencia.
- El mes sale siempre del rango del informe, nunca del nombre del archivo.

## 3. Estructura (en este orden, dentro de `view-obj`)

### 3.0 Sincronización (barra superior derecha)
Todo lo de la sincronización va en la píldora de la barra superior derecha, que abre el detalle: datos (rango del
último mes), meses cargados, último barrido (de la API pública de GitHub) y el próximo a las 10:00 de Lima, cuándo
cambiaron los datos, carpetas de Drive de campañas y de palabras clave (con
enlace) y lo que falta subir. A su lado, el botón **Sincronizar** (`#sync-now`, lo maneja `js/drive-sync.js`; sus
mensajes van en `#sync-status` dentro del detalle y un error pone la píldora en ámbar). La vista no tiene otra franja
de sincronización.

### 3.1 Pestañas de mes y Anual
Enero a Diciembre más **Anual**, con `.month-tab`. Mes sin informe = deshabilitado; punto en el último mes con datos.
El mes elegido se guarda en `aquarius_selected_month` (el valor `anual` incluido). Si falta el informe de un mes entre
el primero y el último con datos, un aviso lo dice.

### 3.2 Periodo con KPIs (una sola tarjeta)
- Título `Periodo: 1-31 Agosto 2026` o `Periodo: 1-1 Octubre 2026 (mes en curso)`; el rango sale de `period`.
- **8 KPIs**: Inversión, Impresiones, Clics, CTR, CPC prom., Conversiones, Costo por conversión, Tasa de conversión.
  Los cocientes se recalculan sobre las sumas.
- **Comparación**: mes cerrado contra el mes anterior completo; mes en curso contra el mes anterior **prorrateado a
  los mismos días** ("vs Agosto prorrateado a 13 días"), porque el informe de campaña llega con un total por mes. CTR,
  CPC, costo por conversión y tasa no cambian al prorratear. Solo el mes calendario anterior: si falta,
  "Sin mes anterior para comparar".
- Variación con flecha y color según si subir es bueno: Inversión neutra; CPC y costo por conversión, bajar es bueno;
  el resto, subir es bueno.
- **Anual**: acumulado de los meses con informe; los KPIs sumables muestran el promedio mensual de los meses cerrados
  en lugar de la variación.
- Debajo de esta tarjeta queda el gráfico de la cuenta (Día / Semana / Mes, con las líneas `(est.)`): es el único
  lugar con la serie diaria real de impresiones. En Anual queda en la vista Mes.

### 3.3 Distribución de inversión por campaña
Tabla con: Campaña (`campaignLabel`, y el nombre técnico en chico), Estado (`.status-pill`), Presupuesto diario,
Inversión, % de la inversión (barra), Impresiones, Clics, CTR, CPC, Conversiones, Costo por conversión, Tasa de
conversión. Fila **Total del periodo**. En Anual, las campañas se suman por nombre y el estado y el presupuesto son
los del último mes.

### 3.4 Un cuadro por campaña (debajo de la distribución, en el mismo panel)
- Título `Campaña <servicio>` con el % de la inversión y el estado; subtítulo con el periodo y la comparación (o
  "Nueva: no corría en …", o en Anual "Activa en Ene, Feb…").
- **KPIs** con variación: Inversión, Clics, CTR, CPC, Conversiones, Costo por conversión, Presupuesto diario.
- **Gráfico Por mes** (12 meses del año, hueco donde la campaña no corrió) con chips de indicadores: Inversión (por
  defecto), Conversiones (por defecto), Clics, Impresiones. Con varios indicadores, cada uno en su panel apilado sobre
  el mismo eje x; nunca dos escalas en el mismo panel. El mes del periodo se marca con su valor.
  "Acumulado del mes" y "Por día" no se ofrecen: no hay serie diaria por campaña (ver 4.2).
- **Palabras clave de la campaña**: del mes del periodo, una fila por palabra clave + concordancia (misma identidad
  que el módulo Palabras Clave): Conversiones, Conversiones del mes anterior y Variación ("Nuevo" si no estaba), Costo
  por conversión, Inversión, % de la campaña, Impresiones, Clics, CPC. Si el mes no tiene informe de palabras clave,
  el cuadro lo dice. Solo se compara cuando los dos informes son de mes completo o cubren los mismos días; si no, las
  columnas de comparación se ocultan.
- Botón para **minimizar**. Indicadores, vista y minimizado se recuerdan por campaña en
  `aquarius_gasto_campaign_charts`.

### 3.5 Ranking de palabras clave del periodo
Cabecera fija, columnas Campaña y Palabra clave ancladas, estrella en la líder de cada campaña, filtro por campaña,
**Compacto** (`aquarius_gasto_kw_compact`) y **Pantalla completa** (las pestañas de mes se mueven al panel; `Esc`
sale). Columnas: Campaña, Palabra clave (con la concordancia), Conversiones, Mes anterior, Variación, Costo por
conversión, Inversión, Impresiones, Clics, CTR, CPC. "Ver análisis completo" lleva a la pestaña Palabras Clave, que
sigue siendo el análisis a fondo (lectura, evolución mensual). El módulo lee `aquarius-palabras-clave-2026.json` tal
como lo publica el build, sin duplicar la lectura ni la caché de Palabras Clave.

## 4. Datos

### 4.1 Lo que ya alcanza
`data/aquarius-lima-retail-2026.json` (campañas por mes con `status`, `dailyBudget` y `type`, `period`, `daily`) y
`data/aquarius-palabras-clave-2026.json` (palabras clave por mes) traen todo. `scripts/build.js` incrusta los dos en el
HTML publicado.

### 4.2 Mejoras opcionales (no bloquean)
- `Tipo de campaña` ya se guarda como `type` (hoy, "Buscar" en todas). Si se suman campañas que no sean de Búsqueda,
  los cuadros podrían agruparse por tipo.
- Si se empieza a subir el **informe por día y palabra clave** (Día, Campaña, Grupo de anuncios, Anuncio, URL final,
  Palabra clave de la búsqueda, Costo, Clics, Conversiones), leerlo en `scripts/sync-drive.py` (detectar por
  encabezado, sumar por día × campaña) y guardarlo en `months[].detail` como
  `{ table: { columns: ['d', 'campaign', 'cost', 'clicks', 'conversions'], rows: [[día, índice de campaña, …]], campaigns: [nombres] } }`.
  Con eso los cuadros ya ofrecen Acumulado del mes y Por día (`detailRows` en `js/objectives.js`).

## 5. Verificación antes de commitear
- Agosto (mes cerrado vs julio completo), Octubre (mes en curso sin mes anterior), Enero (sin mes anterior) y Anual;
  comparar los totales con el informe de campaña del mes.
- Chips de un indicador y de varios, minimizar, filtro del ranking, Compacto, Pantalla completa y `Esc`.
- **Proyecciones sigue igual** (mismo `snapshot()` y mismo cierre proyectado) y la pestaña Palabras Clave no cambia.
- Botón Sincronizar / `applyData`: el módulo se repinta con la data nueva.
- 375 px de ancho sin scroll horizontal de la página (las tablas sí scrollean dentro de su panel).
- Sin errores en la consola; `npm run build` y abrir `dist/index.html` (sin clave en local).
