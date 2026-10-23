# RED — Gestión de Ventas

Portal para registro de salidas, reporte de visitas, cartera de contactos y solicitud de reintegro de combustible. Envía los formularios a un webhook de Make.

## Arranque local

```bash
npm install
npm run dev
```

Abrir la URL que indique Vite (por defecto `http://localhost:5173`).

## Rutas

| Ruta | Quién |
|------|--------|
| `/` | Login y panel de **vendedores** / **jefes de ventas** |
| `/admin/login` | Login de **administrador** |
| `/admin` | Configuración (usuarios, switches, webhook, API key) |

## Roles

| Rol | Acceso |
|-----|--------|
| `vendedor` | Salidas, visitas, cartera, prospectos |
| `jefe` | Lo del vendedor + citas del equipo, dashboard, historial, aprobar solicitudes |
| `admin` | Panel completo (config, import, usuarios, catálogos) |

Los jefes también se detectan si su correo aparece como `correo_jefe` de otros vendedores (`es_jefe`).

## API de lectura (export)

Pensada para dashboards externos (p. ej. Power BI / scripts). Solo lectura. Autenticación por API key.

### Autenticación

Envíe la clave en el header:

```http
X-API-Key: SU_CLAVE
```

También se acepta `Authorization: Bearer SU_CLAVE`.

La clave se configura en **Admin → Configuración global → API key de lectura**, o con la variable de entorno `EXPORT_API_KEY` en el servidor.

### Endpoints

Base: `https://<su-dominio>`

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/export/clients` | Clientes y prospectos (incluye `contactos[]`) |
| `GET` | `/api/export/salidas` | Salidas y reportes de visita |
| `GET` | `/api/export/citas` | Citas programadas |
| `GET` | `/api/export/resumen` | Totales y métricas por ejecutivo |

### Ejemplo

```bash
curl -H "X-API-Key: SU_CLAVE" https://<dominio>/api/export/resumen
```

Respuesta típica de `/api/export/resumen`:

```json
{
  "ok": true,
  "generatedAt": "2026-10-23T16:00:00.000Z",
  "totales": {
    "usuarios": 40,
    "ejecutivos": 35,
    "clientes": 640,
    "prospectos": 12,
    "salidas": 200,
    "visitadas": 180,
    "pendientes": 20,
    "citas": 5
  },
  "porEjecutivo": [
    {
      "id": "…",
      "nombre": "…",
      "pais": "SV",
      "clientes": 20,
      "salidas": 10,
      "visitadas": 8,
      "pendientes": 2
    }
  ]
}
```

Códigos de error: `401` sin clave, `403` clave inválida, `500` error interno.

## Admin

- Switch **combustible global** (ON = todos heredan activo).
- Switch por usuario estilo iOS (aplica cuando el global está OFF).
- **Catálogos globales** editables: tipos de salida, visita, transporte y pago.
- Por usuario: heredar todos los globales o limitar opciones.
- Importación de Excel: modo **Agregar** o **Reemplazar**, con alerta si el archivo trae menos filas que la base.
- URL del webhook de Make y correo de ventas para aprobaciones.
- API key de lectura para `/api/export/*`.

## Payloads Make (`formulario`)

- `registro_salidas`
- `reportes_visitas`
- `solicitud_reintegro`
- `solicitud_cliente`
- `contacto_actualizado`
- `cita_programada`
- `reporte_tardio`
