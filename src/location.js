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

/** @type {'unknown'|'granted'|'denied'|'prompt'|'unavailable'|'insecure'|'unsupported'} */
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

/**
 * Solicita una lectura GPS fresca.
 * @param {{ timeout?: number, maximumAge?: number, enableHighAccuracy?: boolean }} [opts]
 */
export function getGps(opts = {}) {
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
        enableHighAccuracy: opts.enableHighAccuracy !== false,
        timeout: opts.timeout ?? 15000,
        maximumAge: opts.maximumAge ?? 0,
      }
    );
  });
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
            'La ubicación está bloqueada para este sitio. En el candado o información del sitio, permita la ubicación y vuelva a intentar.',
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
    const fix = await getGps({ timeout: 20000 });
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
      'No dio permiso de ubicación. Sin eso no se pueden registrar salidas ni visitas.',
    insecure:
      'Este sitio está en HTTP y el navegador bloquea el GPS. Use HTTPS o active la ubicación cuando el navegador lo permita.',
    unsupported: 'Este dispositivo no soporta geolocalización.',
    unavailable: 'Active el GPS del teléfono para continuar.',
    timeout: 'No se obtuvo GPS a tiempo. Active la ubicación e intente de nuevo.',
    prompt: 'Se necesita acceso a su ubicación para registrar operaciones.',
    unknown: 'Active la ubicación para poder registrar salidas y visitas.',
  };

  const text = messages[status] || messages.unknown;
  return `
    <div id="gps-banner" class="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div class="flex items-start gap-3">
        <span class="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500"></span>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-bold text-amber-950">Ubicación requerida</div>
          <p class="mt-0.5 text-xs text-amber-900/80">${text}</p>
          <button type="button" id="btn-enable-gps" class="mt-3 inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2 text-xs font-black uppercase tracking-tight text-white hover:bg-red-700">
            Activar ubicación
          </button>
        </div>
      </div>
    </div>`;
}
