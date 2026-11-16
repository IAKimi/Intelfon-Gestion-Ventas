/** Errores tipados de GPS para la UI. */
export class LocationError extends Error {
  /**
   * @param {string} message
   * @param {'unsupported'|'insecure'|'denied'|'unavailable'|'timeout'|'unknown'} code
   */
  constructor(message, code = 'unknown') {
    super(message);
    this.name = 'LocationError';
    this.code = code;
    this.isLocationError = true;
  }
}

/** @type {'unknown'|'granted'|'denied'|'prompt'|'unavailable'|'insecure'|'unsupported'|'timeout'} */
let status = 'unknown';
/** @type {{ latitud: string, longitud: string, accuracy: number|null, at: string } | null} */
let lastFix = null;

export function getLocationStatus() {
  return status;
}

export function getLastFix() {
  return lastFix;
}

export function hasUsableLocation() {
  return status === 'granted' && Boolean(lastFix);
}

export function isLocationSecureContext() {
  return (
    window.isSecureContext === true ||
    location.protocol === 'https:' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1'
  );
}

function mapGeoError(err) {
  const code = err?.code;
  if (code === 1) {
    return new LocationError(
      'Permiso de ubicación denegado. Actívelo para poder registrar salidas y visitas.',
      'denied'
    );
  }
  if (code === 2) {
    return new LocationError(
      'No se pudo obtener la ubicación. Active el GPS del dispositivo e intente de nuevo.',
      'unavailable'
    );
  }
  if (code === 3) {
    return new LocationError(
      'Tiempo de espera agotado al obtener GPS. Active la ubicación e intente de nuevo.',
      'timeout'
    );
  }
  return new LocationError(
    'No se pudo obtener la ubicación. Active el GPS e intente de nuevo.',
    'unknown'
  );
}

function requestPosition(opts = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      status = 'unsupported';
      reject(
        new LocationError('Este dispositivo o navegador no permite capturar ubicación GPS.', 'unsupported')
      );
      return;
    }
    if (!isLocationSecureContext()) {
      status = 'insecure';
      reject(
        new LocationError(
          'El navegador bloquea el GPS en HTTP. Use la versión HTTPS del sitio o permita la ubicación en un entorno seguro.',
          'insecure'
        )
      );
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        lastFix = {
          latitud: String(pos.coords.latitude),
          longitud: String(pos.coords.longitude),
          accuracy: pos.coords.accuracy ?? null,
          at: new Date().toISOString(),
        };
        status = 'granted';
        resolve({ ...lastFix });
      },
      (err) => {
        const mapped = mapGeoError(err);
        status = mapped.code === 'denied' ? 'denied' : mapped.code;
        reject(mapped);
      },
      {
        enableHighAccuracy: Boolean(opts.enableHighAccuracy),
        timeout: opts.timeout ?? 20000,
        maximumAge: opts.maximumAge ?? 60000,
      }
    );
  });
}

/**
 * Solicita una lectura de ubicación.
 * En PC prioriza red/Wi‑Fi (rápido). Si falla, intenta una vez con más precisión.
 * @param {{ timeout?: number, maximumAge?: number, enableHighAccuracy?: boolean }} [opts]
 */
export async function getGps(opts = {}) {
  const forceHigh = opts.enableHighAccuracy === true;
  const timeout = opts.timeout ?? 20000;
  const maximumAge = opts.maximumAge ?? 60000;

  if (forceHigh) {
    return requestPosition({ enableHighAccuracy: true, timeout, maximumAge });
  }

  try {
    return await requestPosition({
      enableHighAccuracy: false,
      timeout: Math.min(timeout, 18000),
      maximumAge,
    });
  } catch (err) {
    if (err?.code === 'denied' || err?.code === 'unsupported' || err?.code === 'insecure') {
      throw err;
    }
    return requestPosition({
      enableHighAccuracy: true,
      timeout: Math.max(timeout, 25000),
      maximumAge: 0,
    });
  }
}

/**
 * Pide permiso / refresca GPS. Pensado para el ingreso al panel.
 * @returns {Promise<{ ok: boolean, fix?: object, error?: LocationError }>}
 */
export async function ensureLocationAccess() {
  if (!navigator.geolocation) {
    status = 'unsupported';
    return {
      ok: false,
      error: new LocationError(
        'Este dispositivo o navegador no permite capturar ubicación GPS.',
        'unsupported'
      ),
    };
  }
  if (!isLocationSecureContext()) {
    status = 'insecure';
    return {
      ok: false,
      error: new LocationError(
        'Sin HTTPS el navegador no permite usar GPS. Abra el sitio por HTTPS o contacte a soporte.',
        'insecure'
      ),
    };
  }

  try {
    if (navigator.permissions?.query) {
      const perm = await navigator.permissions.query({ name: 'geolocation' });
      if (perm.state === 'denied') {
        status = 'denied';
        return {
          ok: false,
          error: new LocationError(
            'La ubicación está bloqueada para este sitio. En el candado o la información del sitio, permita la ubicación y vuelva a intentar.',
            'denied'
          ),
        };
      }
      if (perm.state === 'prompt') status = 'prompt';
    }
  } catch {
    /* Permissions API no disponible en todos los navegadores */
  }

  try {
    const fix = await getGps({ timeout: 22000, maximumAge: 120000, enableHighAccuracy: false });
    return { ok: true, fix };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof LocationError ? err : mapGeoError(err),
    };
  }
}

export function locationBannerHtml() {
  if (status === 'granted') {
    return `
      <div id="gps-banner" class="mb-4 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <span class="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500"></span>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-bold text-emerald-900">Ubicación activa</div>
          <p class="mt-0.5 text-xs text-emerald-800/80">Ya puede registrar salidas y visitas con GPS.</p>
        </div>
      </div>`;
  }

  const messages = {
    denied:
      'No dio permiso de ubicación. Sin eso no se pueden registrar salidas ni visitas. Use el candado del navegador → Ubicación → Permitir.',
    insecure:
      'Este sitio está en HTTP y el navegador bloquea el GPS. Use HTTPS o active la ubicación cuando el navegador lo permita.',
    unsupported: 'Este dispositivo no soporta geolocalización.',
    unavailable:
      'No hay señal de ubicación. En computadora active “Ubicación” de Windows y permita el sitio; en celular active el GPS.',
    timeout:
      'No se obtuvo ubicación a tiempo. En PC a veces tarda: pulse «Activar ubicación» de nuevo o use el celular.',
    prompt: 'Se necesita acceso a su ubicación solo para registrar salidas y visitas.',
    unknown: 'Active la ubicación para poder registrar salidas y visitas. El resto del panel sí se puede usar.',
  };

  const text = messages[status] || messages.unknown;
  return `
    <div id="gps-banner" class="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div class="flex items-start gap-3">
        <span class="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500"></span>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-bold text-amber-950">Ubicación pendiente</div>
          <p class="mt-0.5 text-xs text-amber-900/80">${text}</p>
          <p class="mt-1 text-[11px] text-amber-800/70">Puede usar cartera, citas y dashboard. Solo salida y visita requieren GPS.</p>
          <button type="button" id="btn-enable-gps" class="mt-3 inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2 text-xs font-black uppercase tracking-tight text-white hover:bg-red-700">
            Activar ubicación
          </button>
        </div>
      </div>
    </div>`;
}
