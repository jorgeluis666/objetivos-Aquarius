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
- KPIs: coste total, CTR, clics, conversiones y costo por conversion.

## Proyecciones

El modulo Proyecciones (pestana del panel lateral) proyecta el cierre del mes con los datos reales de
Gasto Publicitario. No lee el JSON ni Drive por su cuenta: consume el snapshot de solo lectura
`window.AquariusDashboard.snapshot()`:

```js
{ cutoff: '2026-08-31', source: 'Aquarius agosto 2026.csv', year: 2026, lastSync: '...',
  months: [{ id, name, label, cost, clicks, conversions, impressions, dailyBudget, budgetTotal, period, campaigns }] }
```

- **Fecha de corte**: fin del rango del informe de Google Ads (`period.end`, la linea
  "1 de agosto de 2026 - 31 de agosto de 2026" del CSV), nunca posterior al dia de la ultima sincronizacion.
  El mes proyectado es el del corte; si no tiene inversion, el ultimo mes con datos.
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
- Con los datos de hoy el simulador queda desactivado hasta que llegue a Drive el informe de un mes en curso
  (por ejemplo, del 1 al 17 de octubre).

## Fuente de datos

El tablero se arma desde la carpeta de Google Drive **Aquarius Campanas**:

<https://drive.google.com/drive/folders/1o4Ve9CuoQLuH0mDP6qDi07EvPEISAOvA>

Un CSV por mes, tal como lo exporta Google Ads (`Aquarius <mes> <ano>.csv`,
informe de campana con Costo, Impr., Clics, CTR, Conversiones y Costo/conv.).
Para agregar un mes basta con subir su CSV a esa carpeta: la sincronizacion lo
detecta por el rango de fechas del archivo y lo suma al filtro.

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

Los `% Δ` de la tabla se calculan comparando cada campana con la del mes
anterior, no vienen en el CSV. `period` es el rango de fechas del informe y
`dailyBudget` la suma de presupuestos diarios de las campanas habilitadas (ver
Proyecciones). Las series diarias (`daily`) son independientes: la
sincronizacion no las toca.

## Sincronizacion

### Automatica, todos los dias

`.github/workflows/sync-drive.yml` corre a las 11:20 UTC (06:20 en Lima), baja
la carpeta, actualiza `data/` y, solo si algo cambio, hace commit y pide la
publicacion del tablero. Tambien se puede lanzar a mano desde
**Actions > Sincronizar Drive > Run workflow**.

Para correrla en local:

```bash
python scripts/sync-drive.py          # sincroniza
python scripts/sync-drive.py --check  # dice si hay cambios, sin escribir
```

El script encuentra los archivos en este orden: API de Drive (si hay API key),
vista publica de la carpeta (sin credenciales, mientras siga compartida por
enlace) y, como ultimo recurso, `data/drive-manifest.json`.

### Manual, desde el tablero

El filtro tiene un boton **Sincronizar** con la fecha de los datos que se estan
viendo. Su comportamiento depende de `data/drive-config.json`:

- **Con `apiKey`**: el navegador lee la carpeta y los CSV directo de Drive,
  actualiza el tablero sin recargar y guarda el resultado en `localStorage`.
  Ademas se sincroniza solo cuando pasaron `autoSyncHours` horas (24 por
  defecto) desde la ultima vez.
- **Sin `apiKey`** (estado actual): el boton trae la ultima publicacion. La
  carga diaria la sigue haciendo GitHub Actions.

Para habilitar la sincronizacion desde el navegador hace falta una **clave de
API de Google** (Google Cloud > APIs y servicios > Credenciales > Clave de API),
con la **Google Drive API** habilitada y la clave restringida a
`https://aquarius.limaretail.com/*`. La clave no va en el repo: se guarda en el
secret **`AQ_DRIVE_API_KEY`** y `scripts/build.js` la incrusta en el HTML
cifrado al publicar. Para probar en local se puede poner en `apiKey` dentro de
`data/drive-config.json` (sin commitearla).

La carpeta debe seguir compartida como "cualquiera con el enlace puede ver": es
lo que permite leerla sin cuenta de servicio.

## Importar archivos sueltos

`scripts/import-aquarius-data.py` sigue disponible para cargar un CSV o Excel
que no este en Drive, por ejemplo las series diarias de impresiones:

```bash
python scripts/import-aquarius-data.py "ruta/al/archivo.csv" --month 2026-09
```

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
  siendo visible en GitHub aunque el sitio vaya con clave.
