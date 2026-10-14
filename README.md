# RED — Gestión de Ventas

Portal sencillo para registro de salidas, reporte de visitas y solicitud de reintegro de combustible. Envía los formularios a un webhook de Make.

## Arranque local

```bash
npm install
npm run dev
```

Abrir la URL que indique Vite (por defecto `http://localhost:5173`).

## Rutas

| Ruta | Quién |
|------|--------|
| `/` | Login y panel de **vendedores** |
| `/admin/login` | Login de **administrador** |
| `/admin` | Solo configuración (usuarios, switches, webhook) |

## Usuarios demo

| Usuario   | Contraseña    | Entrada |
|-----------|---------------|---------|
| vendedor  | vendedor123   | `/` |
| admin     | admin123      | `/admin/login` |

## Admin

- Switch **combustible global** (ON = todos heredan activo).
- Switch por usuario estilo iOS en la tabla (aplica cuando el global está OFF).
- **Catálogos globales** editables: tipos de salida, visita, transporte y pago.
- Por usuario: heredar todos los globales o limitar solo las opciones asignadas.
- URL del webhook de Make.

## Payloads (`formulario`)

- `registro_salidas`
- `reportes_visitas`
- `solicitud_reintegro`
