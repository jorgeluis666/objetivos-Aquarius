# Aquarius | Dashboard Lima Retail 2026

Dashboard de gasto publicitario para Aquarius.

## Acceso

- URL publica: **https://aquarius.limaretail.com** (con clave, ver "Publicacion en aquarius.limaretail.com").
- La clave no esta en el codigo: es el secret `AQ_PAGE_PASSWORD` de GitHub.
- Entrada local: `index.html` (sin clave)
- Build publicado: `dist/index.html`

## Modulo principal

- Titulo: `Gasto Publicitario`
- Subtitulo: `Branding y ventas`
- La sincronizacion (boton Sincronizar, ultimo y proximo barrido, carpetas de Drive) esta en la pildora de la barra
  superior derecha (ver Sincronizacion > Manual, desde el tablero).
- Logica en `js/objectives.js`. Sale del informe de campana de Google Ads (un total por mes,
  `data/aquarius-lima-retail-2026.json`) y del informe de palabras clave
  (`data/aquarius-palabras-clave-2026.json`, tal como lo publica el build).
- **Pestanas de mes**: Enero a Diciembre y **Anual**. Un mes sin informe de campana queda apagado y el punto
  marca el ultimo mes con datos. La eleccion se guarda en `aquarius_selected_month` (`anual` incluido). Si
  falta el informe de un mes entre el primero y el ultimo, un aviso lo dice; tambien avisa las campanas
  excluidas del mes (ver Fuente de datos).
- **Periodo** (`Periodo: 1-31 Agosto 2026`, o `1-1 Octubre 2026 (mes en curso)`) con 8 KPIs: inversion,
  impresiones, clics, CTR, CPC, conversiones, costo por conversion y tasa de conversion (conversiones /
  clics). Los cocientes se recalculan sobre las sumas.
  - Mes cerrado: contra el mes anterior completo. Mes en curso: contra el mes anterior **prorrateado a los
    mismos dias** ("vs Agosto prorrateado a 13 dias"), porque el informe trae un total por mes; CTR, CPC,
    costo y tasa no cambian al prorratear. Cuando llegue el informe por dia y campana (`months[].detail`) y
    cubra esos dias del mes anterior, inversion, clics y conversiones se comparan con el **mismo tramo real**
    ("1-13 Agosto") y las impresiones (que ese informe no trae) siguen prorrateadas; un cociente sale del tramo
    si sus dos sumas son reales (CPC, costo y tasa) y si no, es el del mes anterior completo (CTR). Cada KPI
    dice contra que se compara y la bajada lo resume; cada campana usa su propio tramo. Solo el mes calendario
    anterior: si falta, "Sin mes anterior para comparar".
  - Flecha y color segun si subir es bueno: inversion neutra; CPC y costo por conversion, bajar es bueno.
  - Anual: acumulado de los meses con informe; los KPIs sumables muestran el promedio mensual de los meses
    cerrados en lugar de la variacion.
- Debajo del periodo queda el grafico de la cuenta, el unico lugar con la serie diaria real de impresiones.
- Grafico de lineas con dos vistas, que se eligen con los botones del panel y
  quedan guardadas en `localStorage`:
  - **Mes** (por defecto): evolucion diaria del mes del filtro. Cambia cada vez
    que se cambia de mes. Si el mes no trae serie diaria, el panel lo avisa.
  - **Vision total**: un punto por mes con todo lo que va del ano. El mes del
    filtro se marca con un punto mas grande y un clic en cualquier punto cambia
    el filtro a ese mes.
- Las lineas de inversion y resultados salen punteadas y marcadas `(est.)`
  cuando el mes solo tiene impresiones diarias: son el total del mes repartido
  entre los dias segun las impresiones, no cifras diarias reales.
- En Anual el grafico queda en la vista Mes.
- **Distribucion de inversion por campana**: estado, presupuesto diario, inversion y su %, impresiones, clics,
  CTR, CPC, conversiones, costo por conversion y tasa de conversion, con el total del periodo. En Anual las
  campanas se suman por nombre y el estado y el presupuesto son los del ultimo mes.
- **Un cuadro por campana** (todas son de Busqueda, una SKAG por servicio, con el nombre de `campaignLabel()`):
  - KPIs con variacion: inversion, clics, CTR, CPC, conversiones, costo por conversion y presupuesto diario.
    El subtitulo dice contra que se compara, "Nueva: no corria en ..." o, en Anual, en que meses corrio.
  - Grafico **por mes** del ano, con hueco donde la campana no corrio. Indicadores: inversion y conversiones
    (por defecto), clics, impresiones y costo por conversion (inversion / conversiones del mes, el mismo del
    KPI; un mes sin conversiones queda como hueco). Cada punto lleva su valor (arriba en un pico, abajo en un
    valle; sin etiqueta en los ceros y, si dos chocan, una queda solo en el tooltip); los soles van sin
    decimales salvo montos menores a S/ 10. Con varios indicadores, cada uno en su panel con su escala sobre
    el mismo eje, o con el boton `Un solo cuadro` todos juntos, un color por indicador y cada uno con su escala
    (sin eje: el valor va en el punto).
  - Por dia no se ofrece (no hay serie diaria por campana): queda listo para cuando llegue un informe por dia
    y campana en `months[].detail` (sin impresiones; costo por conversion de cada dia, hueco si no hubo
    conversiones). No hay acumulado del mes: siempre sube y exagera el crecimiento (una vista guardada en
    acumulado vuelve a Por dia).
  - **Palabras clave de la campana** del mes (en SKAG el grupo de anuncios es la campana): conversiones,
    conversiones del mes anterior y variacion ("Nuevo" si no estaba), costo por conversion, inversion y su %
    de la campana, impresiones, clics y CPC. Una palabra clave es su texto mas su concordancia, como en el
    modulo Palabras Clave. Solo se compara con el mes anterior si los dos informes son de mes completo o
    cubren los mismos dias; si no, las columnas de comparacion se ocultan.
  - Se minimiza con la flecha. Indicadores, vista, `Un solo cuadro` y minimizado se recuerdan por campana
    (`aquarius_gasto_campaign_charts`).
- **Ranking de palabras clave del periodo**: por conversiones dentro de cada campana, con la lider marcada
  con una estrella, conversiones del mes anterior y variacion. Cabecera fija, Campana y Palabra clave
  ancladas, filtro por campana, Compacto (`aquarius_gasto_kw_compact`) y Pantalla completa (las pestanas
  de mes entran al panel; `Esc` sale). "Ver analisis completo" abre el modulo Palabras Clave, que sigue
  siendo el analisis a fondo.
- Las palabras clave respetan `keywords.excludeCampaigns` de `data/drive-config.json`.

## Proyecciones

El modulo Proyecciones (pestana del panel lateral) proyecta el cierre del mes con los datos reales de
Gasto Publicitario. No lee el JSON ni Drive por su cuenta: consume el snapshot de solo lectura
`window.AquariusDashboard.snapshot()`:

```js
{ cutoff: '2026-08-31', source: 'Aquarius agosto 2026.csv', year: 2026, lastSync: '...',
  months: [{ id, name, label, cost, clicks, conversions, impressions, dailyBudget, budgetTotal, period, campaigns }] }
```

- **Fecha de corte**: fin del rango del informe de Google Ads (`period.end`, la linea
  "1 de agosto de 2026 - 31 de agosto de 2026" del CSV), nunca posterior a hoy en Lima. El mes proyectado es
  el del corte; si no tiene inversion, el ultimo mes con datos.
- **Proyeccion**: ritmo diario = acumulado / dias con datos; cierre = ritmo x dias del mes. Si el informe
  ya cubre el mes completo, la proyeccion es igual al acumulado y el simulador se desactiva.
- **Indicadores**: Inversion (referencia = presupuesto), Clics y Conversaciones (sin referencia).
- **Presupuesto**: suma de la columna Presupuesto (diario) de las campanas *habilitadas* del informe, por los
  dias del mes. Un presupuesto compartido se cuenta una vez. Es el presupuesto vigente al exportar el CSV, no
  el historico: en meses pasados es solo una referencia.
- Cada `applyData` emite `aquarius:data-ready` y el modulo se recalcula solo; si se abre antes de que
  carguen los datos muestra "Esperando los datos...".

### Simulador de objetivo

El ultimo punto de la linea proyectada es un nodo arrastrable: al moverlo se define el cierre deseado.

- El estado es un solo numero, `factor = cierre objetivo / cierre proyectado`, comun a los tres
  indicadores: el escenario conserva el CPC, el costo por conversacion y la tasa de conversion del mes, asi
  que mover uno mueve los otros dos en la misma proporcion y cambiar de indicador conserva el escenario.
- El cierre objetivo nunca queda por debajo de lo ya realizado (`factor >= dias con datos / dias del mes`).
- Por indicador muestra el cierre objetivo, la diferencia contra la proyeccion, el ritmo diario requerido
  (para inversion, "Presupuesto diario requerido"), el ritmo actual, lo que falta realizar y la brecha contra
  el presupuesto. La cuarta tarjeta resume la inversion adicional o menor y la eficiencia que se conserva.
- Controles: arrastrar el nodo (escritorio), escribir el valor en "<Indicador> al cierre" (obligatorio en
  celular, donde arrastrar desplaza la pagina), "Llevar al presupuesto" y "Restablecer" (o doble clic sobre
  el nodo).
- El simulador se desactiva cuando el informe del mes proyectado ya cubre el mes completo.

### Proyeccion por campana

Un cuadro por campana del mes proyectado (el mismo de la linea de tiempo; hoy, octubre con datos al 1).

- Cada cuadro tiene inversion, clics y conversaciones: real a la fecha de corte, ritmo diario y proyeccion al
  cierre, con el mismo metodo que la proyeccion general (ritmo diario de la campana x dias del mes).
- Presupuesto del mes = presupuesto diario de la campana x dias del mes, con una barra de avance de la
  proyeccion y lo que queda o excede. Es el presupuesto vigente al exportar el CSV.
- Una campana con estado distinto de "Habilitada" (por ejemplo, "Detenida") cierra el mes con lo ya gastado.
- Tambien aparecen las campanas con gasto el mes anterior que aun no salen en el informe del mes, y cada
  cuadro muestra el gasto del mes anterior si su CSV esta cargado.
- Con pocos dias de datos la proyeccion es muy sensible (un dia en cero proyecta cero): el cuadro lo avisa la
  primera semana del mes.

### Informe del mes en curso fuera de Drive

Un informe de campana descargado de Google Ads se puede cargar sin pasar por Drive, con el mismo parser:

```bash
python scripts/sync-drive.py --file "ruta/Informe de campaña.csv"
```

El mes se toma de la linea de rango del informe. Queda en el JSON como cualquier mes y la sincronizacion con
Drive lo conserva hasta que la carpeta traiga un informe del mismo mes, que entonces lo reemplaza. Lo ideal
es actualizar la hoja del mes en la carpeta (`Aquarius GA - <mes> <ano>`) cada vez que cambie.

## Analisis de Palabras Clave

Pestana **Palabras Clave** del panel lateral. Lee el informe de palabras clave de busqueda de Google Ads de la
carpeta de Drive **Google Ads Aquarius Keywords**, una hoja de calculo por mes (`Aquarius KW <mes> <ano>`):

<https://drive.google.com/drive/folders/1bhxYOpSsRq2l8W8BGu_fb99-Ur73DdCO>

- **Filtros**: mes, campana (todas o una) e indicador de tendencia (clics, impresiones, costo, conversiones,
  CTR o costo por conversion). Quedan guardados en `localStorage` (`aquarius_keywords_prefs`).
- **KPIs del mes**: palabras clave (y cuantas convierten), impresiones, clics, costo, conversiones, costo por
  conversion y gasto sin conversiones, con la variacion contra el mes anterior.
- **Un cuadro por campana**, ordenadas por costo, con sus totales y dos vistas:
  - **Detalle del mes**: una fila por palabra clave con estado, impresiones, clics, CTR, CPC, costo,
    conversiones, costo por conversion, % de impresiones perdidas por ranking, una linea de tendencia del
    indicador elegido en todos los meses (punto lleno = mes del filtro) con la variacion contra el mes
    anterior, y una **Lectura**: *Eficiente* (costo por conversion igual o menor al de su campana), *CPA alto*
    (mayor), *Gasta sin convertir* (costo sin conversiones), *Sin clics* o *Sin impresiones*.
  - **Evolucion mensual**: una fila por palabra clave y una columna por mes con el indicador elegido, con
    color por intensidad dentro de la fila y el acumulado del periodo.
- Una palabra clave se identifica por texto y concordancia dentro de su campana; si esta en varios grupos de
  anuncios se suma en una fila. CTR, CPC y costo por conversion se calculan sobre las sumas, como Google Ads.
- La campana se marca "Campaña detenida" cuando todas sus palabras clave traen ese motivo de estado.

### Datos y sincronizacion

- `scripts/sync-keywords.py` recibe cada hoja ya exportada como CSV del Apps Script de Aquarius (la carpeta es
  privada, ver "Carpetas privadas") y escribe
  `data/aquarius-palabras-clave-2026.json`, `data/keywords-manifest.json` y una copia de cada informe en
  `data/csv-backups/keywords/`. El mes sale de la linea de rango del informe ("1 de septiembre de 2026 - ...")
  y, si no esta, del nombre del archivo. Reusa los helpers de `scripts/sync-drive.py`.
- **Todos los dias**: es un paso mas de `.github/workflows/sync-drive.yml` (06:30, 13:30 y 18:30 en Lima). Si cambio algo,
  hace commit y publica el tablero. Cada carpeta se sincroniza aunque la otra falle.
- **Boton Actualizar** (en el filtro): como el navegador ya no puede bajar las hojas privadas, pide el mismo
  barrido del servidor que el boton Sincronizar (`AQ_SYNC_URL`), que trae tambien las palabras clave, y
  muestra el avance en su propio estado. Sin esa URL trae la ultima publicacion. Solo con
  `AQ_DRIVE_API_KEY` incrustada en el build lee Drive desde el navegador y guarda el resultado en
  `localStorage` (`aquarius_keywords_cache`).
- La carpeta y su ID estan en `data/drive-config.json` (`keywords.folderId`).
- **Campanas excluidas**: `keywords.excludeCampaigns` en `data/drive-config.json` lista campanas que no se
  muestran ni se guardan aunque vengan en el informe. Hoy: `Website traffic-Search-33` (palabra clave
  "booking", S/ 4,320.20 en setiembre 2026), creada en un hackeo de la cuenta. Se filtra en la sincronizacion
  diaria, en el boton Actualizar y al mostrar (asi una cache vieja del navegador tampoco la trae). La copia
  cruda del informe en `data/csv-backups/keywords/` la conserva, tal como viene de Drive.
- **Formato de los numeros**: Google Ads exporta con el formato del idioma de la cuenta ("6,79" y "1.247" en
  espanol, "6.79" y "1,247" en ingles) y Sheets con el de su configuracion regional. El importador y el boton
  Actualizar deciden cada informe por la columna Coste y las de porcentaje, que siempre traen decimales. Hasta
  el 20-10-2026 se leian siempre en ingles y el informe de octubre 2026 (en espanol) quedo con el costo x100.
- **Control del costo**: si el costo de las palabras clave de un mes supera en mas de 20% al de sus campanas
  (`data/aquarius-lima-retail-2026.json`), el informe no se importa (`--force` lo importa igual) y, en la
  sincronizacion diaria, no pisa lo que ya habia de ese mes; queda un aviso en Actions.

```bash
python scripts/sync-keywords.py          # sincroniza
python scripts/sync-keywords.py --check  # dice si hay cambios, sin escribir
python scripts/sync-keywords.py --file "Aquarius KW octubre 2026.csv"  # importa un informe local
python scripts/sync-keywords.py --file "...csv" --force  # importa aunque el costo no cuadre
```

**Numeros dañados por Sheets.** Al convertir los CSV a hoja de calculo, Sheets leyo los miles como decimales y
perdio los ceros finales: `1,290` impresiones quedaron como `1,29` y `1,200` como `1,2`. Como un grupo de miles
siempre tiene tres digitos, el parser los completa (`1,29` -> 1290). Con eso las sumas de cada mes cuadran con
la fila "Total: Palabras clave filtradas" del informe (el costo difiere en centimos por el redondeo por fila).
Los costos tipo `01.04` (Sheets los leyo como fechas) se leen como 1.04. No hay que corregir nada a mano. Un CSV
subido sin convertir tambien sirve para la sincronizacion diaria, pero sin API key el boton Actualizar solo lee
hojas de Google Sheets.

## Usuarios y Claves

Directorio de quien tiene la clave del tablero. El acceso es **una sola clave compartida** (el secret
`AQ_PAGE_PASSWORD`, ver "Publicacion en aquarius.limaretail.com"): no hay usuarios de acceso y la clave **nunca**
se guarda en el repo ni en el HTML. La vista lleva nombre, rol, fecha de alta, estado y fecha de baja, mas la
fecha del ultimo cambio de clave.

### Cifrado del directorio

El repo es publico, asi que `data/aquarius-usuarios-2026.json` vive **cifrado**: en claro solo queda `updatedAt`.

- **Exportar** cifra en el navegador con la llave publica `data/aquarius-usuarios-publica.pem` (RSA-OAEP-SHA256
  envuelve una llave AES-256-GCM al azar). Con la publica se puede cifrar, no leer: el tablero no tiene como
  abrir el archivo.
- El build lo descifra con la llave privada (secret **`AQ_USERS_PRIVATE_KEY`**; en local,
  `credentials/aquarius-usuarios-privada.pem`, que esta en `.gitignore`) y lo incrusta en claro como
  `window.AQUARIUS_USUARIOS` dentro del HTML, que a su vez va cifrado con `AQ_PAGE_PASSWORD`.
- Sin la llave privada, o si no corresponde, el build **no falla** (la sincronizacion diaria se sigue publicando):
  solo este modulo sale bloqueado y sin edicion, para no reemplazar el archivo por uno vacio. En Actions queda un
  warning. Un archivo en claro si corta el build.
- `node scripts/usuarios-cifrado.js ver` muestra el directorio descifrado (con la llave privada local).
- `node scripts/usuarios-cifrado.js llaves` genera un par nuevo y vuelve a cifrar el archivo con el (necesita la
  privada actual; la anterior queda en `credentials/aquarius-usuarios-privada.anterior.pem`). Despues: actualizar
  el secret `AQ_USERS_PRIVATE_KEY` y hacer commit de `data/`.
- Guardar un respaldo de la llave privada (por ejemplo, en el gestor de contrasenas): el secret de GitHub no se
  puede volver a leer, y sin la privada el directorio no se puede abrir.
- El borrador del navegador (`localStorage`) esta en claro, igual que lo que muestra el tablero.

Contenido descifrado:

```json
{
  "updatedAt": "2026-10-01T15:04:05.000Z",
  "keyChangedAt": "2026-10-01",
  "users": [
    { "id": "u01", "name": "Nombre Apellido", "role": "cliente", "status": "activo",
      "since": "2026-10-01", "until": "" }
  ]
}
```

- `role`: `cliente`, `equipo` o `admin` (otro valor se lee como `cliente`). `status`: `activo` o `suspendido`.
- `until` (fecha de baja) solo la lleva quien esta suspendido: se pone sola al suspender y se borra al reactivar.
- **Alerta**: si alguien fue suspendido despues de `keyChangedAt` (o sin fecha de baja, o sin cambio de clave
  registrado) todavia conoce la clave, y la vista pide cambiarla. Mismo dia = la clave ya se cambio.
- Se edita como borrador en `localStorage` (`aquarius-usuarios-draft`); **Exportar** descarga
  `aquarius-usuarios-2026.json` ya cifrado, se reemplaza el archivo en `data/`, commit y push a `main`. Un
  borrador hecho sobre otra version del archivo (otro `updatedAt`) se ignora.
- Quitar un acceso = suspender a la persona, cambiar `AQ_PAGE_PASSWORD`, registrar la fecha en "Ultimo cambio
  de clave" y publicar el archivo: ese push vuelve a publicar el tablero con la clave nueva. La vista muestra
  los pasos.
- La fecha del ultimo cambio de `AQ_PAGE_PASSWORD` aparece en GitHub > Settings > Secrets and variables >
  Actions ("Updated ...").

## Generacion de Reporte

Pestana **Generacion de Reporte** del panel lateral: el "Reporte de Publicidad" del mes con el diseño del modelo
de Aquarius (`Modelo Reporte Aquarius`), laminas 16:9 con fondo claro, tarjetas blancas de borde fino y acentos en
azul. El modulo es `js/report-week.js`; sus estilos y los de impresion estan al final de `css/dashboard.css`. El
template es propio de Aquarius: cada tablero de marca tiene el suyo, adaptado por la marca.

| Pagina | Contenido |
| --- | --- |
| Portada | Logo de Lima Retail, "Reporte de Publicidad", cliente (Aquarius Consulting), periodo ("1 – 18 Octubre 2026 \| Google Ads · Search") y fecha de emision. |
| Contenido | Resumen del mes, Campanas, Palabras clave y Conclusiones, con su numero de pagina. |
| Resumen del mes | Inversion, conversiones, costo por conversion, clics, impresiones, CPC medio, CTR y tasa de conversion, con su variacion; clics y conversiones por dia. |
| Rendimiento por campana | Hasta 6 campanas por inversion (coste, clics, conv., costo/conv., CTR), el total y el recuadro "Analisis". |
| Palabras clave que convierten | Hasta 6 terminos por conversiones, recuadro "Clave" y tarjeta "Analisis". |
| Conclusiones del periodo | Tres tarjetas (evolucion del mes, servicios que mandan y lo que no cierra) y, en un mes en curso, la nota de que las metricas se consolidan al cierre. |
| Cierre | Logo y firma de Lima Retail. |

- **De donde salen los numeros:** de Gasto Publicitario, que los expone en `window.AquariusGasto`
  (`js/objectives.js`): el periodo del mes, sus totales, la variacion contra el mes anterior (prorrateado a los
  mismos dias si el mes esta en curso, o su tramo real cuando haya informe por dia; "vs período ant."), las
  campanas y las palabras clave del mes. Cada
  sincronizacion lo actualiza solo; las palabras clave llegan despues (`aquarius:keywords-ready`).
- **Palabras clave:** la misma palabra en varias campanas o con dos concordancias va en una sola fila. Si el costo
  de las palabras no cuadra con el de las campanas (mas de 20% por encima), no se muestra y el pie de la tabla lo
  avisa: hoy el informe de palabras clave trae el costo con los decimales corridos ("15,53" como 1553).
- **Grafico por dia:** usa el informe por dia y campana del mes (`months[].detail`). Mientras no llegue, el grafico
  avisa que falta subirlo.
- **Textos:** la linea del grafico, los analisis, el recuadro "Clave" y las conclusiones vienen propuestos con lo
  que dicen los numeros. Se editan con un clic sobre la lamina (`**texto**` va en negrita) y quedan guardados por
  mes en el navegador (`aquarius_report_notes_v1`); no se publican con el tablero. "Restablecer textos" vuelve a
  los propuestos, sin dialogo de confirmacion.
- **Descargar PDF** abre el dialogo de impresion con las laminas solas, una por hoja de 13.33 x 7.5 in (el tamaño
  del modelo), y el nombre del archivo ya armado. Activar "Graficos de fondo" si el navegador no lo hace solo.

## Leads (CRM de feedback del cliente)

Pestana **Leads** del panel lateral (`js/leads.js`). Una tabla por campana y mes: la plataforma se carga sola y
el cliente completa en las columnas resaltadas lo que de verdad recibio; el tablero calcula los indicadores que
las plataformas no ven.

- **Se habilita solo con campanas de leads o WhatsApp** (`detectObjective`): en Google Ads, Busqueda,
  Maximo rendimiento y Demand Gen (no Shopping, Display ni Video); en Meta Ads, el objetivo Clientes potenciales
  o Mensajes; un nombre con WhatsApp o mensajes va como WhatsApp. Si la marca no tiene ninguna, la pestana no
  aparece. En Aquarius entran sus campanas SKAG de Busqueda.
- **Se cargan solos**, del modulo Gasto Publicitario (`AquariusDashboard.snapshot()`): la inversion y los leads
  que reporta la plataforma. En Google Ads son sus conversiones (contactos); en Meta Ads serian los formularios o
  las conversaciones de WhatsApp, cuando la marca tenga esa data (`platformMonths` es el punto para sumarla).
- **Lo completa el cliente** (columnas resaltadas, con guardado automatico): leads reales, calificados, ventas y
  monto vendido de cada campana en el mes. Vacio = sin dato. Se valida que sean enteros desde 0 y que no haya mas
  calificados que leads ni mas ventas que calificados. En "Todo el ano" la tabla suma los meses y queda de solo
  lectura. La columna Campana queda fija al desplazarse.
- **Indicadores por campana y en total**: coincidencia (leads reales / de la plataforma), costo por lead de la
  plataforma y real, tasa de calificacion y de cierre, costo por calificado, costo por venta y ROAS (monto
  vendido / inversion). Cada cociente usa solo las campanas y meses que tienen ese dato completo, asi la tabla a
  medio llenar no infla los costos; los KPIs dicen cuantas campanas estan completadas.
- **Guardado**: en una hoja de Google privada de la agencia (pestana "Leads por campana", una fila por mes y
  campana), a traves del Web App de `scripts/apps-script/crm-leads.gs`. Nunca pasa por el repositorio publico.
  Sin el Web App conectado, el modulo guarda solo en el navegador y lo avisa ("Modo de prueba").

### Conectar la hoja privada (una sola vez)

1. Crear una hoja de calculo de Google (por ejemplo "Aquarius - CRM de leads") en la cuenta de la agencia.
2. En la hoja: Extensiones > Apps Script, pegar `scripts/apps-script/crm-leads.gs` y guardar.
3. Ejecutar `crearToken` una vez (aceptar los permisos): crea la pestana "Leads por campana" y deja el token en
   el registro de ejecucion.
4. Implementar > Nueva implementacion > Aplicacion web: ejecutar como **Yo**, acceso **Cualquier usuario**.
   Copiar la URL que termina en `/exec`.
5. En GitHub > Settings > Secrets and variables > Actions, crear `AQ_CRM_URL` (la URL) y `AQ_CRM_TOKEN` (el
   token). El siguiente deploy los incrusta dentro del HTML cifrado.

"Cualquier usuario" deja la URL abierta, pero sin el token responde "No autorizado"; el token solo existe en el
secret y dentro del HTML cifrado con `AQ_PAGE_PASSWORD`. Para cambiarlo: ejecutar otra vez `crearToken` y
actualizar `AQ_CRM_TOKEN`. Si se edita el script, hay que publicar una version nueva de la implementacion
(Implementar > Gestionar implementaciones) para que la URL use el codigo nuevo.

## Fuente de datos

El tablero se arma desde la carpeta de Google Drive **02 Google Ads**:

<https://drive.google.com/drive/folders/1MBCTlit_mxS6wOXyGsXZL3HcS5SPTEIk>

Un informe de campana de Google Ads por mes, como hoja de calculo de Google
(`Aquarius GA - <mes> <ano>`) o como CSV, con Coste, Impr., Clics, CTR,
Conversiones, Coste/conv., Presupuesto, Estado de la campana y Tipo de campana.
Las hojas se exportan a CSV al sincronizar y los numeros se leen en formato
espanol (`99,46` y `1.894`) o ingles (`99.46` y `1,894`). Para agregar un mes
basta con subir su informe a esa carpeta: la sincronizacion lo detecta por el
rango de fechas del archivo y lo suma a las pestanas de mes. La carpeta esta en
`data/drive-config.json` (`folderId`, `folderName`, `folderUrl`).

- **Subcarpetas** (Keywords, Segmentacion, Terminos de busqueda): la sincronizacion
  las ignora. Un archivo que no se puede bajar no frena al resto: su mes queda como
  estaba.
- **Solo informes de campana** (un total por campana): un informe con columna Dia o
  que repite campanas (por dia o por anuncio) se descarta y el mes queda como estaba.
  Sin fila Total, los totales del mes son la suma de sus campanas. Si dos hojas traen
  el mismo mes, gana la que llega mas lejos en el mes.

- **Campanas excluidas**: `excludeCampaigns` en `data/drive-config.json` lista
  campanas del informe que no entran al tablero. Hoy: `Website traffic-Search-33`
  (S/ 4,320.20 en setiembre 2026), que no es una campana de Aquarius. No se guarda
  como campana, su gasto se descuenta de los totales del mes y queda anotada en
  `months[].excluded`; Gasto Publicitario avisa en el mes que la tenia. La copia
  cruda del informe en `data/csv-backups/drive/` la conserva, tal como viene de Drive.

La fuente normalizada que consume el tablero sigue siendo
`data/aquarius-lima-retail-2026.json`, agrupada por mes:

```json
{
  "defaultMonth": "2026-08",
  "drive": { "lastSync": "2026-10-01T17:00:25Z", "discovery": "publica", "files": [] },
  "months": [
    {
      "id": "2026-08",
      "label": "Agosto 2026",
      "sourceFile": "Aquarius agosto 2026.csv",
      "records": [ /* una fila por campana, con impresiones y % de variacion */ ],
      "totals": { "cost": 1854.85, "impressions": 33828, "clicks": 2325 },
      "period": { "start": "2026-08-01", "end": "2026-08-31" },
      "dailyBudget": 53.6,
      "daily": { "rows": [ { "date": "2026-08-01", "impressions": 1234 } ] }
    }
  ]
}
```

Los campos `*Delta` de cada campana (variacion contra el mes anterior cargado) los calcula la
sincronizacion; el tablero no los usa: compara con el mes calendario anterior (ver Modulo principal). `period` es el rango de fechas del informe y
`dailyBudget` la suma de presupuestos diarios de las campanas habilitadas (ver
Proyecciones); cada campana trae ademas su `status`, su `dailyBudget` y su `type` (Tipo de campana); `excluded` lista las campanas descontadas del mes. Las series diarias (`daily`) son independientes: la
sincronizacion no las toca.

## Sincronizacion

### Automatica, todos los dias

`.github/workflows/sync-drive.yml` corre todos los dias a las **06:30, 13:30 y 18:30 de Lima**,
baja la carpeta, actualiza `data/` y, solo si algo cambio, hace commit y pide la
publicacion del tablero. Tambien se puede lanzar a mano desde
**Actions > Sincronizar Drive > Run workflow**.

GitHub atrasa varias horas los workflows programados (en octubre de 2026 el de las
06:20 corria entre las 10:00 y las 15:20), asi que la hora la fija un activador de
**Google Apps Script** que lanza el workflow al momento
(`scripts/apps-script/sincronizar-aquarius.gs`; Apps Script lo corre dentro de unos
15 minutos de cada horario). El workflow ya no tiene cron de GitHub: atrasaba varias
horas y repetia el barrido. Si el activador falla, Apps Script avisa por correo y
la pildora del tablero pasa a ambar a las 30 horas sin barrido. Instalacion, una
sola vez:

1. En GitHub > Settings > Developer settings > Personal access tokens > Fine-grained
   tokens, crear un token solo para el repositorio `objetivos-Aquarius` con el
   permiso **Actions: Read and write**. Anotar su vencimiento para renovarlo.
2. En <https://script.google.com>, proyecto nuevo: pegar
   `scripts/apps-script/sincronizar-aquarius.gs` y poner la zona horaria del proyecto
   en (GMT-05:00) Lima.
3. Configuracion del proyecto > Propiedades del script: `GITHUB_TOKEN` = el token. El
   token no va en el codigo ni en el repo.
4. Ejecutar `instalarActivador` una vez (aceptar los permisos) y luego
   `sincronizarAquarius` para probar: en GitHub > Actions aparece la ejecucion.

La pildora de la barra superior muestra el ultimo barrido real (lo lee de la API
publica de GitHub, sin credenciales) y se pone ambar si fallo o si pasaron mas de
30 horas sin uno.

Para correrla en local:

```bash
python scripts/sync-drive.py          # sincroniza
python scripts/sync-drive.py --check  # dice si hay cambios, sin escribir
```

El script encuentra los archivos en este orden: Apps Script de Aquarius (si hay
`AQ_DRIVE_SCRIPT_URL` y `AQ_DRIVE_READ_KEY`), API de Drive (si hay API key),
vista publica de la carpeta (solo si siguiera compartida por enlace) y, como
ultimo recurso, `data/drive-manifest.json`.

### Carpetas privadas

La carpeta de campanas ("02 Google Ads") y la de palabras clave no se comparten por enlace (sus IDs estan en
este repositorio publico). El barrido las lee con la accion `leer` del mismo Web App del boton Sincronizar
(`scripts/apps-script/sincronizar-aquarius.gs`, proyecto "Barrido diario Aquarius"), que corre con la cuenta
de Lima Retail:

- Solo responde con la clave `LECTURA_CLAVE` de las Propiedades del script, enviada por POST (nunca en la
  URL), y solo para las carpetas de `CARPETAS_LECTURA`. Devuelve cada hoja exportada como CSV; de
  "02 Google Ads" solo trae sus archivos, no las subcarpetas.
- En GitHub la clave es el secret `AQ_DRIVE_READ_KEY` y la URL es la de `AQ_SYNC_URL`
  (`sync-drive.yml` la pasa como `AQ_DRIVE_SCRIPT_URL`).
- Al editar el script hay que publicar una version nueva de la misma implementacion (Implementar >
  Gestionar implementaciones > lapiz > Version: Nueva version), para que la URL no cambie, y ejecutar
  `probarLectura` una vez para aceptar el permiso de Drive.
- De la carpeta de reglas («08 Reglas y Optimizacion») solo devuelve las cinco columnas de
  `COLUMNAS_PERMITIDAS`: la «Instruccion Estrategica para la IA» de esa hoja esta escrita para la
  agencia y no sale de LR Suite, asi que el recorte se hace en el Apps Script y no aqui.
- Para probar en local: `AQ_DRIVE_SCRIPT_URL=<url> AQ_DRIVE_READ_KEY=<clave> python scripts/sync-drive.py --check`
  (y lo mismo con `--reglas --check` para la hoja del ciclo mensual).

### Manual, desde el tablero

La sincronizacion vive en la barra superior derecha. La pildora dice hasta que dia
llegan los datos y la hora del ultimo barrido; al pulsarla abre el detalle: datos,
meses cargados, ultimo y proximo barrido, cuando cambiaron los datos, las dos carpetas de Drive (con
enlace) y lo que falta subir. A su lado va el boton **Sincronizar** (en Gasto
Publicitario y Proyecciones; Palabras Clave tiene su propio boton Actualizar). Si
la sincronizacion falla, la pildora se pone ambar y el detalle dice por que. Su
comportamiento depende de `data/drive-config.json`:

- **Con el Web App del barrido** (`AQ_SYNC_URL`, el que manda sobre los demas): el boton le pide a
  `scripts/apps-script/sincronizar-aquarius.gs`, publicado como aplicacion web, el mismo barrido programado tres veces al día
  (`sync-drive.yml`). Sigue la corrida por la API publica de GitHub: si Drive trajo cambios espera la
  publicacion y recarga; si no, avisa que el tablero ya estaba al dia. Como mucho un barrido cada 4
  minutos para todos los visitantes. La URL llega por el secret `AQ_SYNC_URL` y solo queda dentro
  del HTML cifrado.
- **Sin el Web App ni `apiKey`**: el boton trae la ultima publicacion. Las carpetas
  son privadas, asi que el navegador ya no puede bajar las hojas por su cuenta.
- **Con `apiKey`**: ademas lista la carpeta, asi que encuentra las hojas nuevas al
  instante, y se sincroniza solo cuando pasaron `autoSyncHours` horas (24 por
  defecto) desde la ultima vez.

Para habilitar la sincronizacion desde el navegador hace falta una **clave de
API de Google** (Google Cloud > APIs y servicios > Credenciales > Clave de API),
con la **Google Drive API** habilitada y la clave restringida a
`https://aquarius.limaretail.com/*`. La clave no va en el repo: se guarda en el
secret **`AQ_DRIVE_API_KEY`** y `scripts/build.js` la incrusta en el HTML
cifrado al publicar. Para probar en local se puede poner en `apiKey` dentro de
`data/drive-config.json` (sin commitearla).

Las carpetas ya no se comparten por enlace: el barrido las lee por el Apps Script
(ver "Carpetas privadas").

## Importar archivos sueltos

`scripts/import-aquarius-data.py` sigue disponible para cargar un CSV o Excel
que no este en Drive, por ejemplo las series diarias de impresiones:

```bash
python scripts/import-aquarius-data.py "ruta/al/archivo.csv" --month 2026-09
```

## Notificaciones y alerta de Google Ads

El mismo sistema de alertas de Royal Baby, con los numeros de Google Ads. Tiene dos caras y las dos
salen del mismo calculo (`js/alertas-core.js`): el ultimo mes con inversion, su ritmo diario y el
cierre proyectado (ritmo x dias del mes, igual que Proyecciones), frente a dos referencias: el
**presupuesto del mes** (el presupuesto diario de las campanas por los dias del mes, como en
Proyecciones) y el **mes anterior**, llevado a mes completo cuando su informe quedo a medias.

**La campanita de la barra superior** (`js/notificaciones.js`, a la izquierda de la pildora de
sincronizacion) muestra los avisos del mes y, con un clic, abre el modulo donde se ve ese numero:

| Aviso | Cuando aparece |
| --- | --- |
| Cierre del gasto vs presupuesto | hay presupuesto diario; rojo si el cierre pasa el 115 %, ambar sobre 105 % o por debajo del 80 % |
| Conversaciones al cierre vs mes anterior | rojo bajo el 80 %, ambar bajo el 95 % |
| Costo por conversacion vs mes anterior | ambar si sube mas de 10 %, rojo sobre 30 % |
| Campanas que gastan sin conversaciones | alguna campana del mes gasto y no convirtio |
| La campana que sostiene el mes | informativo: cuanta conversacion concentra y a que costo |

**El Ciclo Mensual de Analisis y Optimizacion** (`data/reglas.json`) decide en que orden se leen
esos avisos. Las cuatro reglas dicen, por el dia del mes que cubre el informe, en que semana del
ciclo vamos; con eso el panel encabeza con una linea de contexto («Semana 3 del mes») y sube
primero el aviso que toca mirar esa semana:

| Semana | Acción | Qué sube primero |
| --- | --- | --- |
| 1 | `alerta_pacing` | el cierre del gasto frente al presupuesto |
| 2 | `pausar_fatigados` | las campañas que gastan sin resultado |
| 3 | `alerta_overlap` | la campaña que concentra el resultado |
| 4 | `escalar_presupuesto` | el presupuesto que va a quedar sin usar |

Ningun aviso se esconde: el que no toca esa semana baja de puesto, nada mas. La hoja
`Reglas_Nexus_Aquarius` de la carpeta «08 Reglas y Optimizacion» del Drive de la marca es la raiz
editable de estas reglas: lo que el equipo cambie ahi llega al tablero en el siguiente barrido.
`scripts/sync-drive.py --reglas` la lee con el Apps Script de la marca (esa carpeta tiene los
permisos restringidos al equipo, asi que no se puede leer por la vista publica de Drive) y escribe
`data/reglas.json`, que el workflow commitea solo cuando cambia una regla. La **instruccion
estrategica** de esa hoja no viaja aqui: la recorta el propio Apps Script y se queda en LR Suite.
Sin `data/reglas.json` los avisos salen como siempre, sin ordenar y sin la linea de contexto.

La ruedita del panel abre la lista de **correos de la alerta** (nombre opcional y correo, hasta 25).
La lista vive en el Web App de `scripts/apps-script/alertas-destinatarios.gs` (propiedades del
script, no en el repo): el tablero publicado la edita con la URL y la clave que el build deja dentro
del HTML cifrado, y la alerta la lee antes de cada envio. Mientras nadie guardo una lista, o si el
Web App no responde, se usan los destinatarios de `data/alertas-config.json`; una lista guardada
vacia no envia nada.

**El correo** (`scripts/alertas.js`, con la estetica del tablero) sale por
`.github/workflows/alertas-semanales.yml`:

- **Lunes a las 6:00 p. m. de Lima**, una vez por semana.
- **Despues de cada barrido de Drive** (workflow "Sincronizar Drive"), solo si cambiaron las cifras
  del mes desde el ultimo envio: se compara una huella guardada en `data/alertas-envios.json`.
- A mano: `Actions > Alerta semanal de Google Ads > Run workflow`, con «Simulacion» para no enviar y
  «Reenviar» para mandarla aunque ya haya salido esa semana.
- En local, sin enviar nada: `node scripts/alertas.js --preview correo.html` escribe el correo en un
  archivo y `node scripts/alertas.js --dry-run` muestra a quien iria.

El correo lee `data/aquarius-lima-retail-2026.json`, el mismo archivo que publica el tablero, asi que las dos vistas
muestran los mismos numeros.

**Puesta en marcha** (una vez): ejecutar `instalar()` en el Web App de
`scripts/apps-script/alertas-destinatarios.gs`, implementarlo como aplicacion web con acceso
«Cualquier persona» y crear los secrets:

| Secret | Para que |
| --- | --- |
| `AQ_ALERTAS_URL`, `AQ_ALERTAS_TOKEN` | la lista de correos que se edita en el tablero (build y alerta) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | cuenta alertas@limaretail.com del hosting, que tambien es el remitente |
| `RESEND_API_KEY` | alternativa si no hay SMTP |
| variable `DASHBOARD_URL` | opcional, si el enlace del correo debe ser otro que el de `data/alertas-config.json` |

## Build

```bash
npm.cmd run build
```

El resultado se genera en `dist/`: `index.html` (CSS, JS y datos incrustados), `assets/` y `CNAME`.
Nada mas: `data/` (incluido `data/csv-backups`), `scripts/` y `docs/` no se publican.

Con `AQ_PAGE_PASSWORD=<clave> npm run build` el `index.html` sale cifrado, como en GitHub Pages.

## Publicacion en aquarius.limaretail.com (GitHub Pages)

URL publica: **https://aquarius.limaretail.com**. Cada push a `main` la actualiza sola
(`.github/workflows/deploy-pages.yml`); no hay que volver a tocar el DNS ni la configuracion de Pages.

- Pages publica con Actions (sube `dist/`), asi que el dominio propio se configura en **Settings > Pages >
  Custom domain** y queda guardado en el repo. Ademas `CNAME` (raiz) lleva el dominio y `build.js` lo copia a
  `dist/`, igual que en los demas tableros de la agencia.
- DNS en Banahosting (cPanel > Zone Editor > `limaretail.com`): registro **CNAME** `aquarius` ->
  `jorgeluis666.github.io`. La URL vieja `https://jorgeluis666.github.io/objetivos-Aquarius/` redirige (301) al dominio.
- **Clave:** Pages no tiene Basic Auth, asi que `scripts/build.js` cifra el tablero completo (datos y JS) con
  AES-256-GCM y una llave PBKDF2-SHA256 (600 000 iteraciones) derivada del secret **`AQ_PAGE_PASSWORD`**.
  `deploy/pages-gate.html` pide la clave y lo descifra en el navegador; sin ella el HTML publicado no revela
  nada. Si falta el secret, o si `dist/index.html` sale sin cifrar, el workflow falla en vez de publicar.
  La pantalla usa el mismo diseno que el acceso de los demas tableros de la agencia (`auth-login.js`, fondo
  `assets/login-bg.jpg`), pero la clave no esta escrita en el codigo.
- Es una sola clave compartida. Como el HTML cifrado es publico, se puede atacar sin limite de intentos: usar
  una clave larga y aleatoria (16+ caracteres). Para cambiarla: editar el secret `AQ_PAGE_PASSWORD` y volver a
  ejecutar el workflow (Actions > Publicar en GitHub Pages > Run workflow).
- Tras entrar, la llave queda en `sessionStorage` de esa pestana para no pedir la clave al recargar; cada deploy
  genera una sal nueva, asi que despues de publicar se vuelve a pedir. Una pestana nueva tambien la pide.
- Las preferencias (mes elegido, vista y panel minimizado) viven en `localStorage`
  de cada dominio: las de `github.io` no pasan a `aquarius.limaretail.com`.
- El repo es publico: lo que esta en `data/` (y el historial de git, que incluye la clave anterior) sigue
  siendo visible en GitHub aunque el sitio vaya con clave. La excepcion es el directorio de Usuarios y Claves,
  que va cifrado (ver "Cifrado del directorio").


Nexus extrae Google Ads a las 06:00, 13:00 y 18:00 (America/Lima).
Los tres activadores de Apps Script barren Drive aproximadamente media hora después.
El cambio de mes crea las hojas en las carpetas existentes; los meses ya configurados conservan sus enlaces.
