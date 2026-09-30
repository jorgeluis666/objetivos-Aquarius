# Aquarius | Dashboard Lima Retail 2026

Dashboard de gasto publicitario para Aquarius, adaptado desde la arquitectura original del panel de Amador.

## Acceso

- URL publica: **https://aquarius.limaretail.com** (con clave, ver "Publicacion en aquarius.limaretail.com").
- La clave no esta en el codigo: es el secret `AQ_PAGE_PASSWORD` de GitHub.
- Entrada local: `index.html` (sin clave)
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

## Paneles del modulo

1. `Resultados por campana`: detalle del mes seleccionado.
2. `Evolucion diaria`: lineas en el tiempo con los indicadores del mes
   seleccionado. Dibuja las series que traiga la data diaria: inversion,
   resultados, costo por resultado e impresiones. El costo por resultado se
   calcula dia a dia como inversion entre resultados.

Si el mes tiene los totales de campanas pero no el export diario de inversion y
resultados, el panel reparte esos totales entre los dias segun las impresiones de
cada dia. Esas lineas salen punteadas, con `(est.)` en la leyenda y un aviso
debajo del grafico: son un prorrateo, no cifras diarias reales. Al importar el
export diario se reemplazan por los valores reales.

El CTR de la cabecera usa las impresiones reales de la serie diaria cuando
existen (clics / impresiones). Sin serie diaria cae al CTR ponderado que trae la
tabla de campanas.

### Formatos aceptados

1. Tabla de resultados por campana (`.csv`, `.xlsx`, `.xlsm`):
   `Campaña | Coste | % Δ | CTR | % Δ | Clics | % Δ | Conv | % Δ | Cos/con | % Δ`
2. Serie diaria (`.csv`): primera columna `Fecha` y una o mas de estas columnas,
   en cualquier combinacion: `Impresiones`, `Coste` (o `Costo`, `Inversion`,
   `Importe gastado`, `Gasto`), `Resultados` (o `Conversaciones`, `Conv`,
   `Mensajes`) y `Clics`.

Cada archivo diario se fusiona por fecha dentro del mes, asi que puedes enviar
las impresiones en un export y la inversion diaria en otro.

## Origen de la data cargada

Los archivos fuente se guardan en `data/csv-backups/`:

- `Gráfico_de_serie_temporal(2026.MM...).csv`: impresiones diarias de enero a
  agosto de 2026, exportadas del panel de campanas.
- `Reporte_Aquarius_Agosto2026_tabla.csv`: tabla de resultados de agosto 2026,
  transcrita del reporte `Aquarius_-_Dashboard_Lima_Retail (4).pdf`
  (1 ago 2026 - 31 ago 2026). Sus totales cuadran con el reporte:
  S/ 1,854.85 de coste, 2,325 clics, 129 conversiones, S/ 14.38 por conversion
  y CTR 6.87%. Reemplaza a la tabla anterior, que era de otro periodo.

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

El resultado se genera en `dist/`: `index.html` (CSS, JS y datos incrustados), `assets/` y `CNAME`.
Nada mas: `data/` (incluido `data/csv-backups`), `scripts/` y `docs/` no se publican.

Con `AQ_PAGE_PASSWORD=<clave> npm run build` el `index.html` sale cifrado, como en GitHub Pages.

## Publicacion en aquarius.limaretail.com (GitHub Pages)

URL publica: **https://aquarius.limaretail.com**. Cada push a `main` la actualiza sola
(`.github/workflows/deploy-pages.yml`); no hay que volver a tocar el DNS ni la configuracion de Pages.

- Pages publica con Actions (sube `dist/`), asi que el dominio propio se configura en **Settings > Pages >
  Custom domain** y queda guardado en el repo. Ademas `CNAME` (raiz) lleva el dominio y `build.js` lo copia a
  `dist/`, igual que en los tableros de Casiopia y Terminal Pesquero.
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
- Las preferencias (mes elegido, vista, panel minimizado y ediciones de la calculadora) viven en `localStorage`
  de cada dominio: las de `github.io` no pasan a `aquarius.limaretail.com`.
- El repo es publico: lo que esta en `data/` (y el historial de git, que incluye la clave anterior) sigue
  siendo visible en GitHub aunque el sitio vaya con clave.
