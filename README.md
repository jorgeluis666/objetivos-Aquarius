# Amador | Gasto publicitario 2026

Dashboard de Agencia Lima Retail para controlar la inversion publicitaria de Amador.

## Modulo activo

El modulo activo muestra:

- Gasto mensual total.
- Distribucion entre Branding y Ventas.
- Campanas por mes.
- Estado, objetivo, presupuesto, gasto, importe diario y URL de anuncios.

Los modulos Comparativo YoY, Distribucion, Productos Web y Usuarios y Claves se muestran deshabilitados hasta su futura implementacion.

## Datos

La fuente normalizada esta en `data/amador-ads-2026.json`. El CSV original se conserva en `data/source/` como respaldo.

Los datos llegan hasta el 12 de junio de 2026.

## Desarrollo

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

El resultado para GitHub Pages se genera en `dist/`.
