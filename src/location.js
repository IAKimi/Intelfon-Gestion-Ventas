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
/** @type {{ latitud: string, longitud: string, accuracy: number|null, at: string, source?: string } | null} */
let lastFix = null;
/** Evita múltiples watch/getCurrent en paralelo en PC. */
let bgGpsStarted = false;

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

/** Heurística: PC/laptop vs teléfono. */
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
        ? 'Windows no entregó ubicación. Active “Ubicación” en Configuración → Privacidad y seguridad → Ubicación.'
        : 'No se pudo obtener la ubicación. Active el GPS del dispositivo e intente de nuevo.',
      'unavailable'
    );
  }
  if (code === 3) {
    return new LocationError(
      desktop
        ? 'Se agotó el tiempo esperando GPS. Se intentará ubicación por red.'
        : 'Tiempo de espera agotado al obtener GPS. Active la ubicación e intente de nuevo.',
      'timeout'
    );
  }
  return new LocationError(
    desktop
      ? 'No se pudo obtener GPS del navegador. Se intentará ubicación por red.'
      : 'No se pudo obtener la ubicación. Active el GPS e intente de nuevo.',
    'unknown'
  );
}

function storeFix(posOrFix, source = 'gps') {
  const lat =
    posOrFix?.coords?.latitude != null ? posOrFix.coords.latitude : posOrFix.latitud;
  const lon =
    posOrFix?.coords?.longitude != null ? posOrFix.coords.longitude : posOrFix.longitud;
  const accuracy =
    posOrFix?.coords?.accuracy != null
      ? posOrFix.coords.accuracy
      : posOrFix.accuracy ?? null;

  // No degradar un GPS reciente con un fix por IP.
  if (source === 'ip' && lastFix?.source === 'gps') {
    const age = Date.now() - new Date(lastFix.at).getTime();
    if (Number.isFinite(age) && age >= 0 && age < 10 * 60 * 1000) {
      status = 'granted';
      return { ...lastFix };
    }
  }

  lastFix = {
    latitud: String(lat),
    longitud: String(lon),
    accuracy: accuracy == null ? null : Number(accuracy),
    at: new Date().toISOString(),
    source,
  };
  status = 'granted';
  return { ...lastFix };
}

/**
 * En PC: intenta GPS en background solo si el permiso ya está concedido (sin prompt).
 * Si llega un fix, reemplaza la IP.
 */
export function startBackgroundGpsUpgrade() {
  if (!isLikelyDesktop() || bgGpsStarted) return;
  if (!navigator.geolocation || !isLocationSecureContext()) return;
  bgGpsStarted = true;

  void (async () => {
    try {
      if (navigator.permissions?.query) {
        const perm = await navigator.permissions.query({ name: 'geolocation' });
        if (perm.state !== 'granted') {
          // No disparar el diálogo de permiso en desktop.
          bgGpsStarted = false;
          return;
        }
      } else {
        // Sin Permissions API no sabemos si pedirá prompt: no forzar en PC.
        bgGpsStarted = false;
        return;
      }

      try {
        await requestPosition({
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 120000,
        });
        return;
      } catch {
        /* watch corto */
      }
      try {
        await watchForFix({
          enableHighAccuracy: false,
          timeout: 20000,
          maximumAge: 120000,
        });
      } catch {
        /* se mantiene IP */
      }
    } catch {
      /* ignore */
    }
  })();
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
      (pos) => resolve(storeFix(pos, 'gps')),
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
      status = 'timeout';
      reject(new LocationError('Tiempo de espera agotado al obtener GPS.', 'timeout'));
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
        resolve(storeFix(pos, 'gps'));
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
 * Fallback por IP/red cuando el GPS del navegador falla (típico en PC Windows).
 * Suficiente para demo/piloto si el SO no entrega ubicación.
 */
async function getIpLocationFallback() {
  const controllers = [];
  const fetchJson = async (url, timeoutMs = 8000) => {
    const ctrl = new AbortController();
    controllers.push(ctrl);
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  };

  try {
    // geojs: sin key, CORS ok
    const data = await fetchJson('https://get.geojs.io/v1/ip/geo.json');
    const lat = Number(data.latitude);
    const lon = Number(data.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('sin coords');
    return storeFix(
      {
        latitud: lat,
        longitud: lon,
        accuracy: 25000,
      },
      'ip'
    );
  } catch {
    try {
      const data = await fetchJson('https://ipapi.co/json/');
      const lat = Number(data.latitude);
      const lon = Number(data.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('sin coords');
      return storeFix(
        {
          latitud: lat,
          longitud: lon,
          accuracy: 30000,
        },
        'ip'
      );
    } catch {
      throw new LocationError(
        'No se pudo obtener ubicación ni por GPS ni por red. Active Ubicación de Windows o use el teléfono.',
        'unavailable'
      );
    }
  } finally {
    controllers.forEach((c) => {
      try {
        c.abort();
      } catch {
        /* ignore */
      }
    });
  }
}

/**
 * Cascada:
 * - PC: cache (GPS>IP) → IP inmediata → GPS solo en background si ya hay permiso.
 * - Móvil: cache → GPS → watch → IP.
 * @param {{ timeout?: number, maximumAge?: number, enableHighAccuracy?: boolean, allowIpFallback?: boolean, preferCache?: boolean }} [opts]
 */
export async function getGps(opts = {}) {
  const desktop = isLikelyDesktop();
  const timeout = opts.timeout ?? (desktop ? 8000 : 25000);
  const maximumAge = opts.maximumAge ?? (desktop ? 600000 : 60000);
  const forceHigh = opts.enableHighAccuracy === true;
  const allowIpFallback = opts.allowIpFallback !== false;
  const preferCache = opts.preferCache !== false;

  if (preferCache && lastFix?.at && status === 'granted') {
    const age = Date.now() - new Date(lastFix.at).getTime();
    if (Number.isFinite(age) && age >= 0 && age <= maximumAge) {
      if (desktop) startBackgroundGpsUpgrade();
      return { ...lastFix };
    }
    // GPS un poco viejo: mejor que forzar IP lenta / cascada.
    if (desktop && lastFix.source === 'gps' && age < 30 * 60 * 1000) {
      startBackgroundGpsUpgrade();
      return { ...lastFix };
    }
  }

  // Desktop: IP primero (rápido para demo/registro). GPS mejora en background.
  if (desktop && allowIpFallback) {
    try {
      const ipFix = await getIpLocationFallback();
      startBackgroundGpsUpgrade();
      // Si el background ya dejó GPS, devolver GPS.
      if (lastFix?.source === 'gps') return { ...lastFix };
      return ipFix;
    } catch (err) {
      startBackgroundGpsUpgrade();
      if (lastFix && status === 'granted') return { ...lastFix };
      throw err instanceof LocationError ? err : mapGeoError(err);
    }
  }

  const attempts = forceHigh
    ? [{ enableHighAccuracy: true, timeout, maximumAge: 0 }]
    : [
        { enableHighAccuracy: true, timeout, maximumAge: Math.min(maximumAge, 30000) },
        { enableHighAccuracy: false, timeout: Math.max(timeout, 25000), maximumAge },
      ];

  let lastErr = null;
  for (const attempt of attempts) {
    try {
      return await requestPosition(attempt);
    } catch (err) {
      lastErr = err;
      if (err?.code === 'denied' || err?.code === 'unsupported' || err?.code === 'insecure') {
        if (!allowIpFallback) throw err;
        break;
      }
    }
  }

  try {
    return await watchForFix({
      enableHighAccuracy: true,
      timeout: Math.max(timeout, 30000),
      maximumAge: 15000,
    });
  } catch (err) {
    lastErr = err;
  }

  if (allowIpFallback) {
    try {
      return await getIpLocationFallback();
    } catch (err) {
      throw lastErr || err;
    }
  }

  throw lastErr || new LocationError('No se pudo obtener la ubicación.', 'unavailable');
}

/**
 * Activa ubicación usable.
 * PC: IP inmediato + GPS en background si el permiso ya existe.
 * Móvil: pide GPS con cascada habitual.
 * @returns {Promise<{ ok: boolean, fix?: object, error?: LocationError }>}
 */
export async function ensureLocationAccess() {
  if (!navigator.geolocation && !isLikelyDesktop()) {
    status = 'unsupported';
    return {
      ok: false,
      error: new LocationError(
        'Este dispositivo o navegador no permite capturar ubicación GPS.',
        'unsupported'
      ),
    };
  }
  if (!isLocationSecureContext() && !isLikelyDesktop()) {
    status = 'insecure';
    return {
      ok: false,
      error: new LocationError(
        'Sin HTTPS el navegador no permite usar GPS. Abra el sitio por HTTPS.',
        'insecure'
      ),
    };
  }

  // Desktop: no esperar GPS del navegador.
  if (isLikelyDesktop()) {
    try {
      if (lastFix && status === 'granted') {
        startBackgroundGpsUpgrade();
        return { ok: true, fix: { ...lastFix } };
      }
      const fix = await getIpLocationFallback();
      startBackgroundGpsUpgrade();
      return { ok: true, fix };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof LocationError ? err : mapGeoError(err),
      };
    }
  }

  try {
    if (navigator.geolocation && navigator.permissions?.query) {
      const perm = await navigator.permissions.query({ name: 'geolocation' });
      if (perm.state === 'denied') {
        status = 'denied';
        return {
          ok: false,
          error: new LocationError(
            'La ubicación está bloqueada para este sitio. En el candado del sitio, permita la ubicación.',
            'denied'
          ),
        };
      }
      if (perm.state === 'prompt') status = 'prompt';
    }
  } catch {
    /* Permissions API no disponible */
  }

  try {
    const fix = await getGps({
      timeout: 25000,
      maximumAge: 60000,
      enableHighAccuracy: false,
      allowIpFallback: true,
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
    const approx = lastFix?.source === 'ip';
    return `
      <div id="gps-banner" class="mb-4 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <span class="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500"></span>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-bold text-emerald-900">Ubicación activa${approx ? ' (aproximada por red)' : ''}</div>
          <p class="mt-0.5 text-xs text-emerald-800/80">${
            approx
              ? 'En PC se usa ubicación por red de inmediato. Si el navegador ya tiene permiso GPS, se mejora sola en segundo plano.'
              : 'Lista para registrar salidas y visitas (PC o teléfono).'
          }</p>
        </div>
      </div>`;
  }

  const desktop = isLikelyDesktop();
  const messages = {
    denied: desktop
      ? 'Permiso GPS bloqueado. En PC igual puede activar ubicación por red (IP) para registrar.'
      : 'No dio permiso de ubicación. Sin eso no se pueden registrar salidas ni visitas.',
    insecure: 'Este sitio necesita HTTPS para usar ubicación.',
    unsupported: 'Este dispositivo no soporta geolocalización.',
    unavailable: desktop
      ? 'Pulse «Activar ubicación» para tomar ubicación por red (inmediato en PC).'
      : 'Active el GPS del teléfono para continuar.',
    timeout: desktop
      ? 'Pulse «Activar ubicación»: en PC se usa red de inmediato.'
      : 'No se obtuvo GPS a tiempo. Active la ubicación e intente de nuevo.',
    prompt: desktop
      ? 'Pulse «Activar ubicación» para usar red de inmediato (el GPS solo se usa si ya está permitido).'
      : 'Se necesita acceso a su ubicación para registrar salidas y visitas.',
    unknown: desktop
      ? 'Pulse «Activar ubicación» para usar ubicación por red.'
      : 'Pulse «Activar ubicación» para continuar.',
  };

  const text = messages[status] || messages.unknown;
  return `
    <div id="gps-banner" class="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div class="flex items-start gap-3">
        <span class="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500"></span>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-bold text-amber-950">Ubicación pendiente</div>
          <p class="mt-0.5 text-xs text-amber-900/80">${text}</p>
          <button type="button" id="btn-enable-gps" class="mt-3 inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2 text-xs font-black uppercase tracking-tight text-white hover:bg-red-700">
            Activar ubicación
          </button>
        </div>
      </div>
    </div>`;
}
