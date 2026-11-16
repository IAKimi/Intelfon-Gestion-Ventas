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

/** Heurística: PC/laptop vs teléfono. En PC usamos red/Wi‑Fi con más paciencia. */
export function isLikelyDesktop() {
  const ua = navigator.userAgent || '';
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  if (mobileUa) return false;
  if (coarse && Math.min(window.screen?.width || 0, window.screen?.height || 0) < 820) return false;
  return true;
}

function mapGeoError(err) {
  const code = err?.code;
  const desktop = isLikelyDesktop();
  if (code === 1) {
    return new LocationError(
      desktop
        ? 'Permiso de ubicación denegado. En el candado del sitio → Ubicación → Permitir. En Windows: Configuración → Privacidad → Ubicación → Activada.'
        : 'Permiso de ubicación denegado. Actívelo para poder registrar salidas y visitas.',
      'denied'
    );
  }
  if (code === 2) {
    return new LocationError(
      desktop
        ? 'Windows no entregó ubicación. Active “Ubicación” en Configuración → Privacidad y seguridad → Ubicación, y permita acceso a apps/navegador.'
        : 'No se pudo obtener la ubicación. Active el GPS del dispositivo e intente de nuevo.',
      'unavailable'
    );
  }
  if (code === 3) {
    return new LocationError(
      desktop
        ? 'Se agotó el tiempo esperando ubicación. Active Ubicación de Windows, conecte Wi‑Fi y pulse «Activar ubicación» otra vez.'
        : 'Tiempo de espera agotado al obtener GPS. Active la ubicación e intente de nuevo.',
      'timeout'
    );
  }
  return new LocationError(
    desktop
      ? 'No se pudo obtener la ubicación en esta computadora. Revise permiso del navegador y Ubicación de Windows.'
      : 'No se pudo obtener la ubicación. Active el GPS e intente de nuevo.',
    'unknown'
  );
}

function storeFix(pos) {
  lastFix = {
    latitud: String(pos.coords.latitude),
    longitud: String(pos.coords.longitude),
    accuracy: pos.coords.accuracy ?? null,
    at: new Date().toISOString(),
  };
  status = 'granted';
  return { ...lastFix };
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
          'El navegador bloquea el GPS en HTTP. Use la versión HTTPS del sitio.',
          'insecure'
        )
      );
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(storeFix(pos)),
      (err) => {
        const mapped = mapGeoError(err);
        status = mapped.code === 'denied' ? 'denied' : mapped.code;
        reject(mapped);
      },
      {
        enableHighAccuracy: Boolean(opts.enableHighAccuracy),
        timeout: opts.timeout ?? 30000,
        maximumAge: opts.maximumAge ?? 0,
      }
    );
  });
}

/**
 * En algunos Windows getCurrentPosition hace timeout, pero watchPosition sí entrega fix.
 */
function watchForFix({ enableHighAccuracy = false, timeout = 35000, maximumAge = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new LocationError('Geolocalización no disponible.', 'unsupported'));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        navigator.geolocation.clearWatch(watchId);
      } catch {
        /* ignore */
      }
      const mapped = new LocationError(
        isLikelyDesktop()
          ? 'Se agotó el tiempo esperando ubicación. Active Ubicación de Windows y reintente.'
          : 'Tiempo de espera agotado al obtener GPS.',
        'timeout'
      );
      status = 'timeout';
      reject(mapped);
    }, timeout);

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          navigator.geolocation.clearWatch(watchId);
        } catch {
          /* ignore */
        }
        resolve(storeFix(pos));
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          navigator.geolocation.clearWatch(watchId);
        } catch {
          /* ignore */
        }
        const mapped = mapGeoError(err);
        status = mapped.code === 'denied' ? 'denied' : mapped.code;
        reject(mapped);
      },
      {
        enableHighAccuracy: Boolean(enableHighAccuracy),
        timeout,
        maximumAge,
      }
    );
  });
}

/**
 * Cascada PC/móvil: cache → red/Wi‑Fi → precisión → watchPosition.
 * @param {{ timeout?: number, maximumAge?: number, enableHighAccuracy?: boolean }} [opts]
 */
export async function getGps(opts = {}) {
  const desktop = isLikelyDesktop();
  const timeout = opts.timeout ?? (desktop ? 45000 : 25000);
  const maximumAge = opts.maximumAge ?? (desktop ? 300000 : 60000);
  const forceHigh = opts.enableHighAccuracy === true;

  if (lastFix?.at) {
    const age = Date.now() - new Date(lastFix.at).getTime();
    if (Number.isFinite(age) && age >= 0 && age <= maximumAge && status === 'granted') {
      return { ...lastFix };
    }
  }

  const attempts = forceHigh
    ? [{ enableHighAccuracy: true, timeout, maximumAge: 0 }]
    : desktop
      ? [
          { enableHighAccuracy: false, timeout: Math.min(timeout, 35000), maximumAge },
          { enableHighAccuracy: false, timeout: Math.max(timeout, 40000), maximumAge: 0 },
          { enableHighAccuracy: true, timeout: Math.max(timeout, 45000), maximumAge: 0 },
        ]
      : [
          { enableHighAccuracy: true, timeout, maximumAge: Math.min(maximumAge, 30000) },
          { enableHighAccuracy: false, timeout: Math.max(timeout, 30000), maximumAge },
        ];

  let lastErr = null;
  for (const attempt of attempts) {
    try {
      return await requestPosition(attempt);
    } catch (err) {
      lastErr = err;
      if (err?.code === 'denied' || err?.code === 'unsupported' || err?.code === 'insecure') {
        throw err;
      }
    }
  }

  try {
    return await watchForFix({
      enableHighAccuracy: desktop ? false : true,
      timeout: Math.max(timeout, desktop ? 45000 : 30000),
      maximumAge: desktop ? maximumAge : 15000,
    });
  } catch (err) {
    throw lastErr || err;
  }
}

/**
 * Pide permiso / refresca GPS.
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
        'Sin HTTPS el navegador no permite usar GPS. Abra el sitio por HTTPS.',
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
            isLikelyDesktop()
              ? 'La ubicación está bloqueada para este sitio. Candado → Ubicación → Permitir. También active Ubicación en Windows.'
              : 'La ubicación está bloqueada para este sitio. En el candado del sitio, permita la ubicación y vuelva a intentar.',
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
    const fix = await getGps({
      timeout: isLikelyDesktop() ? 45000 : 25000,
      maximumAge: isLikelyDesktop() ? 300000 : 60000,
      enableHighAccuracy: false,
    });
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
          <p class="mt-0.5 text-xs text-emerald-800/80">Lista para registrar salidas y visitas (PC o teléfono).</p>
        </div>
      </div>`;
  }

  const desktop = isLikelyDesktop();
  const messages = {
    denied: desktop
      ? 'Permiso bloqueado. Candado del sitio → Ubicación → Permitir. Windows: Configuración → Privacidad → Ubicación → Activada.'
      : 'No dio permiso de ubicación. Sin eso no se pueden registrar salidas ni visitas.',
    insecure: 'Este sitio necesita HTTPS para usar ubicación.',
    unsupported: 'Este dispositivo no soporta geolocalización.',
    unavailable: desktop
      ? 'Windows no entregó ubicación. Active Ubicación del sistema y permita el navegador.'
      : 'Active el GPS del teléfono para continuar.',
    timeout: desktop
      ? 'Tardó demasiado. Active Ubicación de Windows, use Wi‑Fi y pulse «Activar ubicación» otra vez.'
      : 'No se obtuvo GPS a tiempo. Active la ubicación e intente de nuevo.',
    prompt: 'Se necesita acceso a su ubicación para registrar salidas y visitas.',
    unknown: desktop
      ? 'Active ubicación del navegador y de Windows. Luego pulse el botón.'
      : 'Active la ubicación para poder registrar salidas y visitas.',
  };

  const text = messages[status] || messages.unknown;
  return `
    <div id="gps-banner" class="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div class="flex items-start gap-3">
        <span class="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500"></span>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-bold text-amber-950">Ubicación pendiente</div>
          <p class="mt-0.5 text-xs text-amber-900/80">${text}</p>
          ${
            desktop
              ? `<ol class="mt-2 list-decimal space-y-1 pl-4 text-[11px] text-amber-900/80">
                  <li>Windows: Configuración → Privacidad y seguridad → Ubicación → <strong>Activada</strong>.</li>
                  <li>Permita ubicación a este navegador (Chrome/Edge).</li>
                  <li>Candado de esta página → Ubicación → <strong>Permitir</strong>.</li>
                  <li>Pulse «Activar ubicación» (puede tardar unos segundos en PC).</li>
                </ol>`
              : `<p class="mt-1 text-[11px] text-amber-800/70">Solo salida y visita requieren GPS. El resto del panel sí se puede usar.</p>`
          }
          <button type="button" id="btn-enable-gps" class="mt-3 inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2 text-xs font-black uppercase tracking-tight text-white hover:bg-red-700">
            Activar ubicación
          </button>
        </div>
      </div>
    </div>`;
}
