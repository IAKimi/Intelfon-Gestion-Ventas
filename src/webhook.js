import { getState, resolveCombustible } from './store.js';
import { DEFAULT_WEBHOOK_URL } from './config.js';

export { DEFAULT_WEBHOOK_URL };

/** Esquema completo: Make siempre ve todas las variables. */
function emptyEnvelope() {
  return {
    // Enrutamiento
    formulario: '',
    ambiente: 'desarrollo',

    // Sesión / vendedor
    usuario_id: '',
    usuario_login: '',
    nombre_vendedor: '',
    cargo: '',
    sucursal: '',
    pais: '',
    correo_vendedor: '',
    correo_jefe: '',
    combustible_activo: false,
    catalogo_clientes_activo: false,
    timestamp: '',

    // A — Registro de salida
    fecha_registro_salida: '',
    hora_registro_salida: '',
    cliente_registro_salida: '',
    contacto_registro_salida: '',
    telefono_registro_salida: '',
    tipo_registro_salida: '',
    punto_referencia: '',
    objetivo_registro_salida: '',
    latitud_registro_salidas: '',
    longitud_registro_salidas: '',
    gps_accuracy_salida: null,

    // B — Reporte de visita
    fecha_reporte_visitas: '',
    hora_reporte_visitas: '',
    cliente_reporte_visitas: '',
    contacto_reporte_visitas: '',
    telefono_reporte_visitas: '',
    tipo_visita: '',
    punto_referencia_visitas: '',
    objetivo_visita: '',
    informe_visitas: '',
    tareas_pendientes_reporte_visitas: '',
    tipo_transporte: '',
    tipo_pago_combustible: '',
    latitud_reporte_visitas: '',
    longitud_reporte_visitas: '',
    gps_accuracy_visita: null,
    galeria_fotos_reporte_visitas: null,
    tiene_evidencia: false,

    // C — Reintegro
    fecha_inicio_periodo: '',
    fecha_fin_periodo: '',
    observaciones_reintegro: '',

    // Cliente (solicitud / resolución)
    request_id: '',
    nombre_cliente: '',
    contacto_cliente: '',
    telefono_cliente: '',
    notas_solicitud: '',
    correo_ventas: '',
    accion: '',
    motivo: '',
    vendedor: '',
  };
}

export { getGps } from './location.js';

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.readAsDataURL(file);
  });
}

/** Foto opcional: sin archivo / string vacío → null; con data URL → true en tiene_evidencia. */
function normalizeGaleria(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return value;
}

function buildBody(payload) {
  const state = getState();
  const user = state.session;
  const base = emptyEnvelope();
  const galeria = normalizeGaleria(payload.galeria_fotos_reporte_visitas);

  const body = {
    ...base,
    ...payload,
    usuario_id: user?.id || '',
    usuario_login: user?.usuario || '',
    nombre_vendedor: payload.nombre_vendedor || user?.nombre || '',
    cargo: payload.cargo || user?.cargo || '',
    sucursal: payload.sucursal || user?.sucursal || '',
    pais: payload.pais || user?.pais || '',
    correo_vendedor: payload.correo_vendedor || user?.correo || '',
    correo_jefe: payload.correo_jefe || user?.correo_jefe || '',
    combustible_activo:
      typeof payload.combustible_activo === 'boolean'
        ? payload.combustible_activo
        : resolveCombustible(user),
    catalogo_clientes_activo: Boolean(state.catalogoClientesActivo),
    correo_ventas: payload.correo_ventas || state.correo_ventas || '',
    galeria_fotos_reporte_visitas: galeria,
    tiene_evidencia: Boolean(galeria),
    timestamp: new Date().toISOString(),
    ambiente: window.location.hostname === 'localhost' ? 'desarrollo' : 'produccion',
  };

  return body;
}

export async function sendToMake(payload) {
  const state = getState();
  const webhookUrl = (state.webhookUrl || DEFAULT_WEBHOOK_URL).trim();
  const body = buildBody(payload);

  console.info('[RED] Payload → Make', body);

  if (!webhookUrl) {
    return {
      ok: true,
      demo: true,
      message: 'Modo demo: webhook aún no configurado. El payload se registró en consola.',
      body,
    };
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Make respondió con error (${res.status}).`);
  }

  return { ok: true, demo: false, message: 'Registro enviado correctamente a Make.', body };
}
