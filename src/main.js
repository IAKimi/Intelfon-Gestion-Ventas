import {
  getState,
  login,
  logout,
  initStore,
  updateConfig,
  upsertUser,
  deleteUser,
  createId,
  resolveCombustible,
  setUserCombustible,
  createPendingSalida,
  getPendingSalidas,
  getSalidaById,
  markSalidaVisitada,
  resolveOptions,
  upsertCatalogItem,
  setCatalogItemActive,
  deleteCatalogItem,
  CATALOG_META,
  getActiveClients,
  getClientsByVendedor,
  getEjecutivos,
  importClients,
  upsertClient,
  deleteClient,
  updateClientContactEntry,
  addClientContact,
  removeClientContact,
  listClientContacts,
  createClientRequest,
  resolveClientRequest,
  getUserNotifications,
  markNotificationsRead,
  isCatalogoClientesActivo,
  getClientesDe,
  getProspectosDe,
  createProspect,
  normalizeNit,
  getTeamVendedores,
  createCita,
  getCitasForUser,
  getCitaById,
  markCitaRegistrada,
  cancelCita,
  reprogramCita,
  isJefe,
  distanceKm,
  LEGACY_PAGO_LABEL,
} from './store.js';
import { getGps, fileToDataUrl, sendToMake } from './webhook.js';
import {
  ensureLocationAccess,
  getLastFix,
  getLocationStatus,
  hasUsableLocation,
  isLikelyDesktop,
  locationBannerHtml,
  LocationError,
} from './location.js';
import { parseClientFile } from './clients-import.js';

const app = document.getElementById('app');
let toastTimer = null;
let navToken = 0;
let locationPrompted = false;

function pathOf() {
  return window.location.pathname.replace(/\/+$/, '') || '/';
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function go(path, { replace = false, animate = true } = {}) {
  const token = ++navToken;
  const next = path || '/';
  const root = document.getElementById('view-root');
  if (animate && root) {
    root.classList.remove('page-enter');
    root.classList.add('page-leave');
    await wait(170);
    if (token !== navToken) return;
  }
  if (replace) history.replaceState({}, '', next);
  else history.pushState({}, '', next);
  render();
}

function nowParts() {
  const d = new Date();
  return {
    fecha: d.toISOString().slice(0, 10),
    hora: d.toTimeString().slice(0, 5),
  };
}

function showToast(message, type = 'ok', { actionLabel = '', onAction = null, duration = 3600 } = {}) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.className = `toast fixed bottom-5 left-1/2 z-50 w-[min(92vw,24rem)] -translate-x-1/2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-xl ${
    type === 'ok' ? 'bg-slate-900' : 'bg-red-600'
  }`;
  el.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'flex items-start gap-3';
  const text = document.createElement('div');
  text.className = 'min-w-0 flex-1 leading-snug';
  text.textContent = message;
  row.appendChild(text);
  if (actionLabel && typeof onAction === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
      'shrink-0 rounded-lg bg-white/20 px-3 py-1.5 text-[11px] font-black uppercase tracking-tight text-white hover:bg-white/30';
    btn.textContent = actionLabel;
    btn.addEventListener('click', async () => {
      el.classList.add('hidden');
      await onAction();
    });
    row.appendChild(btn);
  }
  el.appendChild(row);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), actionLabel ? Math.max(duration, 8000) : duration);
}

function showGpsBusy(message = 'Obteniendo ubicación…') {
  hideGpsBusy();
  const el = document.createElement('div');
  el.id = 'gps-busy-overlay';
  el.className = 'gps-busy-overlay';
  el.setAttribute('role', 'alertdialog');
  el.setAttribute('aria-busy', 'true');
  el.setAttribute('aria-live', 'assertive');
  const hint = isLikelyDesktop()
    ? 'En computadora se usa ubicación por red (rápido). El GPS solo mejora en segundo plano si ya está permitido.'
    : 'Espere un momento. No toque la pantalla hasta que termine.';
  el.innerHTML = `
    <div class="gps-busy-card">
      <div class="gps-busy-spinner" aria-hidden="true"></div>
      <div class="text-sm font-black text-slate-900">${escapeHtml(message)}</div>
      <p class="mt-2 text-xs leading-relaxed text-slate-500">${escapeHtml(hint)}</p>
    </div>`;
  el.addEventListener(
    'touchmove',
    (e) => {
      e.preventDefault();
    },
    { passive: false }
  );
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
}

function hideGpsBusy() {
  document.getElementById('gps-busy-overlay')?.remove();
  document.body.style.overflow = '';
}

async function requestLocationFromUi({ silentOk = false, busyMessage } = {}) {
  showGpsBusy(busyMessage || 'Activando ubicación…');
  try {
    const result = await ensureLocationAccess();
    if (result.ok) {
      if (!silentOk) showToast('Ubicación activada. Ya puede registrar operaciones.');
      return true;
    }
    const err = result.error;
    showToast(err?.message || 'No se pudo activar la ubicación.', 'err', {
      actionLabel: err?.code === 'denied' || err?.code === 'insecure' ? '' : 'Reintentar',
      onAction: err?.code === 'denied' || err?.code === 'insecure' ? null : () => requestLocationFromUi(),
      duration: 9000,
    });
    return false;
  } finally {
    hideGpsBusy();
  }
}

function bindGpsBanner() {
  document.getElementById('btn-enable-gps')?.addEventListener('click', async () => {
    const ok = await requestLocationFromUi({ busyMessage: 'Activando ubicación…' });
    if (ok) render();
  });
}

/** Intento suave al entrar: no bloquea el panel ni muestra alertas. */
async function softPromptLocation() {
  if (hasUsableLocation()) return true;
  locationPrompted = true;
  const result = await ensureLocationAccess();
  return Boolean(result.ok);
}

async function requireGpsOrPrompt() {
  const desktop = isLikelyDesktop();

  // PC: IP (o GPS si el background ya lo mejoró). Sin cascada larga ni modal de 1 min.
  if (desktop) {
    if (!hasUsableLocation()) {
      showGpsBusy('Obteniendo ubicación por red…');
      try {
        const result = await ensureLocationAccess();
        if (!result.ok || !result.fix) {
          throw new LocationError(
            result.error?.message ||
              'No se pudo obtener ubicación por red. Verifique su conexión e intente de nuevo.',
            result.error?.code || 'unavailable'
          );
        }
        return result.fix;
      } finally {
        hideGpsBusy();
      }
    }
    return getGps({
      maximumAge: 600000,
      preferCache: true,
      allowIpFallback: true,
      enableHighAccuracy: false,
    });
  }

  const softAge = 120000;
  const softTimeout = 20000;
  if (hasUsableLocation()) {
    showGpsBusy('Capturando ubicación…');
    try {
      return await getGps({ maximumAge: softAge, timeout: softTimeout, enableHighAccuracy: false });
    } catch {
      /* cae a reintento interactivo */
    } finally {
      hideGpsBusy();
    }
  }
  const ok = await requestLocationFromUi({
    silentOk: true,
    busyMessage: 'Activando ubicación…',
  });
  if (!ok) {
    throw new LocationError(
      'No se pudo obtener la ubicación. Active el GPS e intente de nuevo.',
      getLocationStatus() === 'denied' ? 'denied' : 'unavailable'
    );
  }
  showGpsBusy('Capturando ubicación…');
  try {
    return await getGps({
      maximumAge: 30000,
      timeout: 25000,
      enableHighAccuracy: false,
    });
  } finally {
    hideGpsBusy();
  }
}

function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function iosSwitch(name, checked, { dataAttr = '', id = '' } = {}) {
  return `
    <label class="ios-switch">
      <input ${id ? `id="${id}"` : ''} type="checkbox" name="${name}" ${checked ? 'checked' : ''} ${dataAttr} />
      <span class="ios-slider"></span>
    </label>
  `;
}

function optionsHtml(list, selectedValue = '') {
  if (!list.length) {
    return `<option value="">Sin opciones configuradas</option>`;
  }
  return list
    .map(
      (o) =>
        `<option value="${escapeHtml(o.label)}" ${
          o.label === selectedValue ? 'selected' : ''
        }>${escapeHtml(o.label)}</option>`
    )
    .join('');
}

function shell(content, { title = '', showBack = false, backTo = '/', wide = false } = {}) {
  const state = getState();
  const user = state.session;
  const maxW = wide ? 'max-w-6xl' : 'max-w-3xl';
  return `
    <div class="relative min-h-screen">
      <div class="pointer-events-none absolute inset-0 overflow-hidden">
        <div class="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-red-100/70 blur-3xl animate-pulse" style="animation-duration:6s"></div>
        <div class="absolute -left-16 bottom-0 h-64 w-64 rounded-full bg-slate-200/80 blur-3xl"></div>
      </div>

      <header class="relative z-10 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div class="mx-auto flex w-full ${maxW} items-center justify-between gap-3 px-3 py-3 sm:px-4">
          <div class="flex items-center gap-3">
            ${
              showBack
                ? `<button data-back="${backTo}" class="rounded-full border border-slate-200 p-2 text-slate-600 transition hover:border-red-200 hover:text-red-600 hover:scale-105" aria-label="Volver">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
                  </button>`
                : ''
            }
            <img src="/logo-red.png" alt="RED" class="h-12 w-12 object-contain transition-transform duration-300 hover:scale-105" />
            <div>
              <div class="text-xs font-bold uppercase tracking-[0.2em] text-red-600">RED</div>
              <div class="text-sm font-black text-slate-900">${title || 'Gestión de Ventas'}</div>
            </div>
          </div>
          ${
            user
              ? `<div class="flex items-center gap-2">
                  <div class="hidden text-right sm:block">
                    <div class="text-xs font-bold text-slate-900">${escapeHtml(user.nombre)}</div>
                    <div class="text-[11px] text-slate-500">${escapeHtml(user.cargo || '')}</div>
                  </div>
                  <button id="btn-logout" class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-red-200 hover:text-red-600">Salir</button>
                </div>`
              : ''
          }
        </div>
      </header>

      <main class="relative z-10 mx-auto w-full ${maxW} px-3 sm:px-4 py-5 sm:py-6 pb-24">
        <div id="view-root" class="page-enter">${content}</div>
      </main>
      <div id="toast" class="hidden"></div>
    </div>
  `;
}

function bindShell(logoutTo = '/') {
  document.querySelectorAll('[data-back]').forEach((btn) => {
    btn.addEventListener('click', () => go(btn.dataset.back));
  });
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await logout();
    go(logoutTo, { replace: true });
  });
  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => go(btn.dataset.nav));
  });
}

function homeForRole(user) {
  if (user?.rol === 'admin') return '/admin';
  return '/';
}

function renderLogin() {
  app.innerHTML = shell(
    `
    <div class="mx-auto mt-8 max-w-md">
      <div class="mb-8 text-center">
        <img src="/logo-red.png" alt="RED" class="mx-auto mb-4 h-24 w-24 object-contain drop-shadow-sm" />
        <h1 class="text-2xl font-black tracking-tight text-slate-900">Gestión de Ventas</h1>
        <p class="mt-2 text-sm text-slate-500">Inicie sesión con su usuario. El panel depende de su rol.</p>
      </div>
      <form id="login-form" class="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Usuario o correo</label>
          <input name="usuario" required autocomplete="username" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/20" placeholder="usuario o correo" />
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Contraseña</label>
          <input name="password" type="password" required autocomplete="current-password" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/20" placeholder="••••••••" />
        </div>
        <button class="inline-flex w-full items-center justify-center rounded-xl bg-red-600 px-5 py-3.5 text-sm font-black uppercase tracking-tight text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-red-700">Ingresar</button>
      </form>
    </div>
    `,
    { title: 'Acceso' }
  );

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button');
    if (btn) btn.disabled = true;
    try {
      const user = await login(String(fd.get('usuario')).trim(), fd.get('password'), '');
      if (!user) {
        showToast('Credenciales inválidas.', 'err');
        return;
      }
      locationPrompted = false;
      if (user.rol === 'admin') {
        go('/admin', { replace: true });
        return;
      }
      go('/', { replace: true });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Ingresar';
      }
    }
  });
}

const ICONS = {
  salida: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`,
  visita: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`,
  reintegro: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 10v-1m9-5a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
  cliente: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg>`,
  config: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`,
  carga: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>`,
  solicitudes: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>`,
  catalogos: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>`,
  usuarios: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>`,
};

function actionCard(path, title, desc, iconKey, { disabled = false, badge = '' } = {}) {
  if (disabled) {
    return `
    <div class="flex h-full min-h-[132px] w-full flex-col rounded-2xl border border-slate-200 bg-slate-50 p-3.5 text-left opacity-70 sm:p-4" aria-disabled="true">
      <div class="mb-3 flex items-start justify-between gap-2">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-200 text-slate-400">
          ${ICONS[iconKey] || ''}
        </div>
        ${badge ? `<span class="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">${escapeHtml(badge)}</span>` : ''}
      </div>
      <div class="text-sm font-black leading-tight text-slate-500 sm:text-[15px]">${title}</div>
      <p class="mt-1 text-[11px] leading-snug text-slate-400 sm:text-xs">${desc}</p>
    </div>`;
  }
  return `
    <button data-nav="${path}" class="card-lift group flex h-full min-h-[132px] w-full flex-col rounded-2xl border border-slate-200 bg-white p-3.5 text-left shadow-sm sm:p-4">
      <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-600 transition group-hover:bg-red-600 group-hover:text-white">
        ${ICONS[iconKey] || ''}
      </div>
      <div class="text-sm font-black leading-tight text-slate-900 sm:text-[15px]">${title}</div>
      <p class="mt-1 text-[11px] leading-snug text-slate-500 sm:text-xs">${desc}</p>
    </button>
  `;
}

function clientFieldsHtml({
  nameField,
  contactField,
  phoneField,
  selected = '',
  contactValue = '',
  phoneValue = '',
  contactLabel = 'Nombre de contacto',
  phoneLabel = 'Teléfono',
  items = null,
  withContactPicker = false,
  freeForm = false,
} = {}) {
  const phoneBlock = phoneField
    ? field(phoneLabel, phoneField, {
        type: 'tel',
        placeholder: 'Ej. 7777-8888',
        required: false,
        value: phoneValue,
      })
    : '';

  if (freeForm || (!isCatalogoClientesActivo() && !items)) {
    return `
      ${field('Cliente', nameField, { placeholder: 'Nombre de la empresa o cliente', value: selected })}
      ${field(contactLabel, contactField, { placeholder: 'Persona de contacto', required: false, value: contactValue })}
      ${phoneBlock}
    `;
  }

  const clients = items || getActiveClients();
  const opts = clients
    .map((c) => {
      const contacts = listClientContacts(c);
      const payload = encodeURIComponent(JSON.stringify(contacts));
      return `<option value="${escapeHtml(c.nombre)}" data-id="${escapeHtml(c.id)}" data-contacto="${escapeHtml(c.contacto || '')}" data-telefono="${escapeHtml(c.telefono || '')}" data-correo="${escapeHtml(c.correo_contacto || '')}" data-ubicacion="${escapeHtml(c.ubicacion || '')}" data-contactos="${payload}" ${
        c.nombre === selected ? 'selected' : ''
      }>${escapeHtml(c.codigo ? `${c.codigo} · ` : '')}${escapeHtml(c.nombre)}</option>`;
    })
    .join('');
  const picker = withContactPicker
    ? `
    <div>
      <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Contacto</label>
      <select name="_contacto_picker" data-contact-picker class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-base sm:text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/20">
        <option value="">Seleccione un contacto</option>
        <option value="__otro__">Otro (escribir nuevo)</option>
      </select>
      <p class="mt-1 text-[11px] text-slate-400">Si elige «Otro», escriba el contacto abajo. Al registrar podrá guardarlo para la próxima vez.</p>
    </div>
    <input type="hidden" name="_cliente_id" value="" />
    <input type="hidden" name="_contacto_nuevo" value="0" />`
    : '';
  return `
    <div>
      <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Cliente</label>
      <select name="${nameField}" required data-client-select="${contactField}" ${
        phoneField ? `data-client-phone="${phoneField}"` : ''
      } ${withContactPicker ? 'data-with-picker="1"' : ''} class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-base sm:text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/20">
        <option value="">Seleccione un cliente</option>
        ${opts || '<option value="" disabled>No hay clientes cargados</option>'}
      </select>
      ${
        !clients.length
          ? `<p class="mt-1 text-[11px] text-amber-700">Catálogo activo: cargue clientes en Admin o solicite un alta.</p>`
          : ''
      }
    </div>
    ${picker}
    ${field(contactLabel, contactField, { placeholder: withContactPicker ? 'Persona de contacto' : 'Se completa al elegir cliente', required: false, value: contactValue })}
    ${phoneBlock}
  `;
}

function bindClientSelect(form, { autofill = true } = {}) {
  form.querySelectorAll('[data-client-select]').forEach((sel) => {
    const contactName = sel.dataset.clientSelect;
    const phoneName = sel.dataset.clientPhone;
    const withPicker = sel.dataset.withPicker === '1';
    const picker = form.querySelector('[data-contact-picker]');
    const clientIdInput = form.querySelector('[name="_cliente_id"]');
    const nuevoFlag = form.querySelector('[name="_contacto_nuevo"]');
    if (!contactName) return;

    const fillPicker = () => {
      if (!picker) return;
      const opt = sel.selectedOptions[0];
      let contacts = [];
      try {
        contacts = JSON.parse(decodeURIComponent(opt?.dataset.contactos || '%5B%5D'));
      } catch {
        contacts = [];
      }
      if (clientIdInput) clientIdInput.value = opt?.dataset.id || '';
      picker.innerHTML =
        '<option value="">Seleccione un contacto</option>' +
        contacts
          .map(
            (c) =>
              `<option value="${escapeHtml(c.nombre)}" data-telefono="${escapeHtml(c.telefono || '')}" data-cargo="${escapeHtml(c.cargo || '')}">${escapeHtml(c.nombre)}${c.cargo ? ` (${escapeHtml(c.cargo)})` : ''}</option>`
          )
          .join('') +
        '<option value="__otro__">Otro (escribir nuevo)</option>';
    };

    const setEditable = (el, editable) => {
      if (!el) return;
      if (editable) {
        el.removeAttribute('readonly');
        el.classList.remove('bg-slate-100', 'text-slate-500', 'cursor-not-allowed');
        el.classList.add('bg-white');
      } else {
        el.setAttribute('readonly', 'readonly');
        el.classList.add('bg-slate-100', 'text-slate-500', 'cursor-not-allowed');
        el.classList.remove('bg-white');
      }
    };
    const applyContact = () => {
      const contactInput = form.querySelector(`[name="${contactName}"]`);
      const phoneInput = phoneName ? form.querySelector(`[name="${phoneName}"]`) : null;
      if (!withPicker || !picker) {
        if (!autofill) return;
        const opt = sel.selectedOptions[0];
        if (contactInput && opt) contactInput.value = opt.dataset.contacto || '';
        if (phoneInput && opt) phoneInput.value = opt.dataset.telefono || '';
        return;
      }
      const pOpt = picker.selectedOptions[0];
      if (!pOpt || pOpt.value === '' || pOpt.value === '__otro__') {
        if (pOpt?.value === '__otro__') {
          if (contactInput) contactInput.value = '';
          if (phoneInput) phoneInput.value = '';
          if (nuevoFlag) nuevoFlag.value = '1';
          setEditable(contactInput, true);
          setEditable(phoneInput, true);
          contactInput?.focus();
        }
        return;
      }
      if (contactInput) contactInput.value = pOpt.value;
      if (phoneInput) phoneInput.value = pOpt.dataset.telefono || '';
      if (nuevoFlag) nuevoFlag.value = '0';
      setEditable(contactInput, false);
      setEditable(phoneInput, false);
    };

    sel.addEventListener('change', () => {
      fillPicker();
      applyContact();
      const opt = sel.selectedOptions[0];
      const punto = form.querySelector('[name="punto_referencia"]');
      if (punto && opt?.dataset.ubicacion) punto.value = opt.dataset.ubicacion;
    });
    picker?.addEventListener('change', applyContact);
    fillPicker();
    if (autofill || withPicker) applyContact();
  });
}

function renderHome() {
  const state = getState();
  const user = state.session;
  const combustible = resolveCombustible(user);
  const notes = getUserNotifications(user.id);
  const unread = notes.filter((n) => !n.leida).length;
  const gpsOk = hasUsableLocation();
  const gpsSource = getLastFix()?.source === 'gps' ? 'GPS' : gpsOk ? 'IP' : '';
  const pendingVisitas = getPendingSalidas(user.id).length;

  app.innerHTML = shell(
    `
    <div class="mb-5">
      <p class="text-xs font-bold uppercase tracking-[0.2em] text-red-600">Panel operativo</p>
      <h2 class="mt-1 text-xl font-black text-slate-900 sm:text-2xl">Hola, ${escapeHtml(user.nombre.split(' ')[0])}</h2>
      <p class="mt-1 text-sm text-slate-500">Seleccione la acción que desea registrar.</p>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <div class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold ${
          combustible ? 'text-emerald-700' : 'text-slate-500'
        }">
          <span class="h-2 w-2 rounded-full ${combustible ? 'bg-emerald-500' : 'bg-slate-300'}"></span>
          Combustible ${combustible ? 'activo' : 'inactivo'}
        </div>
        <div class="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
          gpsOk
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-amber-200 bg-amber-50 text-amber-800'
        }">
          <span class="h-2 w-2 rounded-full ${gpsOk ? 'bg-emerald-500' : 'bg-amber-500'}"></span>
          GPS ${gpsOk ? `activo (${gpsSource})` : 'pendiente'}
        </div>
        ${
          unread
            ? `<button id="btn-notes" class="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold text-red-700">${unread} notificación${unread > 1 ? 'es' : ''}</button>`
            : notes.length
              ? `<button id="btn-notes" class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">Ver notificaciones</button>`
              : ''
        }
      </div>
    </div>


    <div id="notes-panel" class="mb-4 hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div class="mb-2 flex items-center justify-between">
        <h3 class="text-xs font-black uppercase tracking-wider text-slate-900">Notificaciones</h3>
        <button id="btn-notes-close" class="text-xs font-bold text-slate-400">Cerrar</button>
      </div>
      <div class="space-y-2 max-h-56 overflow-y-auto">
        ${
          notes.length
            ? notes
                .slice(0, 12)
                .map(
                  (n) => `
            <div class="rounded-xl border ${n.leida ? 'border-slate-100 bg-slate-50' : 'border-red-100 bg-red-50/50'} px-3 py-2">
              <div class="text-sm font-bold text-slate-900">${escapeHtml(n.titulo)}</div>
              <p class="mt-0.5 text-xs text-slate-600">${escapeHtml(n.mensaje)}</p>
            </div>`
                )
                .join('')
            : '<p class="text-sm text-slate-400">Sin notificaciones.</p>'
        }
      </div>
    </div>

    <div class="stagger grid grid-cols-2 gap-3 sm:gap-4">
      ${actionCard('/salida', 'Registro de salida', gpsOk ? 'Punto de partida y destino.' : 'Requiere ubicación al guardar.', 'salida')}
      ${actionCard(
        '/visita',
        'Reporte de visita',
        pendingVisitas
          ? `${pendingVisitas} pendiente${pendingVisitas > 1 ? 's' : ''} por reportar.`
          : gpsOk
            ? 'Elija una salida pendiente.'
            : 'Requiere ubicación al cerrar la visita.',
        'visita'
      )}
      ${actionCard('/cartera', 'Mi cartera', 'Sus clientes y contactos.', 'usuarios')}
      ${actionCard(
        '/citas',
        'Programar citas',
        isJefe(user) ? 'Agende visitas a su equipo o a usted.' : 'Programe visitas para usted.',
        'salida'
      )}
      ${actionCard(
        '/dashboard',
        'Dashboard',
        isJefe(user) ? 'Visitas y pendientes de su equipo.' : 'Sus visitas, salidas y métricas.',
        'solicitudes'
      )}
      ${
        isJefe(user)
          ? actionCard(
              '/solicitudes',
              'Solicitudes del equipo',
              'Aprobar o rechazar altas a cartera.',
              'solicitudes'
            )
          : actionCard('/solicitudes', 'Mis solicitudes', 'Disponible cuando la cartera se conecte con SAN.', 'solicitudes', {
              disabled: true,
              badge: 'Próximamente',
            })
      }
      ${combustible ? actionCard('/reintegro', 'Reintegro', 'Solicitud del periodo.', 'reintegro') : ''}
    </div>
    ${
      !isCatalogoClientesActivo()
        ? `<p class="mt-3 text-center text-[11px] text-slate-400">Modo libre: puede escribir el cliente a mano. El catálogo se activa desde Administración.</p>`
        : ''
    }
    `,
    { title: 'Inicio' }
  );
  bindShell('/');
  bindGpsBanner();

  const panel = document.getElementById('notes-panel');
  document.getElementById('btn-notes')?.addEventListener('click', () => {
    panel.classList.toggle('hidden');
    markNotificationsRead(user.id);
  });
  document.getElementById('btn-notes-close')?.addEventListener('click', () => {
    panel.classList.add('hidden');
  });

  if (!locationPrompted) {
    void softPromptLocation().then((ok) => {
      if (ok) render();
    });
  }
}

function field(label, name, { type = 'text', required = true, value = '', placeholder = '', rows, disabled = false, readonly = false } = {}) {
  const lockCls = disabled || readonly ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'bg-white';
  const lockAttr = disabled ? 'disabled' : readonly ? 'readonly' : '';
  if (type === 'textarea') {
    return `
      <div>
        <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">${label}</label>
        <textarea name="${name}" rows="${rows || 3}" ${required && !disabled ? 'required' : ''} ${lockAttr} placeholder="${placeholder}" class="w-full rounded-xl border border-slate-200 ${lockCls} px-4 py-3.5 text-base sm:text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/20">${escapeHtml(value)}</textarea>
      </div>`;
  }
  if (type === 'select') {
    return `
      <div>
        <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">${label}</label>
        <select name="${name}" ${required && !disabled ? 'required' : ''} ${lockAttr} class="w-full rounded-xl border border-slate-200 ${lockCls} px-4 py-3.5 text-base sm:text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/20">${value}</select>
      </div>`;
  }
  return `
    <div>
      <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">${label}</label>
      <input name="${name}" type="${type}" ${required && !disabled ? 'required' : ''} ${lockAttr} value="${escapeHtml(value)}" placeholder="${placeholder}" class="w-full rounded-xl border border-slate-200 ${lockCls} px-4 py-3.5 text-base sm:text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/20" />
    </div>`;
}

function catalogOptionsHtml(items, selectedLabel = '') {
  const active = (items || []).filter((x) => x.activo !== false);
  const opts = active
    .map(
      (x) =>
        `<option value="${escapeHtml(x.label)}" ${x.label === selectedLabel ? 'selected' : ''}>${escapeHtml(x.label)}</option>`
    )
    .join('');
  return `<option value="">Seleccione…</option>${opts}`;
}

function bindFormSubmit(formId, handler) {
  const form = document.getElementById(formId);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submit-btn');
    const original = btn.textContent;
    btn.disabled = true;
    try {
      const fd = new FormData(form);
      const data = {};
      fd.forEach((value, key) => {
        if (key === 'foto') return;
        data[key] = typeof value === 'string' ? value.trim() : value;
      });
      await handler(data, btn, form);
    } catch (err) {
      const isLoc = err?.isLocationError || err instanceof LocationError;
      showToast(err.message || 'Ocurrió un error.', 'err', {
        actionLabel: isLoc ? 'Activar ubicación' : '',
        onAction: isLoc
          ? async () => {
              const ok = await requestLocationFromUi();
              if (ok) render();
            }
          : null,
        duration: isLoc ? 10000 : 3600,
      });
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
}

/** Pantalla previa: Cliente de cartera vs Prospección. */
function destinoChooserHtml(basePath, { subtitle = '' } = {}) {
  return `
    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      ${subtitle ? `<p class="mb-4 text-sm text-slate-500">${subtitle}</p>` : ''}
      <p class="mb-3 text-xs font-black uppercase tracking-wider text-slate-400">¿A dónde va?</p>
      <div class="grid gap-3 sm:grid-cols-2">
        <button type="button" data-nav="${escapeHtml(`${basePath}?modo=cliente`)}" class="card-lift rounded-2xl border-2 border-slate-200 bg-slate-50 px-5 py-8 text-left transition hover:border-red-300 hover:bg-red-50/40">
          <div class="text-lg font-black text-slate-900">Cliente</div>
          <p class="mt-1 text-sm text-slate-500">Visita a un cliente activo de su cartera.</p>
        </button>
        <button type="button" data-nav="${escapeHtml(`${basePath}?modo=prospecto`)}" class="card-lift rounded-2xl border-2 border-slate-200 bg-slate-50 px-5 py-8 text-left transition hover:border-red-300 hover:bg-red-50/40">
          <div class="text-lg font-black text-slate-900">Prospección</div>
          <p class="mt-1 text-sm text-slate-500">Territorio o contacto que aún no está en cartera.</p>
        </button>
      </div>
    </section>`;
}

function prospectoFieldsHtml({ namePrefix = '', required = false, seller = null } = {}) {
  const n = (s) => (namePrefix ? `${namePrefix}${s}` : s);
  const user = seller || getState().session;
  const guardados = getProspectosDe(user);
  const opts =
    '<option value="">Nuevo prospecto…</option>' +
    guardados
      .map(
        (p) =>
          `<option value="${escapeHtml(p.id)}" data-nombre="${escapeHtml(p.nombre)}" data-contacto="${escapeHtml(p.contacto || '')}" data-telefono="${escapeHtml(p.telefono || '')}" data-nit="${escapeHtml(p.nit || '')}">${escapeHtml(p.nombre)}${p.nit ? ` · NIT ${escapeHtml(p.nit)}` : ''}</option>`
      )
      .join('');
  return `
    <input type="hidden" name="tipo_destino" value="prospecto" />
    <div>
      <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Modalidad de prospección</label>
      <select name="modalidad_prospecto" id="modalidad-prospecto" required class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-base sm:text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20">
        <option value="territorio">Territorio (zona / movilización)</option>
        <option value="contacto">Contacto (prospecto conocido)</option>
      </select>
    </div>
    <div id="prospecto-territorio" class="space-y-4">
      ${field('Territorio / zona', n('territorio_prospecto'), { required, placeholder: 'Ej. zona metropolitana, oriente, Merliot' })}
      ${field('Notas de prospección', n('notas_prospecto'), { type: 'textarea', required: false, placeholder: 'Qué busca en esa zona (opcional)' })}
    </div>
    <div id="prospecto-contacto" class="hidden space-y-4">
      <div>
        <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Prospecto en cartera</label>
        <select name="prospecto_guardado_id" id="prospecto-guardado" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-base sm:text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20">
          ${opts}
        </select>
        <p class="mt-1 text-[11px] text-slate-400">Elija uno ya guardado o cree uno nuevo con NIT.</p>
      </div>
      <div id="prospecto-nuevo-fields" class="space-y-4">
        ${field('Empresa o prospecto', n('cliente_registro_salida_p'), { required: false, placeholder: 'Nombre de la empresa / prospecto' })}
        ${field('NIT', n('nit_prospecto'), { required: false, placeholder: 'NIT de facturación (único)' })}
        ${field('Nombre de contacto', n('contacto_registro_salida_p'), { required: false, placeholder: 'Persona de contacto (opcional)' })}
        ${field('Teléfono', n('telefono_registro_salida_p'), { type: 'tel', required: false })}
      </div>
    </div>`;
}

function bindProspectoModalidad(root = document) {
  const modSel = root.querySelector('#modalidad-prospecto') || document.getElementById('modalidad-prospecto');
  const pTerr = root.querySelector('#prospecto-territorio') || document.getElementById('prospecto-territorio');
  const pCont = root.querySelector('#prospecto-contacto') || document.getElementById('prospecto-contacto');
  const guardado = root.querySelector('#prospecto-guardado') || document.getElementById('prospecto-guardado');
  const nuevoFields = root.querySelector('#prospecto-nuevo-fields') || document.getElementById('prospecto-nuevo-fields');
  const sync = () => {
    const isTerr = modSel?.value !== 'contacto';
    pTerr?.classList.toggle('hidden', !isTerr);
    pCont?.classList.toggle('hidden', isTerr);
    if (!isTerr) syncProspectoGuardado();
  };
  const syncProspectoGuardado = () => {
    const usingSaved = Boolean(guardado?.value);
    nuevoFields?.classList.toggle('hidden', usingSaved);
  };
  modSel?.addEventListener('change', sync);
  guardado?.addEventListener('change', syncProspectoGuardado);
  sync();
}

/**
 * Resuelve datos de prospección por contacto: prospecto guardado o nuevo con NIT.
 * Persiste en cartera vía createProspect. Lanza Error con mensaje de UI si falla.
 */
function resolveProspectoContacto(data, seller) {
  const savedId = String(data.prospecto_guardado_id || '').trim();
  if (savedId) {
    const existing = getProspectosDe(seller).find((p) => p.id === savedId);
    if (!existing) throw new Error('El prospecto seleccionado ya no está en su cartera.');
    return {
      clienteId: existing.id,
      clienteNombre: existing.nombre,
      contacto: existing.contacto || '',
      telefono: existing.telefono || '',
      nit: existing.nit || '',
      prospect: existing,
    };
  }

  const nombre = String(data.cliente_registro_salida_p || '').trim();
  const nit = String(data.nit_prospecto || '').trim();
  const contacto = String(data.contacto_registro_salida_p || '').trim();
  const telefono = String(data.telefono_registro_salida_p || '').trim();
  if (!nombre) throw new Error('Indique el nombre del prospecto o empresa.');
  if (!normalizeNit(nit)) throw new Error('Indique el NIT del prospecto (evita duplicados).');

  const { prospect, conflict, reused } = createProspect(
    { nombre, contacto, telefono, nit },
    seller
  );
  if (conflict) {
    throw new Error(
      `Ese NIT ya está registrado como prospecto de ${conflict.vendedorNombre || 'otro ejecutivo'} (${conflict.nombre}).`
    );
  }
  return {
    clienteId: prospect.id,
    clienteNombre: prospect.nombre,
    contacto: prospect.contacto || contacto,
    telefono: prospect.telefono || telefono,
    nit: prospect.nit || nit,
    prospect,
    reused,
  };
}

async function notifyCitaMake(cita, creator) {
  const state = getState();
  const seller =
    (state.users || []).find((u) => u.id === cita.vendedorId) ||
    (creator?.id === cita.vendedorId ? creator : null);
  try {
    await sendToMake({
      formulario: 'programar_cita',
      cita_id: cita.id,
      cita_fecha: cita.fecha || '',
      cita_hora: cita.hora || '',
      cita_cliente: cita.clienteNombre || '',
      cita_contacto: cita.contacto || '',
      cita_telefono: cita.telefono || '',
      cita_objetivo: cita.objetivo || '',
      cita_tipo_destino: cita.tipoDestino || 'cliente',
      cita_vendedor_id: cita.vendedorId || '',
      cita_vendedor_nombre: cita.vendedorNombre || seller?.nombre || '',
      cita_vendedor_correo: seller?.correo || '',
      correo_vendedor: seller?.correo || creator?.correo || '',
      nombre_vendedor: seller?.nombre || creator?.nombre || '',
    });
  } catch (err) {
    console.warn('programar_cita Make', err);
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function timeToMinutes(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutesToTime(total) {
  const t = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`;
}

/** Ventana de salida: fecha = hoy; hora entre ahora y ahora+30 min. */
function salidaTimeWindow() {
  const now = new Date();
  const fecha = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const cur = now.getHours() * 60 + now.getMinutes();
  const minHora = minutesToTime(cur);
  const maxHora = minutesToTime(cur + 30);
  return { fecha, minHora, maxHora, horaDefault: minHora };
}

function assertSalidaTimeWindow(fecha, hora) {
  const win = salidaTimeWindow();
  if (String(fecha) !== win.fecha) {
    throw new Error('La fecha de salida debe ser la de hoy.');
  }
  const mins = timeToMinutes(hora);
  const minM = timeToMinutes(win.minHora);
  const maxM = timeToMinutes(win.maxHora);
  if (mins == null || minM == null || maxM == null || mins < minM || mins > maxM) {
    throw new Error(`La hora debe estar entre ${win.minHora} y ${win.maxHora} (máximo 30 minutos desde ahora).`);
  }
}

function renderSalida() {
  const win = salidaTimeWindow();
  const user = getState().session;
  const tipos = resolveOptions(user, 'tipos_salida');
  const params = new URLSearchParams(location.search);
  const citaId = params.get('cita') || '';
  const reprogramId = params.get('reprogram') || '';
  const modo = params.get('modo') === 'prospecto' ? 'prospecto' : params.get('modo') === 'cliente' ? 'cliente' : '';
  const citaRaw = citaId ? getCitaById(citaId) : null;
  let cita =
    citaRaw && citaRaw.vendedorId === user.id && citaRaw.estado === 'programada' ? citaRaw : null;
  const destinoItems = getClientesDe(user);
  const hoy = win.fecha;
  if (cita && cita.fecha !== hoy) {
    showToast('Solo puede continuar una cita programada para hoy. Reprográmela si cambió de día.', 'err');
    cita = null;
    history.replaceState({}, '', '/salida');
  }
  const citasPendientes = getCitasForUser(user.id)
    .filter((c) => c.estado === 'programada')
    .sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`));

  const inboxHtml =
    !cita && !reprogramId && !modo && citasPendientes.length
      ? `<section class="mb-4 rounded-2xl border border-red-100 bg-white p-4 shadow-sm">
        <h3 class="text-xs font-black uppercase tracking-wider text-slate-900">Citas pendientes de registrar salida</h3>
        <p class="mt-1 text-xs text-slate-500">Solo puede continuar si la cita es para hoy. Si cambió de día, use Reprogramar.</p>
        <div class="mt-3 space-y-2">
          ${citasPendientes
            .map((c) => {
              const isToday = c.fecha === hoy;
              return `
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
              <div class="min-w-0">
                <div class="text-sm font-bold text-slate-900">${escapeHtml(c.clienteNombre)}</div>
                <p class="text-[11px] text-slate-500">${escapeHtml(c.fecha)}${c.hora ? ` · ${escapeHtml(c.hora)}` : ''} · ${escapeHtml(c.creadoPorNombre || 'Agenda')}${isToday ? '' : ' · Fecha futura'}</p>
              </div>
              <div class="flex shrink-0 flex-wrap gap-2">
                <button type="button" data-reprogram-cita="${c.id}" class="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-black uppercase tracking-tight text-slate-700 hover:bg-slate-100">Reprogramar</button>
                <button type="button" data-cita-salida="${c.id}" ${isToday ? '' : 'disabled'} class="rounded-xl px-3.5 py-2 text-xs font-black uppercase tracking-tight ${isToday ? 'bg-red-600 text-white hover:bg-red-700' : 'cursor-not-allowed bg-slate-200 text-slate-400'}">Continuar</button>
              </div>
            </div>`;
            })
            .join('')}
        </div>
      </section>`
      : '';

  const reprogramCitaObj =
    reprogramId && !cita
      ? getCitasForUser(user.id).find((c) => c.id === reprogramId && c.estado === 'programada')
      : null;

  if (reprogramCitaObj) {
    app.innerHTML = shell(
      `
      <form id="form-reprogram" class="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p class="text-sm text-slate-600">Reprogramar visita a <strong>${escapeHtml(reprogramCitaObj.clienteNombre)}</strong>.</p>
        <div class="grid gap-4 sm:grid-cols-2">
          ${field('Nueva fecha', 'fecha', { type: 'date', value: reprogramCitaObj.fecha || hoy })}
          ${field('Nueva hora', 'hora', { type: 'time', value: reprogramCitaObj.hora || win.horaDefault, required: false })}
        </div>
        <div class="flex gap-2">
          <button id="submit-btn" class="flex-1 rounded-xl bg-red-600 px-5 py-3.5 text-sm font-black uppercase text-white hover:bg-red-700">Guardar nueva fecha</button>
          <button type="button" data-nav="/salida" class="rounded-xl border border-slate-200 px-4 py-3.5 text-sm font-bold text-slate-600">Cancelar</button>
        </div>
      </form>
      `,
      { title: 'Reprogramar cita', showBack: true, backTo: '/salida' }
    );
    bindShell('/');
    bindFormSubmit('form-reprogram', async (data) => {
      if (!data.fecha) {
        showToast('Indique la nueva fecha.', 'err');
        return;
      }
      reprogramCita(reprogramCitaObj.id, { fecha: data.fecha, hora: data.hora || '' });
      showToast('Cita reprogramada.');
      go('/salida');
    });
    return;
  }

  // Paso 1: elegir Cliente vs Prospección
  if (!cita && !modo) {
    app.innerHTML = shell(
      `
      ${inboxHtml}
      ${destinoChooserHtml('/salida', {
        subtitle: 'Elija si registra salida hacia un cliente de cartera o una prospección.',
      })}
      `,
      { title: 'Registro de salida', showBack: true, backTo: '/' }
    );
    bindShell('/');
    document.querySelectorAll('[data-cita-salida]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        go(`/salida?cita=${encodeURIComponent(btn.dataset.citaSalida)}`);
      });
    });
    document.querySelectorAll('[data-reprogram-cita]').forEach((btn) => {
      btn.addEventListener('click', () => {
        go(`/salida?reprogram=${encodeURIComponent(btn.dataset.reprogramCita)}`);
      });
    });
    return;
  }

  const esProspecto = !cita && modo === 'prospecto';
  const destinoBlock = cita
    ? clientFieldsHtml({
        nameField: 'cliente_registro_salida',
        contactField: 'contacto_registro_salida',
        phoneField: 'telefono_registro_salida',
        selected: cita.clienteNombre || '',
        contactValue: cita.contacto || '',
        phoneValue: cita.telefono || '',
        items: null,
        withContactPicker: false,
        freeForm: false,
      })
    : esProspecto
      ? prospectoFieldsHtml()
      : `<input type="hidden" name="tipo_destino" value="cliente" />
        ${clientFieldsHtml({
          nameField: 'cliente_registro_salida',
          contactField: 'contacto_registro_salida',
          phoneField: 'telefono_registro_salida',
          selected: '',
          contactValue: '',
          phoneValue: '',
          items: destinoItems,
          withContactPicker: true,
          freeForm: false,
        })}`;

  app.innerHTML = shell(
    `
    <form id="form-salida" class="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      ${locationBannerHtml()}
      ${
        cita
          ? `<div class="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">Cita programada por <strong>${escapeHtml(cita.creadoPorNombre)}</strong>. Los datos del cliente ya vienen cargados. <a href="/salida" data-nav="/salida" class="font-bold underline">Cancelar y volver al buzón</a></div>`
          : `<div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              <span>${esProspecto ? 'Prospección' : 'Cliente de cartera'}</span>
              <a href="/salida" data-nav="/salida" class="text-xs font-bold text-red-600 underline">Cambiar tipo</a>
            </div>`
      }
      <div class="grid gap-4 sm:grid-cols-2">
        ${field('Fecha', 'fecha_registro_salida', { type: 'date', value: win.fecha, disabled: true })}
        <div>
          <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Hora</label>
          <input name="hora_registro_salida" type="time" required value="${escapeHtml(win.horaDefault)}" min="${escapeHtml(win.minHora)}" max="${escapeHtml(win.maxHora)}" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-base sm:text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/20" />
          <p class="mt-1 text-[11px] text-slate-400">Entre ${escapeHtml(win.minHora)} y ${escapeHtml(win.maxHora)}.</p>
        </div>
      </div>
      ${destinoBlock}
      ${field('Tipo de salida', 'tipo_registro_salida', {
        type: 'select',
        required: tipos.length > 0,
        value: optionsHtml(tipos),
      })}
      ${field('Punto de referencia', 'punto_referencia', {
        placeholder: cita ? 'Referencia del destino' : 'Referencia del destino o zona',
        value: '',
      })}
      ${field('Objetivo de la visita', 'objetivo_registro_salida', {
        type: 'textarea',
        placeholder: '¿Qué se busca lograr?',
        value: cita?.objetivo || '',
      })}
      <button id="submit-btn" class="inline-flex w-full items-center justify-center rounded-xl bg-red-600 px-5 py-3.5 text-sm font-black uppercase tracking-tight text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-red-700">Registrar salida</button>
    </form>
    `,
    { title: 'Registro de salida', showBack: true, backTo: '/' }
  );
  bindShell('/');
  bindGpsBanner();

  const form = document.getElementById('form-salida');
  if (esProspecto) {
    bindProspectoModalidad(form);
  } else {
    bindClientSelect(form, { autofill: Boolean(cita) });
  }

  bindFormSubmit('form-salida', async (data, btn) => {
    const session = getState().session;
    assertSalidaTimeWindow(win.fecha, data.hora_registro_salida);
    data.fecha_registro_salida = win.fecha;

    const tipoDestino = cita ? 'cliente' : String(data.tipo_destino || 'cliente');
    const modalidad = String(data.modalidad_prospecto || 'territorio');
    let prospectoId = '';
    let prospectoNit = '';
    if (tipoDestino === 'prospecto') {
      if (modalidad === 'territorio') {
        const terr = String(data.territorio_prospecto || '').trim();
        if (!terr) throw new Error('Indique el territorio o zona de prospección.');
        data.cliente_registro_salida = `Prospección · ${terr}`;
        data.contacto_registro_salida = '';
        data.telefono_registro_salida = '';
        if (!String(data.punto_referencia || '').trim()) data.punto_referencia = terr;
        if (!String(data.objetivo_registro_salida || '').trim() && data.notas_prospecto) {
          data.objetivo_registro_salida = String(data.notas_prospecto);
        }
      } else {
        const resolved = resolveProspectoContacto(data, session);
        data.cliente_registro_salida = resolved.clienteNombre;
        data.contacto_registro_salida = resolved.contacto;
        data.telefono_registro_salida = resolved.telefono;
        prospectoId = resolved.clienteId;
        prospectoNit = resolved.nit;
      }
    } else {
      const esNuevo = String(data._contacto_nuevo || '') === '1';
      const clienteId = String(data._cliente_id || '').trim();
      const nombreContacto = String(data.contacto_registro_salida || '').trim();
      if (esNuevo && clienteId && nombreContacto) {
        const guardar = confirm(
          `¿Desea registrar «${nombreContacto}» como contacto nuevo de este cliente? Así aparecerá la próxima vez en la lista.`
        );
        if (guardar) {
          addClientContact(
            clienteId,
            {
              nombre: nombreContacto,
              telefono: data.telefono_registro_salida || '',
            },
            session
          );
        }
      }
    }

    const {
      _contacto_picker: _p,
      _cliente_id: _c,
      _contacto_nuevo: _n,
      tipo_destino: _td,
      modalidad_prospecto: _mp,
      territorio_prospecto: _tp,
      notas_prospecto: _np,
      cliente_registro_salida_p: _cp,
      contacto_registro_salida_p: _ctp,
      telefono_registro_salida_p: _tpp,
      nit_prospecto: _nit,
      prospecto_guardado_id: _pg,
      ...payload
    } = data;
    payload.fecha_registro_salida = win.fecha;
    payload.tipo_destino = tipoDestino;
    payload.modalidad_prospecto = tipoDestino === 'prospecto' ? modalidad : '';
    if (prospectoId) payload.prospecto_id = prospectoId;
    if (prospectoNit) payload.nit_prospecto = prospectoNit;

    btn.textContent = 'Obteniendo GPS…';
    const gps = await requireGpsOrPrompt();
    btn.textContent = 'Enviando…';
    const result = await sendToMake({
      formulario: 'registro_salidas',
      ...payload,
      latitud_registro_salidas: gps.latitud,
      longitud_registro_salidas: gps.longitud,
      gps_accuracy_salida: gps.accuracy,
    });
    const { salida } = createPendingSalida(
      {
        ...payload,
        latitud_registro_salidas: gps.latitud,
        longitud_registro_salidas: gps.longitud,
        gps_accuracy_salida: gps.accuracy,
      },
      session
    );
    if (cita) markCitaRegistrada(cita.id, salida.id);
    showToast(`${result.message} GPS: ${gps.latitud}, ${gps.longitud}`);
    go('/');
  });
}

function readonlyInfo(label, value) {
  return `
    <div class="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
      <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">${label}</div>
      <div class="mt-0.5 text-sm font-semibold text-slate-900 break-words">${escapeHtml(value || '—')}</div>
    </div>`;
}

function renderVisitaBacklog() {
  const user = getState().session;
  const pending = getPendingSalidas(user.id);

  app.innerHTML = shell(
    `
    <div class="mb-4">
      <p class="text-xs font-bold uppercase tracking-[0.2em] text-red-600">Visitas pendientes</p>
      <h2 class="mt-1 text-xl font-black text-slate-900">Backlog de salidas</h2>
      <p class="mt-1 text-sm text-slate-500">Seleccione una salida registrada para completar el reporte de visita.</p>
    </div>
    ${locationBannerHtml()}
    ${
      pending.length
        ? `<div class="stagger space-y-3">
            ${pending
              .map(
                (s) => `
              <button data-nav="/visita/${s.id}" class="card-lift w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-black text-slate-900 truncate">${escapeHtml(s.cliente_registro_salida || 'Sin cliente')}</div>
                    <div class="mt-1 text-xs text-slate-500">${escapeHtml(s.fecha_registro_salida || '')} · ${escapeHtml(s.hora_registro_salida || '')}</div>
                    <div class="mt-1 text-xs text-slate-600">${escapeHtml(s.tipo_registro_salida || 'Sin tipo')} · ${escapeHtml(s.contacto_registro_salida || 'Sin contacto')}${s.telefono_registro_salida ? ` · ${escapeHtml(s.telefono_registro_salida)}` : ''}</div>
                    ${s.punto_referencia ? `<div class="mt-1 text-[11px] text-slate-400 truncate">${escapeHtml(s.punto_referencia)}</div>` : ''}
                  </div>
                  <span class="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-800">Pendiente</span>
                </div>
              </button>`
              )
              .join('')}
          </div>`
        : `<div class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-5 text-sm text-amber-900">
            No tiene salidas pendientes. Primero registre una <strong>salida</strong>; luego podrá reportar la visita desde aquí.
            <button data-nav="/salida" class="mt-3 inline-flex rounded-xl bg-red-600 px-4 py-2 text-xs font-black uppercase text-white">Ir a registro de salida</button>
          </div>`
    }
    `,
    { title: 'Reporte de visita', showBack: true, backTo: '/' }
  );
  bindShell('/');
  bindGpsBanner();
}

function renderVisitaForm(salidaId) {
  const { hora } = nowParts();
  const user = getState().session;
  const salida = getSalidaById(salidaId);
  if (!salida || salida.vendedorId !== user.id || salida.estado !== 'pendiente') {
    showToast('Esa salida no está disponible o ya fue reportada.', 'err');
    go('/visita', { replace: true });
    return;
  }

  const tiposVisita = resolveOptions(user, 'tipos_visita');
  const transporteDefault = user.transporte_default || '';
  const pagoDefault = user.pago_combustible_default || '';
  const fechaSalida = salida.fecha_registro_salida || '';
  const hoyFecha = nowParts().fecha;
  const diasRetraso = fechaSalida
    ? Math.max(
        0,
        Math.round(
          (new Date(`${hoyFecha}T12:00:00`) - new Date(`${fechaSalida}T12:00:00`)) / 86400000
        )
      )
    : 0;
  const esTardio = diasRetraso > 0;
  const fechaReporte = hoyFecha;

  app.innerHTML = shell(
    `
    <form id="form-visita" class="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:space-y-6 sm:p-6">
      ${locationBannerHtml()}
      <details class="group rounded-2xl border border-slate-200 bg-slate-50/80">
        <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
          <div class="min-w-0">
            <div class="text-sm font-black text-slate-900 truncate">${escapeHtml(salida.cliente_registro_salida || 'Salida')}</div>
            <p class="mt-0.5 text-[11px] text-slate-500">Ver datos de la salida</p>
          </div>
          <span class="shrink-0 rounded-full border border-slate-200 bg-white p-1.5 text-slate-400 transition group-open:rotate-180">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
          </span>
        </summary>
        <div class="grid gap-3 border-t border-slate-200 px-4 py-4 sm:grid-cols-2 sm:gap-4">
          ${readonlyInfo('Fecha salida', salida.fecha_registro_salida)}
          ${readonlyInfo('Hora salida', salida.hora_registro_salida)}
          ${readonlyInfo('Cliente', salida.cliente_registro_salida)}
          ${readonlyInfo('Nombre de contacto', salida.contacto_registro_salida)}
          ${readonlyInfo('Teléfono', salida.telefono_registro_salida)}
          ${readonlyInfo('Tipo de salida', salida.tipo_registro_salida)}
          ${readonlyInfo('Punto de referencia', salida.punto_referencia)}
          <div class="sm:col-span-2">${readonlyInfo('Objetivo (salida)', salida.objetivo_registro_salida)}</div>
          <div class="sm:col-span-2">${readonlyInfo('GPS salida (punto A)', `${salida.latitud_registro_salidas}, ${salida.longitud_registro_salidas}`)}</div>
        </div>
      </details>

      ${
        esTardio
          ? `<div class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Esta visita se reportará como <strong>tardía</strong>: la salida fue el ${escapeHtml(fechaSalida)} (${diasRetraso} día${diasRetraso > 1 ? 's' : ''} de retraso).</div>`
          : ''
      }
      <div class="space-y-4 sm:space-y-5">
        <h3 class="text-xs font-black uppercase tracking-wider text-red-700">Completar visita</h3>
        <div class="grid gap-4 sm:grid-cols-2 sm:gap-5">
          ${field('Fecha del reporte', 'fecha_reporte_visitas', {
            type: 'date',
            value: fechaReporte,
            disabled: true,
          })}
          ${field('Hora del reporte', 'hora_reporte_visitas', { type: 'time', value: hora })}
        </div>
        <p class="text-[11px] leading-relaxed text-slate-400">La fecha del reporte es la de hoy. Si la salida fue otro día, el reporte queda marcado como tardío.</p>
        ${field('Tipo de visita', 'tipo_visita', {
          type: 'select',
          required: tiposVisita.length > 0,
          value: optionsHtml(tiposVisita),
        })}
        ${field('Informe / resultado', 'informe_visitas', {
          type: 'textarea',
          rows: 4,
          placeholder: '¿Qué ocurrió en la visita?',
        })}
        ${field('Tareas pendientes', 'tareas_pendientes_reporte_visitas', {
          type: 'textarea',
          rows: 3,
          required: false,
        })}
        ${
          resolveCombustible(user)
            ? `<div class="grid gap-4 sm:grid-cols-2 sm:gap-5">
          ${readonlyInfo('Tipo de transporte', transporteDefault || 'Sin asignar (configure en Admin → Usuarios)')}
          ${readonlyInfo('Tipo de pago combustible', pagoDefault || 'Sin asignar (configure en Admin → Usuarios)')}
        </div>
        <p class="text-[11px] leading-relaxed text-slate-400">Transporte y pago los define el administrador en su perfil. Se envían así al reporte.</p>`
            : `<p class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500">Reintegro de combustible desactivado: este reporte no calcula transporte ni pago.</p>`
        }
        <div>
          <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Evidencia fotográfica <span class="font-semibold normal-case tracking-normal text-red-600">*</span></label>
          <input name="foto" type="file" accept="image/*" capture="environment" required class="w-full rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm" />
          <p class="mt-1.5 text-[11px] leading-relaxed text-slate-400">Obligatoria. Tome o adjunte una foto al cerrar la visita.</p>
        </div>
      </div>
      <button id="submit-btn" class="inline-flex w-full items-center justify-center rounded-xl bg-red-600 px-5 py-4 text-sm font-black uppercase tracking-tight text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-red-700">Reportar visita</button>
    </form>
    `,
    { title: 'Completar visita', showBack: true, backTo: '/visita' }
  );
  bindShell('/');
  bindGpsBanner();
  bindFormSubmit('form-visita', async (data, btn, form) => {
    const current = getSalidaById(salidaId);
    if (!current || current.estado !== 'pendiente') {
      throw new Error('La salida ya no está pendiente.');
    }
    const freshUser = getState().session;
    const fuelOn = resolveCombustible(freshUser);
    const transporte = fuelOn ? freshUser?.transporte_default || '' : '';
    const pago = fuelOn ? freshUser?.pago_combustible_default || '' : '';
    if (fuelOn && (!transporte || !pago)) {
      throw new Error('Su perfil no tiene transporte o pago asignados. Contacte al administrador.');
    }
    const file = form.querySelector('input[name="foto"]').files?.[0] || null;
    if (!file) {
      throw new Error('Debe adjuntar una fotografía para cerrar la visita.');
    }
    btn.textContent = 'Obteniendo GPS…';
    const gps = await requireGpsOrPrompt();
    btn.textContent = 'Procesando imagen…';
    const foto = await fileToDataUrl(file);
    const km = distanceKm(
      current.latitud_registro_salidas,
      current.longitud_registro_salidas,
      gps.latitud,
      gps.longitud
    );
    btn.textContent = 'Enviando…';
    const result = await sendToMake({
      formulario: 'reportes_visitas',
      fecha_registro_salida: current.fecha_registro_salida,
      hora_registro_salida: current.hora_registro_salida,
      cliente_registro_salida: current.cliente_registro_salida,
      contacto_registro_salida: current.contacto_registro_salida,
      telefono_registro_salida: current.telefono_registro_salida || '',
      tipo_registro_salida: current.tipo_registro_salida,
      punto_referencia: current.punto_referencia,
      objetivo_registro_salida: current.objetivo_registro_salida,
      latitud_registro_salidas: current.latitud_registro_salidas,
      longitud_registro_salidas: current.longitud_registro_salidas,
      gps_accuracy_salida: current.gps_accuracy_salida,
      fecha_reporte_visitas: nowParts().fecha,
      reporte_tardio: esTardio,
      dias_retraso: diasRetraso,
      hora_reporte_visitas: data.hora_reporte_visitas,
      cliente_reporte_visitas: current.cliente_registro_salida,
      contacto_reporte_visitas: current.contacto_registro_salida,
      telefono_reporte_visitas: current.telefono_registro_salida || '',
      tipo_visita: data.tipo_visita,
      punto_referencia_visitas: current.punto_referencia,
      objetivo_visita: current.objetivo_registro_salida,
      informe_visitas: data.informe_visitas,
      tareas_pendientes_reporte_visitas: data.tareas_pendientes_reporte_visitas,
      tipo_transporte: transporte,
      tipo_pago_combustible: pago,
      latitud_reporte_visitas: gps.latitud,
      longitud_reporte_visitas: gps.longitud,
      gps_accuracy_visita: gps.accuracy,
      distancia_km: km,
      galeria_fotos_reporte_visitas: foto,
    });
    markSalidaVisitada(salidaId, {
      reporte_tardio: esTardio,
      fecha_reporte_real: nowParts().fecha,
      dias_retraso: diasRetraso,
      latitud_reporte_visitas: gps.latitud,
      longitud_reporte_visitas: gps.longitud,
      gps_accuracy_visita: gps.accuracy,
      distancia_km: km,
      tipo_visita: data.tipo_visita,
      informe_visitas: data.informe_visitas,
      tiene_evidencia: true,
    });
    showToast(
      `${result.message}${km != null ? ` · ${km} km` : ''} · GPS visita: ${gps.latitud}, ${gps.longitud}`
    );
    go('/visita');
  });
}

function renderVisita() {
  const path = pathOf();
  const match = path.match(/^\/visita\/([^/]+)$/);
  if (match) {
    renderVisitaForm(decodeURIComponent(match[1]));
    return;
  }
  renderVisitaBacklog();
}

function renderReintegro() {
  if (!resolveCombustible(getState().session)) {
    showToast('El reintegro de combustible está desactivado.', 'err');
    go('/', { replace: true, animate: false });
    return;
  }
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 6);
  const toDate = (d) => d.toISOString().slice(0, 10);

  app.innerHTML = shell(
    `
    <form id="form-reintegro" class="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p class="text-sm text-slate-500">Se solicitará el reintegro de las visitas pendientes del periodo indicado.</p>
      <div class="grid gap-4 sm:grid-cols-2">
        ${field('Inicio del periodo', 'fecha_inicio_periodo', { type: 'date', value: toDate(start) })}
        ${field('Fin del periodo', 'fecha_fin_periodo', { type: 'date', value: toDate(today) })}
      </div>
      ${field('Observaciones', 'observaciones_reintegro', { type: 'textarea', required: false, placeholder: 'Opcional' })}
      <button id="submit-btn" class="inline-flex w-full items-center justify-center rounded-xl bg-red-600 px-5 py-3.5 text-sm font-black uppercase tracking-tight text-white shadow-lg hover:bg-red-700">Solicitar reintegro</button>
    </form>
    `,
    { title: 'Reintegro', showBack: true, backTo: '/' }
  );
  bindShell('/');
  bindFormSubmit('form-reintegro', async (data, btn) => {
    btn.textContent = 'Enviando…';
    const result = await sendToMake({
      formulario: 'solicitud_reintegro',
      ...data,
    });
    showToast(result.message);
    go('/');
  });
}

function renderCitas() {
  const user = getState().session;
  const jefe = isJefe(user);
  const team = jefe ? getTeamVendedores(user) : [];
  const { fecha, hora } = nowParts();
  const params = new URLSearchParams(location.search);
  const modo = params.get('modo') === 'prospecto' ? 'prospecto' : params.get('modo') === 'cliente' ? 'cliente' : '';
  const citas = (getState().citas || [])
    .filter((c) =>
      jefe
        ? c.creadoPorId === user.id ||
          c.vendedorId === user.id ||
          team.some((t) => t.id === c.vendedorId)
        : c.vendedorId === user.id || c.creadoPorId === user.id
    )
    .sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`));

  const citasListHtml = `
    <section class="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 class="text-xs font-black uppercase tracking-wider text-slate-900">Citas programadas</h3>
      <div class="mt-3 space-y-2">
        ${
          citas.length
            ? citas
                .map(
                  (c) => `
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
              <div>
                <div class="text-sm font-bold text-slate-900">${escapeHtml(c.clienteNombre)}${jefe ? ` · ${escapeHtml(c.vendedorNombre)}` : ''}${c.tipoDestino === 'prospecto' ? ' · Prospección' : ''}</div>
                <p class="text-[11px] text-slate-500">${escapeHtml(c.fecha)}${c.hora ? ` · ${escapeHtml(c.hora)}` : ''} · ${escapeHtml(c.estado)}</p>
              </div>
              ${c.estado === 'programada' ? `<button data-cancel-cita="${c.id}" class="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600">Cancelar</button>` : ''}
            </div>`
                )
                .join('')
            : '<p class="text-sm text-slate-400">Aún no ha programado citas.</p>'
        }
      </div>
    </section>`;

  const bindCancelCitas = () => {
    document.querySelectorAll('[data-cancel-cita]').forEach((btn) => {
      btn.addEventListener('click', () => {
        cancelCita(btn.dataset.cancelCita);
        showToast('Cita cancelada.');
        render();
      });
    });
  };

  if (!modo) {
    app.innerHTML = shell(
      `
      ${destinoChooserHtml('/citas', {
        subtitle: jefe
          ? 'Elija si agenda visita a un cliente de cartera o una prospección. El GPS se captura al registrar la salida.'
          : 'Elija Cliente o Prospección. El día de la visita, registre la salida para capturar el GPS.',
      })}
      ${citasListHtml}
      `,
      { title: 'Programar citas', showBack: true, backTo: '/' }
    );
    bindShell('/');
    bindCancelCitas();
    return;
  }

  const esProspecto = modo === 'prospecto';
  const vendedorField = jefe
    ? field('Vendedor', 'vendedorId', {
        type: 'select',
        value: `<option value="${user.id}">${escapeHtml(user.nombre)} (yo)</option>${team
          .filter((t) => t.id !== user.id)
          .map(
            (t) =>
              `<option value="${t.id}">${escapeHtml(t.nombre)} (${escapeHtml(t.pais || '')})</option>`
          )
          .join('')}`,
      })
    : `<input type="hidden" name="vendedorId" value="${user.id}" />`;

  const destinoFields = esProspecto
    ? `<div class="space-y-4 sm:col-span-2">${prospectoFieldsHtml()}</div>`
    : `
        <div class="${jefe ? '' : 'sm:col-span-2'}">
          <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Cliente</label>
          <select name="clienteId" required class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-base sm:text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/20">
            <option value="">Seleccione un cliente</option>
          </select>
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Contacto</label>
          <select name="_contacto_picker" id="cita-contacto-picker" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-base sm:text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20">
            <option value="">Primero elija cliente</option>
          </select>
        </div>
        ${field('Nombre de contacto', 'contacto', { required: false, placeholder: 'Si elige Otro, escríbalo aquí' })}
        ${field('Teléfono', 'telefono', { type: 'tel', required: false, placeholder: 'Ej. 7777-8888' })}`;

  app.innerHTML = shell(
    `
    <form id="form-cita" class="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-600">
        <span>${esProspecto ? 'Prospección' : 'Cliente de cartera'}</span>
        <a href="/citas" data-nav="/citas" class="text-xs font-bold text-red-600 underline">Cambiar tipo</a>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        ${vendedorField}
        ${destinoFields}
        ${field('Fecha', 'fecha', { type: 'date', value: fecha })}
        ${field('Hora', 'hora', { type: 'time', value: hora })}
      </div>
      ${field('Objetivo de la visita', 'objetivo', { type: 'textarea', required: false, placeholder: '¿Qué se busca lograr?' })}
      <button id="submit-btn" class="inline-flex w-full items-center justify-center rounded-xl bg-red-600 px-5 py-3.5 text-sm font-black uppercase tracking-tight text-white shadow-lg hover:bg-red-700">Programar cita</button>
    </form>
    ${citasListHtml}
    `,
    { title: 'Programar citas', showBack: true, backTo: '/' }
  );
  bindShell('/');
  bindCancelCitas();
  const form = document.getElementById('form-cita');

  if (esProspecto) {
    bindProspectoModalidad(form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('submit-btn');
      const original = btn?.textContent;
      if (btn) btn.disabled = true;
      try {
        const fd = new FormData(form);
        const data = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
        const modalidad = String(data.modalidad_prospecto || 'territorio');
        const vendedorId = String(data.vendedorId || user.id);
        const sellerForProspect =
          (getState().users || []).find((u) => u.id === vendedorId) || user;
        let clienteId = '';
        let clienteNombre = '';
        let contacto = '';
        let telefono = '';
        let objetivo = String(data.objetivo || '').trim();
        if (modalidad === 'territorio') {
          const terr = String(data.territorio_prospecto || '').trim();
          if (!terr) {
            showToast('Indique el territorio o zona de prospección.', 'err');
            return;
          }
          clienteNombre = `Prospección · ${terr}`;
          const notas = String(data.notas_prospecto || '').trim();
          if (!objetivo && notas) objetivo = notas;
        } else {
          const resolved = resolveProspectoContacto(data, sellerForProspect);
          clienteId = resolved.clienteId;
          clienteNombre = resolved.clienteNombre;
          contacto = resolved.contacto;
          telefono = resolved.telefono;
        }
        const { cita } = createCita(
          {
            vendedorId,
            clienteId,
            clienteNombre,
            contacto,
            telefono,
            fecha: String(data.fecha || ''),
            hora: String(data.hora || ''),
            objetivo,
            tipoDestino: 'prospecto',
          },
          user
        );
        if (btn) btn.textContent = 'Agendando…';
        await notifyCitaMake(cita, user);
        showToast(
          jefe && vendedorId !== user.id
            ? 'Cita programada. El vendedor ya la puede ver.'
            : 'Cita programada. Recuerde registrar la salida el día de la visita.'
        );
        go('/citas');
      } catch (err) {
        showToast(err.message || 'No se pudo programar la cita.', 'err');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = original;
        }
      }
    });
    return;
  }

  const vendedorSel = form.querySelector('[name="vendedorId"]');
  const clienteSel = form.querySelector('[name="clienteId"]');
  const picker = form.querySelector('#cita-contacto-picker');
  const contactInput = form.querySelector('[name="contacto"]');
  const phoneInput = form.querySelector('[name="telefono"]');
  const setContactEditable = (editable) => {
    for (const el of [contactInput, phoneInput]) {
      if (!el) continue;
      if (editable) {
        el.removeAttribute('readonly');
        el.classList.remove('bg-slate-100', 'text-slate-500', 'cursor-not-allowed');
        el.classList.add('bg-white');
      } else {
        el.setAttribute('readonly', 'readonly');
        el.classList.add('bg-slate-100', 'text-slate-500', 'cursor-not-allowed');
        el.classList.remove('bg-white');
      }
    }
  };
  const fillClientes = () => {
    const vid = vendedorSel?.value || user.id;
    const clientes = getClientsByVendedor(vid).filter((c) => c.tipo !== 'prospecto');
    clienteSel.innerHTML =
      '<option value="">Seleccione un cliente</option>' +
      clientes
        .map((c) => {
          const contacts = listClientContacts(c);
          const payload = encodeURIComponent(JSON.stringify(contacts));
          return `<option value="${c.id}" data-nombre="${escapeHtml(c.nombre)}" data-contactos="${payload}">${escapeHtml(c.codigo ? `${c.codigo} · ` : '')}${escapeHtml(c.nombre)}</option>`;
        })
        .join('');
    if (picker) {
      picker.innerHTML = '<option value="">Primero elija cliente</option>';
    }
    if (contactInput) contactInput.value = '';
    if (phoneInput) phoneInput.value = '';
    setContactEditable(false);
  };
  const fillPicker = () => {
    const opt = clienteSel.selectedOptions[0];
    let contacts = [];
    try {
      contacts = JSON.parse(decodeURIComponent(opt?.dataset.contactos || '%5B%5D'));
    } catch {
      contacts = [];
    }
    if (!picker) return;
    picker.innerHTML =
      '<option value="">Seleccione un contacto</option>' +
      contacts
        .map(
          (c) =>
            `<option value="${escapeHtml(c.nombre)}" data-telefono="${escapeHtml(c.telefono || '')}">${escapeHtml(c.nombre)}${c.cargo ? ` (${escapeHtml(c.cargo)})` : ''}</option>`
        )
        .join('') +
      '<option value="__otro__">Otro (escribir nuevo)</option>';
    if (contactInput) contactInput.value = '';
    if (phoneInput) phoneInput.value = '';
    setContactEditable(false);
  };
  const applyPicker = () => {
    const pOpt = picker?.selectedOptions[0];
    if (!pOpt || pOpt.value === '') {
      setContactEditable(false);
      return;
    }
    if (pOpt.value === '__otro__') {
      if (contactInput) contactInput.value = '';
      if (phoneInput) phoneInput.value = '';
      setContactEditable(true);
      contactInput?.focus();
      return;
    }
    if (contactInput) contactInput.value = pOpt.value;
    if (phoneInput) phoneInput.value = pOpt.dataset.telefono || '';
    setContactEditable(false);
  };
  vendedorSel?.addEventListener?.('change', fillClientes);
  fillClientes();
  clienteSel.addEventListener('change', fillPicker);
  picker?.addEventListener('change', applyPicker);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submit-btn');
    const original = btn?.textContent;
    if (btn) btn.disabled = true;
    try {
      const fd = new FormData(form);
      const opt = clienteSel.selectedOptions[0];
      if (!opt?.value) {
        showToast('Elija un cliente.', 'err');
        return;
      }
      const pVal = picker?.value || '';
      if (!pVal) {
        showToast('Elija un contacto o «Otro».', 'err');
        return;
      }
      if (pVal === '__otro__' && !String(fd.get('contacto') || '').trim()) {
        showToast('Escriba el nombre del contacto nuevo.', 'err');
        return;
      }
      const vendedorId = String(fd.get('vendedorId') || user.id);
      const { cita } = createCita(
        {
          vendedorId,
          clienteId: opt.value,
          clienteNombre: opt.dataset.nombre || '',
          contacto: String(fd.get('contacto') || ''),
          telefono: String(fd.get('telefono') || ''),
          fecha: String(fd.get('fecha') || ''),
          hora: String(fd.get('hora') || ''),
          objetivo: String(fd.get('objetivo') || ''),
          tipoDestino: 'cliente',
        },
        user
      );
      if (btn) btn.textContent = 'Agendando…';
      await notifyCitaMake(cita, user);
      showToast(
        jefe && vendedorId !== user.id
          ? 'Cita programada. El vendedor ya la puede ver.'
          : 'Cita programada. Recuerde registrar la salida el día de la visita.'
      );
      go('/citas');
    } catch (err) {
      showToast(err.message || 'No se pudo programar la cita.', 'err');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = original;
      }
    }
  });
}

function dashboardDayKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function dashIsoDay(offsetDays = 0) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function renderDashboard() {
  const user = getState().session;
  const isAdmin = user.rol === 'admin';
  const personalDash = !isAdmin && !isJefe(user);
  const state = getState();
  const params = new URLSearchParams(location.search);
  const tabSel = personalDash
    ? params.get('tab') === 'clientes'
      ? 'clientes'
      : 'global'
    : params.get('tab') === 'ejecutivos'
      ? 'ejecutivos'
      : 'global';
  const paisSel = personalDash ? '' : params.get('pais') || '';
  const ejecutivoSel = personalDash ? user.id : params.get('ejecutivo') || '';
  const clienteSel = personalDash ? params.get('cliente') || '' : '';
  const desde = params.get('desde') || '';
  const hasta = params.get('hasta') || '';
  const basePath = isAdmin ? '/admin/dashboard' : '/dashboard';

  let ejecutivos = personalDash
    ? [user]
    : isAdmin
      ? getEjecutivos()
      : getTeamVendedores(user);
  if (paisSel) ejecutivos = ejecutivos.filter((u) => u.pais === paisSel);
  if (ejecutivoSel) ejecutivos = ejecutivos.filter((u) => u.id === ejecutivoSel);
  const teamIds = new Set(ejecutivos.map((u) => u.id));

  const inRange = (day) => {
    if (!day) return !desde && !hasta;
    if (desde && day < desde) return false;
    if (hasta && day > hasta) return false;
    return true;
  };

  const salidasAll = (state.salidas || []).filter((s) => {
    if (!teamIds.has(s.vendedorId)) return false;
    if (personalDash && tabSel === 'clientes' && !clienteSel) return false;
    if (clienteSel) {
      const name = String(s.cliente_registro_salida || '').trim().toLowerCase();
      if (name !== clienteSel.trim().toLowerCase()) return false;
    }
    const day = dashboardDayKey(s.fecha_registro_salida || s.createdAt);
    return inRange(day);
  });
  const visitadas = salidasAll.filter((s) => s.estado === 'visitada');
  const pendientes = salidasAll.filter((s) => s.estado === 'pendiente');
  const kmTotal = visitadas.reduce(
    (sum, s) => sum + (Number.isFinite(Number(s.distancia_km)) ? Number(s.distancia_km) : 0),
    0
  );
  const kmAvg = visitadas.length ? Math.round((kmTotal / visitadas.length) * 100) / 100 : 0;
  const cierrePct = salidasAll.length
    ? Math.round((visitadas.length / salidasAll.length) * 100)
    : 0;
  const fotoPct = visitadas.length ? Math.round((visitadas.filter((s) => s.tiene_evidencia).length / visitadas.length) * 100) : 0;
  const tardioPct = visitadas.length
    ? Math.round((visitadas.filter((s) => s.reporte_tardio).length / visitadas.length) * 100)
    : 0;

  const clientsScope = (state.clients || []).filter(
    (c) => c.activo !== false && teamIds.has(c.vendedorId)
  );
  const clientes = clientsScope.filter((c) => c.tipo !== 'prospecto').length;
  const prospectos = clientsScope.filter((c) => c.tipo === 'prospecto').length;
  const citasProg = ejecutivos.reduce(
    (n, u) => n + getCitasForUser(u.id).filter((c) => c.estado === 'programada').length,
    0
  );
  const conFoto = visitadas.filter((s) => s.tiene_evidencia).length;
  const tardias = visitadas.filter((s) => s.reporte_tardio).length;
  const visitasPorEjec =
    ejecutivos.length && visitadas.length
      ? Math.round((visitadas.length / ejecutivos.length) * 10) / 10
      : 0;
  const clientesPorEjec =
    ejecutivos.length && clientes ? Math.round((clientes / ejecutivos.length) * 10) / 10 : 0;

  const byDayMap = new Map();
  for (const s of salidasAll) {
    const day = dashboardDayKey(s.fecha_registro_salida || s.createdAt) || 'sin-fecha';
    if (!byDayMap.has(day)) byDayMap.set(day, { salidas: 0, visitas: 0, km: 0 });
    byDayMap.get(day).salidas += 1;
  }
  for (const s of visitadas) {
    const day = dashboardDayKey(s.fecha_reporte_real || s.visitedAt || s.fecha_registro_salida) || 'sin-fecha';
    if (!byDayMap.has(day)) byDayMap.set(day, { salidas: 0, visitas: 0, km: 0 });
    const row = byDayMap.get(day);
    row.visitas += 1;
    row.km += Number.isFinite(Number(s.distancia_km)) ? Number(s.distancia_km) : 0;
  }
  const dayLabels = [...byDayMap.keys()].filter((d) => d !== 'sin-fecha').sort();
  const daySalidas = dayLabels.map((d) => byDayMap.get(d).salidas);
  const dayVisitas = dayLabels.map((d) => byDayMap.get(d).visitas);
  const dayKm = dayLabels.map((d) => Math.round(byDayMap.get(d).km * 100) / 100);

  const weekdayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const s of visitadas) {
    const day = dashboardDayKey(s.fecha_reporte_real || s.visitedAt || s.fecha_registro_salida);
    if (!day) continue;
    const wd = new Date(`${day}T12:00:00`).getDay();
    if (wd >= 0 && wd <= 6) weekdayCounts[wd] += 1;
  }

  const rows = ejecutivos
    .map((u) => {
      const salidas = salidasAll.filter((s) => s.vendedorId === u.id);
      const vis = salidas.filter((s) => s.estado === 'visitada');
      const km = vis.reduce(
        (sum, s) => sum + (Number.isFinite(Number(s.distancia_km)) ? Number(s.distancia_km) : 0),
        0
      );
      const fotos = vis.filter((s) => s.tiene_evidencia).length;
      return {
        id: u.id,
        nombre: u.nombre,
        pais: u.pais || '',
        clientes: getClientsByVendedor(u.id).filter((c) => c.tipo !== 'prospecto').length,
        prospectos: getClientsByVendedor(u.id).filter((c) => c.tipo === 'prospecto').length,
        salidas: salidas.length,
        visitadas: vis.length,
        pendientes: salidas.length - vis.length,
        km: Math.round(km * 100) / 100,
        fotos,
        citas: getCitasForUser(u.id).filter((c) => c.estado === 'programada').length,
        cierre: salidas.length ? Math.round((vis.length / salidas.length) * 100) : 0,
      };
    })
    .sort((a, b) => b.visitadas - a.visitadas || b.salidas - a.salidas);

  const tipoMap = new Map();
  for (const s of visitadas) {
    const key = String(s.tipo_visita || 'Sin tipo').trim() || 'Sin tipo';
    tipoMap.set(key, (tipoMap.get(key) || 0) + 1);
  }
  const tipoLabels = [...tipoMap.keys()];
  const tipoValues = tipoLabels.map((k) => tipoMap.get(k));

  const paisMap = { SV: 0, GT: 0, OTRO: 0 };
  for (const r of rows) {
    if (r.pais === 'SV' || r.pais === 'GT') paisMap[r.pais] += r.visitadas;
    else paisMap.OTRO += r.visitadas;
  }

  const topEjec = rows.slice(0, 10);
  const topKm = [...rows].sort((a, b) => b.km - a.km).slice(0, 8);

  const buildQuery = (extra = {}) => {
    const q = new URLSearchParams();
    const merged = {
      tab: tabSel,
      pais: paisSel,
      ejecutivo: personalDash ? '' : ejecutivoSel,
      cliente: personalDash ? clienteSel : '',
      desde,
      hasta,
      ...extra,
    };
    if (personalDash) {
      if (merged.tab === 'clientes') q.set('tab', 'clientes');
    } else if (merged.tab && merged.tab !== 'global') {
      q.set('tab', merged.tab);
    }
    for (const key of personalDash
      ? ['cliente', 'desde', 'hasta']
      : ['pais', 'ejecutivo', 'desde', 'hasta']) {
      const v = String(merged[key] || '').trim();
      if (v) q.set(key, v);
    }
    const qs = q.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const misClientesOpts = personalDash
    ? getClientesDe(user)
        .map(
          (c) =>
            `<option value="${escapeHtml(c.nombre)}" ${
              clienteSel === c.nombre ? 'selected' : ''
            }>${escapeHtml(c.codigo ? `${c.codigo} · ` : '')}${escapeHtml(c.nombre)}</option>`
        )
        .join('')
    : '';

  const presetActive = (d, h) => desde === d && hasta === h;
  const hoy = dashIsoDay(0);
  const d7 = dashIsoDay(-6);
  const d30 = dashIsoDay(-29);

  const kpi = (title, value, help) => `
    <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">${title}</div>
      <div class="mt-1 text-2xl font-black tabular-nums text-slate-900">${value}</div>
      <p class="mt-1 text-[11px] leading-snug text-slate-500">${help}</p>
    </div>`;

  const chartCard = (title, help, canvasId, tall = false) => `
    <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h3 class="text-base font-black text-slate-900">${title}</h3>
      <p class="mt-1 text-xs leading-relaxed text-slate-500">${help}</p>
      <div class="mt-4 ${tall ? 'h-72' : 'h-56'}"><canvas id="${canvasId}"></canvas></div>
    </section>`;

  const allEjecOptions = (isAdmin ? getEjecutivos() : getTeamVendedores(user))
    .filter((u) => !paisSel || u.pais === paisSel)
    .map(
      (u) =>
        `<option value="${u.id}" ${ejecutivoSel === u.id ? 'selected' : ''}>${escapeHtml(u.nombre)} (${escapeHtml(u.pais || '—')})</option>`
    )
    .join('');

  const emptyHint =
    !salidasAll.length
      ? `<div class="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          ${
            personalDash
              ? 'Todavía no hay salidas ni visitas en este filtro. Al registrar salidas y cerrar visitas con foto, aquí se llenan los números y las gráficas.'
              : 'Todavía no hay salidas ni visitas en este filtro. Cuando los vendedores registren salidas y cierren visitas con foto, aquí se llenan los números y las gráficas.'
          }
        </div>`
      : '';

  const globalBody = `
    ${emptyHint}
    <div class="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Totales del periodo</div>
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      ${kpi(
        'Salidas',
        salidasAll.length,
        personalDash ? 'Veces que se registró “voy a salir”.' : 'Veces que un vendedor registró “voy a salir”.'
      )}
      ${kpi(
        'Visitas hechas',
        visitadas.length,
        personalDash ? 'Salidas ya cerradas con reporte.' : 'Salidas ya cerradas con reporte.'
      )}
      ${kpi(
        'Pendientes',
        pendientes.length,
        personalDash ? 'Salidas aún sin reporte de visita.' : 'Salieron y aún no reportaron.'
      )}
      ${kpi(
        '% cerrado',
        `${cierrePct}%`,
        personalDash
          ? 'De cada 100 salidas, cuántas ya tienen reporte.'
          : 'De cada 100 salidas, cuántas ya se reportaron.'
      )}
      ${kpi(
        'Km totales',
        Math.round(kmTotal * 100) / 100,
        personalDash ? 'Kilómetros GPS de las visitas cerradas.' : 'Suma de kilómetros GPS de las visitas.'
      )}
      ${kpi(
        'Km promedio',
        kmAvg,
        personalDash ? 'Kilómetros típicos por visita cerrada.' : 'Kilómetros típicos por visita cerrada.'
      )}
      ${kpi(
        'Con foto',
        conFoto,
        personalDash ? 'Visitas cerradas con evidencia fotográfica.' : 'Visitas que sí llevaron evidencia.'
      )}
      ${kpi(
        'Clientes en cartera',
        clientes,
        personalDash ? 'Clientes activos en la cartera.' : 'Clientes activos de los ejecutivos filtrados.'
      )}
      ${kpi(
        'Citas agendadas',
        citasProg,
        personalDash
          ? 'Visitas programadas aún sin registrar salida.'
          : 'Visitas programadas aún sin registrar salida.'
      )}
      ${kpi(
        '% con foto',
        `${fotoPct}%`,
        personalDash
          ? 'De las visitas cerradas, cuántas llevan foto.'
          : 'De las visitas cerradas, cuántas llevan foto.'
      )}
      ${kpi(
        'Reportes tardíos',
        tardias,
        personalDash
          ? 'Visitas reportadas después del día esperado.'
          : 'Visitas reportadas después del día esperado.'
      )}
      ${kpi(
        '% tardíos',
        `${tardioPct}%`,
        personalDash
          ? 'Qué porcentaje de visitas se reportó tarde.'
          : 'Qué porcentaje de visitas se reportó tarde.'
      )}
      ${
        personalDash
          ? ''
          : `${kpi('Visitas / ejecutivo', visitasPorEjec, 'Promedio de visitas cerradas por vendedor.')}
      ${kpi('Clientes / ejecutivo', clientesPorEjec, 'Promedio de clientes en cartera por vendedor.')}`
      }
    </div>

    <div class="mt-5 grid gap-4 lg:grid-cols-2">
      ${chartCard(
        personalDash
          ? '¿Cuántas salidas y visitas hubo por día?'
          : '¿Cuántas salidas y visitas hubo por día?',
        personalDash
          ? 'Cada punto es un día. Rojo = salidas. Verde = visitas ya cerradas.'
          : 'Cada punto es un día. Rojo = salidas registradas. Verde = visitas ya cerradas.',
        'chart-actividad',
        true
      )}
      ${chartCard(
        personalDash ? '¿Cuántos kilómetros por día?' : '¿Cuántos kilómetros se recorrieron por día?',
        personalDash
          ? 'Suma de kilómetros GPS del día (solo visitas cerradas).'
          : 'Suma de kilómetros GPS del día (solo visitas ya cerradas).',
        'chart-km-dia'
      )}
      ${
        personalDash
          ? ''
          : `${chartCard(
              '¿Quién cerró más visitas?',
              'Barras por ejecutivo: salidas abiertas vs visitas ya reportadas.',
              'chart-ejecutivos',
              true
            )}
      ${chartCard(
        '¿Quién recorrió más kilómetros?',
        'Comparación de kilómetros GPS por ejecutivo en el periodo.',
        'chart-km-ejec'
      )}`
      }
      ${chartCard(
        personalDash
          ? '¿Cuál es el motivo más frecuente de visita?'
          : '¿Por qué motivo visitan?',
        personalDash
          ? 'Tipos de visita más usados al cerrar reportes.'
          : 'Tipos de visita más usados cuando cierran el reporte.',
        'chart-tipos'
      )}
      ${chartCard(
        personalDash
          ? '¿Qué día de la semana hay más visitas?'
          : '¿Qué día de la semana visitan más?',
        personalDash
          ? 'En qué días de la semana se cierran más visitas (domingo a sábado).'
          : 'Cuántas visitas cerradas caen en cada día (domingo a sábado).',
        'chart-semana'
      )}
      ${
        personalDash
          ? ''
          : chartCard(
              '¿En qué país hay más visitas cerradas?',
              'Visitas reportadas según el país del ejecutivo.',
              'chart-paises'
            )
      }
    </div>`;

  const ejecutivosBody = `
    <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 class="text-sm font-black uppercase tracking-wider text-slate-900">Detalle por ejecutivo</h3>
          <p class="mt-0.5 text-xs text-slate-500">Lista ordenada por visitas cerradas. Filtre arriba por país o por una persona.</p>
        </div>
        <span class="text-xs font-semibold text-slate-500">${rows.length} ejecutivo${rows.length === 1 ? '' : 's'}</span>
      </div>
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        ${
          rows.length
            ? rows
                .map(
                  (r) => `
          <article class="flex h-full flex-col rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div class="min-w-0">
              <div class="text-sm font-black text-slate-900 break-words">${escapeHtml(r.nombre)}</div>
              <p class="mt-0.5 text-xs text-slate-500">${escapeHtml(r.pais || '—')} · ${r.clientes} clientes · ${r.citas} citas</p>
            </div>
            <div class="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-600">
              <div>Salidas<strong class="mt-0.5 block text-sm text-slate-900">${r.salidas}</strong></div>
              <div>Visitas<strong class="mt-0.5 block text-sm text-emerald-700">${r.visitadas}</strong></div>
              <div>Pendientes<strong class="mt-0.5 block text-sm ${r.pendientes ? 'text-amber-700' : 'text-slate-900'}">${r.pendientes}</strong></div>
              <div>Km<strong class="mt-0.5 block text-sm text-slate-900">${r.km}</strong></div>
              <div>Con foto<strong class="mt-0.5 block text-sm text-slate-900">${r.fotos}</strong></div>
              <div>% cierre<strong class="mt-0.5 block text-sm text-slate-900">${r.cierre}%</strong></div>
            </div>
            <div class="mt-auto border-t border-slate-200/80 pt-3">
              <button data-nav="${escapeHtml(buildQuery({ tab: 'ejecutivos', ejecutivo: r.id }))}" class="text-xs font-bold text-red-600 hover:underline">Ver solo este ejecutivo</button>
            </div>
          </article>`
                )
                .join('')
            : '<p class="text-sm text-slate-400 sm:col-span-2 xl:col-span-3">No hay ejecutivos con estos filtros.</p>'
        }
      </div>
    </section>`;

  app.innerHTML = shell(
    `
    <div class="mb-4">
      <p class="text-xs font-bold uppercase tracking-[0.2em] text-red-600">Panel de resultados</p>
      <h2 class="mt-1 text-xl font-black text-slate-900 sm:text-2xl">${personalDash ? '¿Cómo va el trabajo de campo?' : '¿Cómo va el trabajo de campo?'}</h2>
      <p class="mt-1 max-w-3xl text-sm text-slate-500">${
        personalDash
          ? 'Resumen de salidas y visitas. Global es el total del periodo; Clientes filtra uno concreto.'
          : 'Números claros. Use Global para el resumen y Ejecutivos para el detalle persona por persona.'
      }</p>
    </div>

    ${
      personalDash
        ? `<div class="mb-4 flex flex-wrap gap-2">
      <button data-nav="${escapeHtml(buildQuery({ tab: 'global', cliente: '' }))}" class="rounded-full border px-4 py-2 text-xs font-black uppercase tracking-wide ${tabSel === 'global' ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600'}">Global</button>
      <button data-nav="${escapeHtml(buildQuery({ tab: 'clientes' }))}" class="rounded-full border px-4 py-2 text-xs font-black uppercase tracking-wide ${tabSel === 'clientes' ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600'}">Clientes</button>
    </div>`
        : `<div class="mb-4 flex flex-wrap gap-2">
      <button data-nav="${escapeHtml(buildQuery({ tab: 'global' }))}" class="rounded-full border px-4 py-2 text-xs font-black uppercase tracking-wide ${tabSel === 'global' ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600'}">Global</button>
      <button data-nav="${escapeHtml(buildQuery({ tab: 'ejecutivos' }))}" class="rounded-full border px-4 py-2 text-xs font-black uppercase tracking-wide ${tabSel === 'ejecutivos' ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600'}">Ejecutivos</button>
    </div>`
    }

    <div class="mb-3 flex flex-wrap gap-2">
      <button data-nav="${escapeHtml(buildQuery({ desde: hoy, hasta: hoy }))}" class="rounded-full border px-3 py-1.5 text-xs font-bold ${presetActive(hoy, hoy) ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600'}">Hoy</button>
      <button data-nav="${escapeHtml(buildQuery({ desde: d7, hasta: hoy }))}" class="rounded-full border px-3 py-1.5 text-xs font-bold ${presetActive(d7, hoy) ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600'}">Últimos 7 días</button>
      <button data-nav="${escapeHtml(buildQuery({ desde: d30, hasta: hoy }))}" class="rounded-full border px-3 py-1.5 text-xs font-bold ${presetActive(d30, hoy) ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600'}">Últimos 30 días</button>
      <button data-nav="${escapeHtml(buildQuery({ desde: '', hasta: '' }))}" class="rounded-full border px-3 py-1.5 text-xs font-bold ${!desde && !hasta ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600'}">Todo el historial</button>
    </div>

    <form id="dash-filters" class="mb-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 ${personalDash ? 'lg:grid-cols-4' : 'lg:grid-cols-5'}">
      <input type="hidden" name="tab" value="${tabSel}" />
      ${
        personalDash
          ? tabSel === 'clientes'
            ? `<div class="sm:col-span-2">
        <label class="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400">Cliente</label>
        <select name="cliente" required class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
          <option value="">Seleccione un cliente</option>
          ${misClientesOpts}
        </select>
      </div>`
            : ''
          : `<div>
        <label class="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400">País</label>
        <select name="pais" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
          <option value="">Todos</option>
          <option value="SV" ${paisSel === 'SV' ? 'selected' : ''}>El Salvador</option>
          <option value="GT" ${paisSel === 'GT' ? 'selected' : ''}>Guatemala</option>
        </select>
      </div>
      <div>
        <label class="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400">Ejecutivo</label>
        <select name="ejecutivo" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
          <option value="">Todos</option>
          ${allEjecOptions}
        </select>
      </div>`
      }
      <div>
        <label class="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400">Desde</label>
        <input type="date" name="desde" value="${escapeHtml(desde)}" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
      </div>
      <div>
        <label class="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400">Hasta</label>
        <input type="date" name="hasta" value="${escapeHtml(hasta)}" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
      </div>
      <div class="flex items-end gap-2 ${personalDash ? 'sm:col-span-2' : ''}">
        <button class="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-black uppercase text-white hover:bg-red-700">Aplicar</button>
        <button type="button" id="dash-clear" class="rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-600">Limpiar</button>
      </div>
    </form>

    ${!personalDash && tabSel === 'ejecutivos' ? ejecutivosBody : globalBody}
    `,
    { title: 'Dashboard', showBack: true, backTo: isAdmin ? '/admin' : '/', wide: true }
  );

  if (isAdmin) bindAdminSubShell();
  else bindShell('/');

  document.getElementById('dash-filters')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const q = new URLSearchParams();
    if (personalDash) {
      if (tabSel === 'clientes') q.set('tab', 'clientes');
    } else {
      const tab = String(fd.get('tab') || tabSel || 'global');
      if (tab === 'ejecutivos') q.set('tab', 'ejecutivos');
    }
    for (const key of personalDash
      ? ['cliente', 'desde', 'hasta']
      : ['pais', 'ejecutivo', 'desde', 'hasta']) {
      const v = String(fd.get(key) || '').trim();
      if (v) q.set(key, v);
    }
    go(q.toString() ? `${basePath}?${q}` : basePath, { replace: true, animate: false });
  });
  document.getElementById('dash-clear')?.addEventListener('click', () => {
    if (personalDash && tabSel === 'clientes') {
      go(`${basePath}?tab=clientes`, { replace: true, animate: false });
      return;
    }
    go(!personalDash && tabSel === 'ejecutivos' ? `${basePath}?tab=ejecutivos` : basePath, {
      replace: true,
      animate: false,
    });
  });

  if (tabSel === 'ejecutivos') return;
  if (personalDash && tabSel === 'clientes' && !clienteSel) {
    // Sin cliente elegido aún: no dibujar gráficas vacías engañosas.
  }
  const ChartLib = window.Chart;
  if (!ChartLib) return;
  const grid = { color: 'rgba(148,163,184,0.2)' };
  const common = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } },
  };

  const elAct = document.getElementById('chart-actividad');
  if (elAct) {
    new ChartLib(elAct, {
      type: 'line',
      data: {
        labels: dayLabels.length ? dayLabels.map((d) => d.slice(5)) : ['Sin datos'],
        datasets: [
          {
            label: 'Salidas',
            data: dayLabels.length ? daySalidas : [0],
            borderColor: '#dc2626',
            backgroundColor: 'rgba(220,38,38,0.12)',
            fill: true,
            tension: 0.35,
          },
          {
            label: 'Visitas cerradas',
            data: dayLabels.length ? dayVisitas : [0],
            borderColor: '#059669',
            backgroundColor: 'rgba(5,150,105,0.12)',
            fill: true,
            tension: 0.35,
          },
        ],
      },
      options: { ...common, scales: { x: { grid }, y: { beginAtZero: true, grid } } },
    });
  }

  const elKmDia = document.getElementById('chart-km-dia');
  if (elKmDia) {
    new ChartLib(elKmDia, {
      type: 'line',
      data: {
        labels: dayLabels.length ? dayLabels.map((d) => d.slice(5)) : ['Sin datos'],
        datasets: [
          {
            label: 'Km',
            data: dayLabels.length ? dayKm : [0],
            borderColor: '#0f172a',
            backgroundColor: 'rgba(15,23,42,0.1)',
            fill: true,
            tension: 0.35,
          },
        ],
      },
      options: { ...common, scales: { x: { grid }, y: { beginAtZero: true, grid } } },
    });
  }

  const elEj = document.getElementById('chart-ejecutivos');
  if (elEj) {
    new ChartLib(elEj, {
      type: 'bar',
      data: {
        labels: topEjec.length ? topEjec.map((r) => r.nombre.split(' ')[0]) : ['Sin datos'],
        datasets: [
          {
            label: 'Salidas',
            data: topEjec.length ? topEjec.map((r) => r.salidas) : [0],
            backgroundColor: '#fda4af',
          },
          {
            label: 'Visitas',
            data: topEjec.length ? topEjec.map((r) => r.visitadas) : [0],
            backgroundColor: '#34d399',
          },
        ],
      },
      options: { ...common, scales: { x: { grid }, y: { beginAtZero: true, grid } } },
    });
  }

  const elKmEj = document.getElementById('chart-km-ejec');
  if (elKmEj) {
    new ChartLib(elKmEj, {
      type: 'bar',
      data: {
        labels: topKm.length ? topKm.map((r) => r.nombre.split(' ')[0]) : ['Sin datos'],
        datasets: [
          {
            label: 'Km',
            data: topKm.length ? topKm.map((r) => r.km) : [0],
            backgroundColor: '#1e293b',
          },
        ],
      },
      options: {
        ...common,
        indexAxis: 'y',
        scales: { x: { beginAtZero: true, grid }, y: { grid } },
      },
    });
  }

  const elTipos = document.getElementById('chart-tipos');
  if (elTipos) {
    new ChartLib(elTipos, {
      type: 'doughnut',
      data: {
        labels: tipoLabels.length ? tipoLabels : ['Sin visitas aún'],
        datasets: [
          {
            data: tipoValues.length ? tipoValues : [1],
            backgroundColor: ['#dc2626', '#f97316', '#eab308', '#22c55e', '#0ea5e9', '#8b5cf6', '#64748b'],
          },
        ],
      },
      options: { ...common },
    });
  }

  const elSem = document.getElementById('chart-semana');
  if (elSem) {
    new ChartLib(elSem, {
      type: 'bar',
      data: {
        labels: weekdayNames,
        datasets: [
          {
            label: 'Visitas',
            data: weekdayCounts,
            backgroundColor: '#f97316',
          },
        ],
      },
      options: { ...common, scales: { x: { grid }, y: { beginAtZero: true, grid } } },
    });
  }

  const elPais = document.getElementById('chart-paises');
  if (elPais) {
    new ChartLib(elPais, {
      type: 'bar',
      data: {
        labels: ['El Salvador', 'Guatemala', 'Otro'],
        datasets: [
          {
            label: 'Visitas cerradas',
            data: [paisMap.SV, paisMap.GT, paisMap.OTRO],
            backgroundColor: ['#1e293b', '#dc2626', '#94a3b8'],
          },
        ],
      },
      options: {
        ...common,
        indexAxis: 'y',
        scales: { x: { beginAtZero: true, grid }, y: { grid } },
      },
    });
  }

}

function renderCartera() {
  const user = getState().session;
  const params = new URLSearchParams(location.search);
  const q = (params.get('q') || '').toLowerCase();
  const editId = params.get('edit') || '';
  const addOpen = params.get('add') === '1';
  const editingContactId = params.get('cid') || '';
  let clients = getClientesDe(user);
  let prospectos = getProspectosDe(user);
  if (q) {
    clients = clients.filter((c) =>
      `${c.nombre} ${c.codigo} ${c.contacto} ${c.telefono} ${listClientContacts(c)
        .map((x) => x.nombre)
        .join(' ')}`.toLowerCase().includes(q)
    );
    prospectos = prospectos.filter((p) =>
      `${p.nombre} ${p.nit} ${p.contacto} ${p.telefono}`.toLowerCase().includes(q)
    );
  }

  const carteraUrl = (extra = {}) => {
    const p = new URLSearchParams();
    if (q) p.set('q', params.get('q') || '');
    const merged = { edit: editId, add: addOpen ? '1' : '', cid: editingContactId, ...extra };
    if (merged.edit) p.set('edit', merged.edit);
    if (merged.add === '1') p.set('add', '1');
    if (merged.cid) p.set('cid', merged.cid);
    const qs = p.toString();
    return qs ? `/cartera?${qs}` : '/cartera';
  };

  const prospectosHtml = `
    <section class="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 class="text-xs font-black uppercase tracking-wider text-slate-900">Mis prospectos</h3>
      <p class="mt-1 text-xs text-slate-500">Se guardan al registrar salida o cita con prospección por contacto (con NIT).</p>
      <div class="mt-3 space-y-2">
        ${
          prospectos.length
            ? prospectos
                .map(
                  (p) => `
          <div class="rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2.5">
            <div class="text-sm font-bold text-slate-900">${escapeHtml(p.nombre)}</div>
            <p class="text-[11px] text-slate-600">${[
              p.nit ? `NIT ${p.nit}` : '',
              p.contacto || '',
              p.telefono || '',
            ]
              .filter(Boolean)
              .map((x) => escapeHtml(x))
              .join(' · ') || 'Sin datos de contacto'}</p>
          </div>`
                )
                .join('')
            : '<p class="text-sm text-slate-400">Aún no tiene prospectos guardados.</p>'
        }
      </div>
    </section>`;

  app.innerHTML = shell(
    `
    <div class="mb-4">
      <p class="text-xs font-bold uppercase tracking-[0.2em] text-red-600">Mi cartera</p>
      <h2 class="mt-1 text-xl font-black text-slate-900">${clients.length} cliente${clients.length === 1 ? '' : 's'}${prospectos.length ? ` · ${prospectos.length} prospecto${prospectos.length === 1 ? '' : 's'}` : ''}</h2>
      <p class="mt-1 text-sm text-slate-500">Toque la tarjeta del cliente para ver y gestionar contactos.</p>
    </div>
    ${prospectosHtml}
    <form id="form-buscar-cartera" class="mb-3 flex gap-2">
      <input name="q" value="${escapeHtml(params.get('q') || '')}" placeholder="Buscar cliente, código, NIT o contacto" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-red-500" />
      <button class="rounded-xl bg-slate-900 px-4 py-3 text-xs font-black uppercase text-white">Buscar</button>
    </form>
    <div class="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Clientes</div>
    <div class="space-y-2">
      ${
        clients.length
          ? clients
              .map((c) => {
                const open = editId === c.id;
                const cts = listClientContacts(c);
                const stored = c.contactos || [];
                return `
        <article class="rounded-2xl border ${open ? 'border-red-200 bg-red-50/30' : 'border-slate-200 bg-white'} shadow-sm overflow-hidden">
          <button type="button" data-toggle-client="${c.id}" class="flex w-full items-center gap-3 p-4 text-left hover:bg-slate-50/80">
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-black text-slate-900">${escapeHtml(c.nombre)}</div>
              <div class="mt-0.5 truncate text-xs text-slate-500">${escapeHtml(c.codigo || 'Sin código')}${c.pais ? ` · ${escapeHtml(c.pais)}` : ''} · ${cts.length} contacto${cts.length === 1 ? '' : 's'}${cts[0] ? ` · ${escapeHtml(cts[0].nombre)}` : ''}</div>
            </div>
            <span class="shrink-0 text-slate-400 text-lg leading-none">${open ? '▾' : '▸'}</span>
          </button>
          ${
            open
              ? `<div class="border-t border-red-100 px-4 pb-4 pt-3 space-y-3">
            <div class="space-y-2">
              ${
                cts.length
                  ? cts
                      .map((ct) => {
                        const inList = stored.some((x) => x.id === ct.id);
                        const editingThis = editingContactId === ct.id && inList;
                        if (editingThis) {
                          return `
              <form data-edit-contact-form="${escapeHtml(ct.id)}" class="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2">
                <p class="sm:col-span-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Editar contacto</p>
                ${field('Nombre', 'nombre', { required: true, value: ct.nombre, placeholder: 'Persona de contacto' })}
                ${field('Cargo', 'cargo', { required: false, value: ct.cargo || '', placeholder: 'Ej. GG, GO, compras' })}
                ${field('Teléfono', 'telefono', { required: false, type: 'tel', value: ct.telefono || '' })}
                ${field('Teléfono fijo', 'telefono_fijo', { required: false, type: 'tel', value: ct.telefono_fijo || '' })}
                ${field('Correo', 'correo', { required: false, type: 'email', value: ct.correo || '' })}
                <div class="flex gap-2 sm:col-span-2">
                  <button class="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-black uppercase text-white">Guardar</button>
                  <button type="button" data-cancel-edit-contact class="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600">Cancelar</button>
                </div>
              </form>`;
                        }
                        return `
              <div class="flex items-start justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                <div class="min-w-0">
                  <div class="text-sm font-semibold text-slate-900">${escapeHtml(ct.nombre)}${ct.cargo ? ` <span class="text-xs font-normal text-slate-400">(${escapeHtml(ct.cargo)})</span>` : ''}</div>
                  <div class="text-xs text-slate-500">${escapeHtml([ct.telefono, ct.telefono_fijo, ct.correo].filter(Boolean).join(' · ') || 'Sin datos')}</div>
                </div>
                ${
                  inList
                    ? `<div class="flex shrink-0 gap-2">
                  <button type="button" data-edit-contact="${escapeHtml(ct.id)}" class="text-[11px] font-bold text-red-600 hover:underline">Editar</button>
                  <button type="button" data-remove-contact="${escapeHtml(ct.id)}" class="text-[11px] font-bold text-slate-400 hover:text-red-600">Borrar</button>
                </div>`
                    : `<span class="shrink-0 text-[10px] font-bold uppercase text-slate-400">Catálogo</span>`
                }
              </div>`;
                      })
                      .join('')
                  : '<p class="text-sm text-slate-400">Aún no hay contactos.</p>'
              }
            </div>
            <div>
              <button type="button" data-toggle-add class="w-full rounded-xl border border-dashed border-red-300 bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-red-700 hover:bg-red-50">Agregar contacto</button>
              ${
                addOpen
                  ? `<form id="form-contacto" class="mt-3 grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2">
                ${field('Nombre', 'nombre', { required: true, placeholder: 'Persona de contacto' })}
                ${field('Cargo', 'cargo', { required: false, placeholder: 'Ej. GG, GO, compras' })}
                ${field('Teléfono', 'telefono', { required: false, type: 'tel' })}
                ${field('Teléfono fijo', 'telefono_fijo', { required: false, type: 'tel' })}
                ${field('Correo', 'correo', { required: false, type: 'email' })}
                <div class="sm:col-span-2">
                  <button class="w-full rounded-xl bg-red-600 px-5 py-3 text-sm font-black uppercase text-white hover:bg-red-700">Guardar contacto</button>
                </div>
              </form>`
                  : ''
              }
            </div>
          </div>`
              : ''
          }
        </article>`;
              })
              .join('')
          : '<p class="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-400">Sin clientes en su cartera.</p>'
      }
    </div>
    `,
    { title: 'Mi cartera', showBack: true, backTo: '/' }
  );
  bindShell('/');
  document.getElementById('form-buscar-cartera')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = new FormData(e.target).get('q') || '';
    go(value ? `/cartera?q=${encodeURIComponent(value)}` : '/cartera');
  });
  document.querySelectorAll('[data-toggle-client]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.toggleClient;
      go(editId === id ? carteraUrl({ edit: '', add: '', cid: '' }) : carteraUrl({ edit: id, add: '', cid: '' }), {
        replace: true,
        animate: false,
      });
    });
  });
  document.querySelectorAll('[data-toggle-add]').forEach((btn) => {
    btn.addEventListener('click', () => {
      go(carteraUrl({ add: addOpen ? '' : '1', cid: '' }), { replace: true, animate: false });
    });
  });
  document.querySelectorAll('[data-edit-contact]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      go(carteraUrl({ cid: btn.dataset.editContact, add: '' }), { replace: true, animate: false });
    });
  });
  document.querySelectorAll('[data-cancel-edit-contact]').forEach((btn) => {
    btn.addEventListener('click', () => go(carteraUrl({ cid: '' }), { replace: true, animate: false }));
  });
  document.querySelectorAll('[data-remove-contact]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!editId || !confirm('¿Quitar este contacto de la lista?')) return;
      removeClientContact(editId, btn.dataset.removeContact, getState().session);
      showToast('Contacto eliminado.');
      go(carteraUrl({ cid: '' }), { replace: true, animate: false });
    });
  });
  document.querySelectorAll('[data-edit-contact-form]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const { updated } = updateClientContactEntry(
        editId,
        form.dataset.editContactForm,
        {
          nombre: fd.get('nombre'),
          cargo: fd.get('cargo'),
          telefono: fd.get('telefono'),
          telefono_fijo: fd.get('telefono_fijo'),
          correo: fd.get('correo'),
        },
        getState().session
      );
      showToast(updated ? 'Contacto actualizado.' : 'No se pudo actualizar el contacto.', updated ? undefined : 'err');
      go(carteraUrl({ cid: '' }), { replace: true, animate: false });
    });
  });
  document.getElementById('form-contacto')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const { added } = addClientContact(
      editId,
      {
        nombre: fd.get('nombre'),
        cargo: fd.get('cargo'),
        telefono: fd.get('telefono'),
        telefono_fijo: fd.get('telefono_fijo'),
        correo: fd.get('correo'),
      },
      getState().session
    );
    showToast(added ? 'Contacto agregado.' : 'Ese contacto ya existía o no se pudo guardar.');
    go(carteraUrl({ add: '', cid: '' }), { replace: true, animate: false });
  });
}

function renderMisSolicitudes() {
  const user = getState().session;
  const mine = getState().clientRequests.filter((r) => r.vendedorId === user.id).slice(0, 12);

  app.innerHTML = shell(
    `
    <form id="form-solicitud-cliente" class="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        Solicite sumar un <strong>cliente activo</strong> a su cartera. Su jefe de ventas lo verá en la bandeja de solicitudes
        para aprobar o rechazar. Al aprobarse, el cliente quedará disponible para salidas, visitas y citas.
      </div>
      ${field('Nombre del cliente (empresa)', 'nombre', { placeholder: 'Ej. Distribuidora ABC' })}
      ${field('Código (opcional)', 'codigo', { required: false, placeholder: 'Ej. CLI-001' })}
      ${field('Nombre de contacto', 'contacto', { placeholder: 'Persona de contacto', required: false })}
      ${field('Cargo del contacto', 'contacto_rol', { required: false, placeholder: 'Ej. GG, compras' })}
      <div class="grid gap-4 sm:grid-cols-2">
        ${field('Teléfono', 'telefono', { type: 'tel', placeholder: 'Ej. 7777-8888', required: false })}
        ${field('Teléfono fijo', 'telefono_fijo', { type: 'tel', required: false })}
      </div>
      ${field('Correo de contacto', 'correo_contacto', { type: 'email', required: false })}
      ${field('Ubicación / dirección', 'ubicacion', { placeholder: 'Referencia del cliente', required: false })}
      ${field('Notas / justificación', 'notas', { type: 'textarea', required: false, placeholder: 'Detalle adicional para su jefe' })}
      <button id="submit-btn" class="inline-flex w-full items-center justify-center rounded-xl bg-red-600 px-5 py-3.5 text-sm font-black uppercase tracking-tight text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-red-700">Solicitar aprobación</button>
    </form>

    <section class="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 class="text-xs font-black uppercase tracking-wider text-slate-900">Mis solicitudes</h3>
      <div class="mt-3 space-y-2">
        ${
          mine.length
            ? mine
                .map((r) => {
                  const color =
                    r.estado === 'aprobado'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : r.estado === 'rechazado'
                        ? 'border-red-200 bg-red-50 text-red-800'
                        : 'border-amber-200 bg-amber-50 text-amber-800';
                  return `<div class="rounded-xl border px-3 py-2 ${color}">
                    <div class="text-sm font-bold">${escapeHtml(r.nombre)}</div>
                    <div class="text-[11px] opacity-80 capitalize">${escapeHtml(r.estado)} · ${escapeHtml(r.contacto || 'Sin contacto')}${r.telefono ? ` · ${escapeHtml(r.telefono)}` : ''}</div>
                  </div>`;
                })
                .join('')
            : '<p class="text-sm text-slate-400">Aún no ha enviado solicitudes.</p>'
        }
      </div>
    </section>
    `,
    { title: 'Mis solicitudes', showBack: true, backTo: '/' }
  );
  bindShell('/');
  bindFormSubmit('form-solicitud-cliente', async (data, btn) => {
    const session = getState().session;
    if (!String(data.nombre || '').trim()) {
      showToast('Indique el nombre del cliente.', 'err');
      return;
    }
    btn.textContent = 'Enviando…';
    const { request } = createClientRequest(data, session);
    try {
      await sendToMake({
        formulario: 'solicitud_cliente',
        request_id: request.id,
        nombre_cliente: request.nombre,
        codigo_cliente: request.codigo || '',
        contacto_cliente: request.contacto,
        cargo_contacto: request.contacto_rol || '',
        telefono_cliente: request.telefono || '',
        telefono_fijo: request.telefono_fijo || '',
        correo_contacto: request.correo_contacto || '',
        ubicacion_cliente: request.ubicacion || '',
        notas_solicitud: request.notas,
        correo_jefe: request.correo_jefe || session.correo_jefe || '',
        correo_vendedor: session.correo || '',
        correo_ventas: getState().correo_ventas,
        vendedor: session.nombre,
        pais: session.pais || '',
        accion: 'nueva_solicitud',
      });
      showToast('Solicitud enviada. Su jefe la verá en la bandeja para aprobar.');
    } catch {
      showToast('Solicitud registrada. Su jefe la verá en la bandeja de la app.');
    }
    go('/solicitudes', { replace: true, animate: false });
  });
}

function catalogBlock(meta, items) {
  const activeCount = items.filter((x) => x.activo !== false).length;
  const rows = items
    .map(
      (it) => `
      <div class="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5">
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-semibold text-slate-800">${escapeHtml(it.label)}</div>
        </div>
        ${iosSwitch('cat_active', it.activo, { dataAttr: `data-cat-toggle="${meta.key}" data-cat-id="${it.id}"` })}
        <button type="button" data-cat-edit="${meta.key}" data-cat-id="${it.id}" class="text-xs font-bold text-red-600 hover:underline">Editar</button>
        <button type="button" data-cat-del="${meta.key}" data-cat-id="${it.id}" class="text-xs font-bold text-slate-400 hover:text-red-600">✕</button>
      </div>`
    )
    .join('');

  return `
    <details class="group rounded-2xl border border-slate-200 bg-white shadow-sm" data-catalog="${meta.key}">
      <summary class="flex cursor-pointer list-none items-start justify-between gap-3 p-4 sm:p-5 [&::-webkit-details-marker]:hidden">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-sm font-black uppercase tracking-wider text-slate-900">${meta.title}</h3>
            <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">${activeCount}/${items.length} activas</span>
          </div>
          <p class="mt-1 text-xs text-slate-500">${meta.hint}</p>
        </div>
        <span class="mt-0.5 shrink-0 rounded-full border border-slate-200 p-1.5 text-slate-400 transition group-open:rotate-180 group-open:border-red-200 group-open:text-red-600">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
        </span>
      </summary>
      <div class="border-t border-slate-100 px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
        <div class="mb-3 flex justify-end">
          <button type="button" data-cat-add="${meta.key}" class="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-red-200 hover:text-red-600">+ Agregar</button>
        </div>
        <div class="space-y-2">${rows || '<p class="text-sm text-slate-400">Sin opciones aún.</p>'}</div>
        <form data-cat-form="${meta.key}" class="mt-3 hidden grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <input type="hidden" name="id" />
          <input name="label" required placeholder="Nombre de la opción" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-red-500" />
          <button class="rounded-xl bg-red-600 px-4 py-2.5 text-xs font-black uppercase text-white">Guardar</button>
          <button type="button" data-cat-cancel="${meta.key}" class="rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-600">Cancelar</button>
        </form>
      </div>
    </details>
  `;
}

function userOptionChecks(catalogKey, globalItems, userSelectedIds) {
  const selected = Array.isArray(userSelectedIds) ? userSelectedIds : [];
  const inheritAll = selected.length === 0;
  return `
    <div class="rounded-xl border border-slate-200 bg-white p-3 sm:col-span-2">
      <div class="mb-2 flex items-center justify-between gap-2">
        <div class="text-xs font-bold uppercase tracking-wider text-slate-500">${
          CATALOG_META.find((c) => c.key === catalogKey)?.title || catalogKey
        }</div>
        <label class="flex items-center gap-2 text-[11px] font-semibold text-slate-500">
          <input type="checkbox" data-inherit="${catalogKey}" ${inheritAll ? 'checked' : ''} />
          Heredar todos los globales
        </label>
      </div>
      <div class="grid gap-2 sm:grid-cols-2" data-option-grid="${catalogKey}" style="${inheritAll ? 'opacity:0.45;pointer-events:none' : ''}">
        ${globalItems
          .filter((x) => x.activo)
          .map(
            (x) => `
          <label class="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm text-slate-700">
            <input type="checkbox" name="${catalogKey}" value="${escapeHtml(x.id)}" ${
              selected.includes(x.id) ? 'checked' : ''
            } />
            ${escapeHtml(x.label)}
          </label>`
          )
          .join('') || '<p class="text-xs text-slate-400 sm:col-span-2">No hay opciones activas en el catálogo global.</p>'}
      </div>
      <p class="mt-2 text-[11px] text-slate-400">Si hereda todos, el vendedor ve las opciones globales activas. Si desactiva la herencia, elija solo las que aplican a este usuario.</p>
    </div>
  `;
}

function renderAdminHub() {
  const state = getState();
  const pending = state.clientRequests.filter((r) => r.estado === 'pendiente').length;
  const clients = state.clients.filter((c) => c.activo !== false).length;

  app.innerHTML = shell(
    `
    <div class="mb-5">
      <p class="text-xs font-bold uppercase tracking-[0.2em] text-red-600">Administración</p>
      <h2 class="mt-1 text-xl font-black text-slate-900 sm:text-2xl">Panel de configuración</h2>
      <p class="mt-1 text-sm text-slate-500">Seleccione el módulo que desea gestionar.</p>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <div class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
          ${clients} cliente${clients === 1 ? '' : 's'}
        </div>
        ${
          pending
            ? `<div class="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">${pending} solicitud${pending > 1 ? 'es' : ''}</div>`
            : ''
        }
      </div>
    </div>
    <div class="stagger grid grid-cols-2 gap-3 sm:gap-4">
      ${actionCard('/admin/config', 'Configuración global', 'Combustible, catálogo y webhook.', 'config')}
      ${actionCard('/admin/base-datos', 'Base de datos', 'Ejecutivos, carteras e importación.', 'carga')}
      ${actionCard('/admin/solicitudes', 'Solicitudes', pending ? `${pending} pendiente${pending > 1 ? 's' : ''}.` : 'Aprobar o rechazar altas.', 'solicitudes')}
      ${actionCard('/admin/catalogos', 'Catálogos globales', 'Opciones de formularios.', 'catalogos')}
      ${actionCard('/admin/usuarios', 'Usuarios', 'Correos, claves y permisos.', 'usuarios')}
      ${actionCard('/admin/historial', 'Historial de contactos', 'Cambios de contacto por ejecutivo.', 'solicitudes')}
      ${actionCard('/admin/dashboard', 'Dashboard', 'Visitas y pendientes por ejecutivo.', 'visita')}
    </div>
    `,
    { title: 'Administración' }
  );
  bindShell('/');
}

function bindAdminSubShell() {
  bindShell('/');
}

function renderAdminConfig() {
  const state = getState();
  app.innerHTML = shell(
    `
    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 class="text-sm font-black uppercase tracking-wider text-slate-900">Configuración global</h3>
      <p class="mt-1 text-xs text-slate-500">Parámetros que aplican a toda la plataforma.</p>
      <form id="form-config" class="mt-4 space-y-4">
        <div class="flex items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3">
          <div>
            <div class="text-sm font-bold text-slate-900">Combustible global</div>
            <p class="text-xs text-slate-500">Si está activo, todos los usuarios heredan combustible ON.</p>
          </div>
          ${iosSwitch('combustibleGlobal', state.combustibleGlobal)}
        </div>
        <div class="flex items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3">
          <div>
            <div class="text-sm font-bold text-slate-900">Catálogo de clientes</div>
            <p class="text-xs text-slate-500">OFF = el vendedor escribe libre. ON = debe elegir de la lista.</p>
          </div>
          ${iosSwitch('catalogoClientesActivo', state.catalogoClientesActivo)}
        </div>
        ${field('Webhook Make', 'webhookUrl', {
          value: state.webhookUrl,
          required: false,
          placeholder: 'https://hook.us2.make.com/...',
        })}
        ${field('Correo Ventas (aprobaciones)', 'correo_ventas', {
          value: state.correo_ventas,
          required: false,
          type: 'email',
          placeholder: 'ventas@red.com.sv',
        })}
        ${field('API key de lectura (export)', 'export_api_key', {
          value: state.export_api_key || '',
          required: false,
          placeholder: 'Clave para /api/export/* (header X-API-Key)',
        })}
        <p class="text-[11px] text-slate-400">Documentación de la API de lectura en el README del repositorio. Endpoints: <code class="rounded bg-slate-100 px-1">/api/export/clients</code>, <code class="rounded bg-slate-100 px-1">salidas</code>, <code class="rounded bg-slate-100 px-1">citas</code>, <code class="rounded bg-slate-100 px-1">resumen</code>.</p>
        <button class="inline-flex items-center justify-center rounded-xl bg-red-600 px-5 py-3 text-sm font-black uppercase tracking-tight text-white transition hover:bg-red-700">Guardar configuración</button>
      </form>
    </section>
    `,
    { title: 'Configuración global', showBack: true, backTo: '/admin' }
  );
  bindAdminSubShell();
  document.getElementById('form-config').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    updateConfig({
      combustibleGlobal: fd.get('combustibleGlobal') === 'on',
      catalogoClientesActivo: fd.get('catalogoClientesActivo') === 'on',
      webhookUrl: fd.get('webhookUrl'),
      correo_ventas: fd.get('correo_ventas'),
      export_api_key: fd.get('export_api_key'),
    });
    showToast('Configuración guardada.');
    render();
  });
}

function renderAdminBaseDatos() {
  const state = getState();
  const params = new URLSearchParams(location.search);
  const view = params.get('view') || '';
  const filterVend = params.get('vendedor') || '';
  const filterPais = params.get('pais') || '';

  if (!view) {
    app.innerHTML = shell(
      `
    <div class="mb-4">
      <h3 class="text-sm font-black uppercase tracking-wider text-slate-900">Base de datos</h3>
      <p class="mt-1 text-xs text-slate-500">Seleccione qué desea consultar.</p>
    </div>
    <div class="stagger grid grid-cols-2 gap-3 sm:gap-4">
      ${actionCard('/admin/base-datos?view=ejecutivos', 'Ejecutivos', 'Vendedores por país y cartera.', 'usuarios')}
      ${actionCard('/admin/base-datos?view=clientes', 'Clientes', 'Cartera completa SV / GT.', 'cliente')}
      ${actionCard('/admin/base-datos?view=importar', 'Importar', 'Cargar Excel de cartera.', 'carga')}
    </div>
    `,
      { title: 'Base de datos', showBack: true, backTo: '/admin' }
    );
    bindAdminSubShell();
    return;
  }

  let ejecutivos = getEjecutivos();
  const ePais = params.get('epais') || '';
  const eOrden = params.get('orden') || 'nombre';
  const eQ = (params.get('eq') || '').toLowerCase();
  ejecutivos = ejecutivos.map((u) => ({ ...u, _clientes: getClientsByVendedor(u.id).length }));
  if (ePais) ejecutivos = ejecutivos.filter((u) => u.pais === ePais);
  if (eQ) {
    ejecutivos = ejecutivos.filter((u) =>
      `${u.nombre} ${u.usuario} ${u.correo}`.toLowerCase().includes(eQ)
    );
  }
  if (eOrden === 'mas') ejecutivos.sort((a, b) => b._clientes - a._clientes);
  else if (eOrden === 'menos') ejecutivos.sort((a, b) => a._clientes - b._clientes);
  else ejecutivos.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  let clients = state.clients.filter((c) => c.activo !== false);
  if (filterVend) clients = clients.filter((c) => c.vendedorId === filterVend);
  if (filterPais) clients = clients.filter((c) => c.pais === filterPais);
  clients.sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));

  const CLIENTS_PAGE_SIZE = 50;
  const clientsTotal = clients.length;
  const clientsPages = Math.max(1, Math.ceil(clientsTotal / CLIENTS_PAGE_SIZE));
  let clientsPage = Number.parseInt(params.get('page') || '1', 10);
  if (!Number.isFinite(clientsPage) || clientsPage < 1) clientsPage = 1;
  if (clientsPage > clientsPages) clientsPage = clientsPages;
  const clientsOffset = (clientsPage - 1) * CLIENTS_PAGE_SIZE;
  const clientsPageItems = clients.slice(clientsOffset, clientsOffset + CLIENTS_PAGE_SIZE);
  const clientsFrom = clientsTotal ? clientsOffset + 1 : 0;
  const clientsTo = Math.min(clientsOffset + CLIENTS_PAGE_SIZE, clientsTotal);

  const clientsListQuery = (pageNum) => {
    const q = new URLSearchParams({ view: 'clientes' });
    if (filterVend) q.set('vendedor', filterVend);
    if (filterPais) q.set('pais', filterPais);
    if (pageNum > 1) q.set('page', String(pageNum));
    return `/admin/base-datos?${q.toString()}`;
  };

  const sellerOpts = ejecutivos
    .map(
      (u) =>
        `<option value="${escapeHtml(u.id)}" ${u.id === filterVend ? 'selected' : ''}>${escapeHtml(
          `${u.pais ? `[${u.pais}] ` : ''}${u.nombre}`
        )}</option>`
    )
    .join('');

  const viewTitle =
    view === 'ejecutivos' ? 'Ejecutivos' : view === 'clientes' ? 'Clientes' : 'Importar';
  const viewHelp =
    view === 'ejecutivos'
      ? 'Vendedores por país y tamaño de cartera.'
      : view === 'clientes'
        ? 'Cartera completa SV / GT, filtrable por ejecutivo.'
        : 'Carga masiva de Excel o CSV.';

  const sectionTabs = `
    <div class="mb-4 flex flex-wrap gap-2">
      <button data-nav="/admin/base-datos?view=ejecutivos" class="rounded-full border px-3 py-1.5 text-xs font-bold ${view === 'ejecutivos' ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600'}">Ejecutivos</button>
      <button data-nav="/admin/base-datos?view=clientes" class="rounded-full border px-3 py-1.5 text-xs font-bold ${view === 'clientes' ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600'}">Clientes</button>
      <button data-nav="/admin/base-datos?view=importar" class="rounded-full border px-3 py-1.5 text-xs font-bold ${view === 'importar' ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600'}">Importar</button>
    </div>`;

  app.innerHTML = shell(
    `
    <div class="mb-4">
      <h3 class="text-sm font-black uppercase tracking-wider text-slate-900">Base de datos · ${viewTitle}</h3>
      <p class="mt-1 text-xs text-slate-500">${viewHelp}</p>
    </div>
    ${sectionTabs}

    ${
      view === 'importar'
        ? `
    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h4 class="text-sm font-black text-slate-900">Importar Excel</h4>
      <p class="mt-1 text-xs text-slate-500">Mismas columnas del archivo de cartera (País, Código, Cliente, Ejecutivo, GG/GO/GF…). Omite Intelfon Guatemala.</p>
      <div class="mt-4 space-y-3">
        <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <p class="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Modo de carga</p>
          <label class="mb-2 flex cursor-pointer items-start gap-2">
            <input type="radio" name="import-mode" value="merge" checked class="mt-1" />
            <span><strong>Agregar / actualizar</strong> — suma filas nuevas y completa contactos faltantes sin borrar la base actual.</span>
          </label>
          <label class="flex cursor-pointer items-start gap-2">
            <input type="radio" name="import-mode" value="replace" class="mt-1" />
            <span><strong>Reemplazar</strong> — elimina la cartera de clientes (no prospectos) y carga solo lo del archivo.</span>
          </label>
        </div>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input id="file-clients" type="file" accept=".csv,.xlsx,.xls" class="w-full flex-1 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm" />
          <button id="btn-import-clients" class="rounded-xl bg-slate-900 px-4 py-3 text-xs font-black uppercase tracking-tight text-white hover:bg-slate-800">Importar</button>
        </div>
      </div>
      <p id="import-status" class="mt-2 text-xs text-slate-500"></p>
      <p class="mt-3 text-[11px] text-slate-400">Los ejecutivos nuevos nacen con clave temporal: asigne correos y claves en Usuarios.</p>
    </section>`
        : ''
    }

    ${
      view === 'ejecutivos'
        ? `
    <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div class="mb-3 grid gap-2 sm:grid-cols-3">
        <div class="sm:col-span-1">
          <label class="mb-1 block text-[11px] font-bold uppercase text-slate-400">Buscar</label>
          <input id="filter-eq" value="${escapeHtml(params.get('eq') || '')}" placeholder="Nombre, usuario o correo" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
        </div>
        <div>
          <label class="mb-1 block text-[11px] font-bold uppercase text-slate-400">País</label>
          <select id="filter-epais" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
            <option value="">Todos</option>
            <option value="SV" ${ePais === 'SV' ? 'selected' : ''}>El Salvador</option>
            <option value="GT" ${ePais === 'GT' ? 'selected' : ''}>Guatemala</option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-[11px] font-bold uppercase text-slate-400">Orden</label>
          <select id="filter-orden" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
            <option value="nombre" ${eOrden === 'nombre' ? 'selected' : ''}>Por nombre</option>
            <option value="mas" ${eOrden === 'mas' ? 'selected' : ''}>Más clientes</option>
            <option value="menos" ${eOrden === 'menos' ? 'selected' : ''}>Menos clientes</option>
          </select>
        </div>
      </div>
      <p class="mb-3 text-xs font-semibold text-slate-500">${ejecutivos.length} ejecutivo${ejecutivos.length === 1 ? '' : 's'}</p>
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        ${
          ejecutivos.length
            ? ejecutivos
                .map((u) => {
                  const n = u._clientes;
                  return `
          <article class="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="text-sm font-black text-slate-900 break-words">${escapeHtml(u.nombre)}</div>
                <div class="mt-0.5 text-xs font-semibold text-slate-500 break-all">Usuario: ${escapeHtml(u.usuario)}</div>
              </div>
              <span class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">${escapeHtml(u.pais || '—')}</span>
            </div>
            <dl class="mt-3 space-y-1.5 text-xs text-slate-600">
              <div class="min-w-0">
                <span class="font-bold uppercase tracking-wider text-[10px] text-slate-400">Correo</span>
                <div class="break-all">${escapeHtml(u.correo || 'Sin correo')}</div>
              </div>
              <div>
                <span class="font-bold uppercase tracking-wider text-[10px] text-slate-400">Clientes en cartera</span>
                <div class="text-sm font-black text-slate-900">${n}</div>
              </div>
            </dl>
            <div class="mt-auto border-t border-slate-100 pt-3">
              <a href="/admin/base-datos?view=clientes&vendedor=${encodeURIComponent(u.id)}" data-nav class="text-xs font-bold text-red-600 hover:underline">Ver cartera</a>
            </div>
          </article>`;
                })
                .join('')
            : '<p class="text-sm text-slate-400 sm:col-span-2 xl:col-span-3">Sin ejecutivos. Importe el Excel.</p>'
        }
      </div>
    </section>`
        : ''
    }

    ${
      view === 'clientes'
        ? `
    <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div class="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div class="flex-1">
          <label class="mb-1 block text-[11px] font-bold uppercase text-slate-400">Ejecutivo</label>
          <select id="filter-vendedor" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
            <option value="">Todos</option>
            ${sellerOpts}
          </select>
        </div>
        <div>
          <label class="mb-1 block text-[11px] font-bold uppercase text-slate-400">País</label>
          <select id="filter-pais" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
            <option value="">Todos</option>
            <option value="SV" ${filterPais === 'SV' ? 'selected' : ''}>SV</option>
            <option value="GT" ${filterPais === 'GT' ? 'selected' : ''}>GT</option>
          </select>
        </div>
        <button id="btn-new-client" class="rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-700 hover:border-red-200 hover:text-red-600">+ Cliente</button>
      </div>
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs font-semibold text-slate-500">${clientsTotal} cliente${clientsTotal === 1 ? '' : 's'} · mostrando ${clientsFrom}–${clientsTo}</p>
        <p class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Página ${clientsPage} de ${clientsPages}</p>
      </div>
      <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        ${
          clientsPageItems.length
            ? clientsPageItems
                .map(
                  (c) => `
          <article class="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="text-[13px] font-black leading-snug text-slate-900 break-words">${escapeHtml(c.nombre)}</div>
                <div class="mt-0.5 text-[11px] text-slate-500">${escapeHtml(c.codigo || 'Sin código')} · ${escapeHtml(c.pais || '—')}</div>
              </div>
            </div>
            <div class="mt-2 space-y-0.5 text-[11px] leading-snug text-slate-600">
              <div class="truncate"><span class="font-semibold text-slate-400">Contacto:</span> ${escapeHtml(c.contacto || '—')}</div>
              <div class="truncate"><span class="font-semibold text-slate-400">Tel:</span> ${escapeHtml(c.telefono || '—')}</div>
              <div class="truncate"><span class="font-semibold text-slate-400">Ejecutivo:</span> ${escapeHtml(c.vendedorNombre || 'Sin asignar')}</div>
            </div>
            <div class="mt-auto flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 pt-2">
              <button data-edit-client="${c.id}" class="text-[11px] font-bold text-red-600 hover:underline">Editar</button>
              <button data-del-client="${c.id}" class="text-[11px] font-bold text-slate-400 hover:text-red-600">Eliminar</button>
            </div>
          </article>`
                )
                .join('')
            : '<p class="text-sm text-slate-400 sm:col-span-2 xl:col-span-3 2xl:col-span-4">Sin clientes.</p>'
        }
      </div>
      ${
        clientsPages > 1
          ? `<div class="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button data-nav="${escapeHtml(clientsListQuery(clientsPage - 1))}" class="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 ${clientsPage <= 1 ? 'pointer-events-none opacity-40' : 'hover:border-red-200 hover:text-red-600'}" ${clientsPage <= 1 ? 'disabled' : ''}>Anterior</button>
              ${Array.from({ length: clientsPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === clientsPages || Math.abs(p - clientsPage) <= 2)
                .reduce((acc, p, idx, arr) => {
                  if (idx > 0 && p - arr[idx - 1] > 1) acc.push('<span class="px-1 text-xs text-slate-400">…</span>');
                  acc.push(
                    `<button data-nav="${escapeHtml(clientsListQuery(p))}" class="min-w-[2rem] rounded-xl border px-2.5 py-2 text-xs font-bold ${p === clientsPage ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600 hover:border-red-200'}">${p}</button>`
                  );
                  return acc;
                }, [])
                .join('')}
              <button data-nav="${escapeHtml(clientsListQuery(clientsPage + 1))}" class="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 ${clientsPage >= clientsPages ? 'pointer-events-none opacity-40' : 'hover:border-red-200 hover:text-red-600'}" ${clientsPage >= clientsPages ? 'disabled' : ''}>Siguiente</button>
            </div>`
          : ''
      }
    </section>

    <section id="client-editor" class="mt-4 hidden rounded-2xl border border-red-100 bg-red-50/40 p-5">
      <h4 class="text-sm font-black uppercase tracking-wider text-red-700">Cliente</h4>
      <form id="form-client" class="mt-3 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="id" />
        ${field('Código', 'codigo', { required: false })}
        ${field('País', 'pais', {
          type: 'select',
          required: false,
          value: `<option value="">—</option><option value="SV">SV</option><option value="GT">GT</option>`,
        })}
        ${field('Cliente', 'nombre')}
        ${field('Contacto', 'contacto', { required: false })}
        ${field('Teléfono', 'telefono', { required: false, type: 'tel' })}
        ${field('Correo contacto', 'correo_contacto', { required: false, type: 'email' })}
        ${field('Ejecutivo', 'vendedorId', {
          type: 'select',
          required: false,
          value: `<option value="">Sin asignar</option>${sellerOpts}`,
        })}
        <div class="sm:col-span-2 flex gap-2">
          <button class="flex-1 rounded-xl bg-red-600 px-5 py-3 text-sm font-black uppercase text-white hover:bg-red-700">Guardar</button>
          <button type="button" id="btn-cancel-client" class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600">Cancelar</button>
        </div>
      </form>
    </section>`
        : ''
    }
    `,
    { title: 'Base de datos', showBack: true, backTo: '/admin' }
  );
  bindAdminSubShell();

  document.getElementById('btn-import-clients')?.addEventListener('click', async () => {
    const input = document.getElementById('file-clients');
    const status = document.getElementById('import-status');
    const file = input?.files?.[0];
    if (!file) {
      showToast('Seleccione un archivo Excel o CSV.', 'err');
      return;
    }
    const mode =
      document.querySelector('input[name="import-mode"]:checked')?.value === 'replace'
        ? 'replace'
        : 'merge';
    status.textContent = 'Procesando archivo…';
    try {
      const { rows, omitted } = await parseClientFile(file);
      const currentCount = getState().clients.filter((c) => c.tipo !== 'prospecto').length;
      if (rows.length < currentCount) {
        const ok = confirm(
          `Atención: el archivo tiene ${rows.length} fila(s) y la base actual tiene ${currentCount} cliente(s).\n\n` +
            (mode === 'replace'
              ? 'Con «Reemplazar» se eliminarán los clientes que no vengan en el archivo.\n\n¿Continuar?'
              : 'Con «Agregar» solo se sumarán o actualizarán esas filas; el resto de la base se conserva.\n\n¿Continuar?')
        );
        if (!ok) {
          status.textContent = 'Importación cancelada.';
          return;
        }
      }
      if (mode === 'replace') {
        const okReplace = confirm(
          `¿Reemplazar toda la cartera (${currentCount} clientes) por las ${rows.length} filas del archivo? Los prospectos se conservan.`
        );
        if (!okReplace) {
          status.textContent = 'Importación cancelada.';
          return;
        }
      }
      const result = importClients(rows, { omittedFile: omitted, mode });
      showToast(
        `Listo (${result.mode}): ${result.added} nuevos, ${result.updated} actualizados, ${result.usersCreated} ejecutivos, ${result.skipped} omitidos. Base: ${result.beforeClients} → ${result.afterClients}.`
      );
      go('/admin/base-datos?view=ejecutivos');
    } catch (err) {
      status.textContent = '';
      showToast(err.message || 'No se pudo leer el archivo.', 'err');
    }
  });

  const applyFilters = () => {
    const v = document.getElementById('filter-vendedor')?.value || '';
    const p = document.getElementById('filter-pais')?.value || '';
    const q = new URLSearchParams({ view: 'clientes' });
    if (v) q.set('vendedor', v);
    if (p) q.set('pais', p);
    go(`/admin/base-datos?${q.toString()}`);
  };
  document.getElementById('filter-vendedor')?.addEventListener('change', applyFilters);
  document.getElementById('filter-pais')?.addEventListener('change', applyFilters);

  const applyEjecutivoFilters = () => {
    const q = new URLSearchParams({ view: 'ejecutivos' });
    const buscar = document.getElementById('filter-eq')?.value.trim() || '';
    const pais = document.getElementById('filter-epais')?.value || '';
    const orden = document.getElementById('filter-orden')?.value || 'nombre';
    if (buscar) q.set('eq', buscar);
    if (pais) q.set('epais', pais);
    if (orden !== 'nombre') q.set('orden', orden);
    go(`/admin/base-datos?${q.toString()}`);
  };
  document.getElementById('filter-epais')?.addEventListener('change', applyEjecutivoFilters);
  document.getElementById('filter-orden')?.addEventListener('change', applyEjecutivoFilters);
  document.getElementById('filter-eq')?.addEventListener('change', applyEjecutivoFilters);

  const editor = document.getElementById('client-editor');
  const form = document.getElementById('form-client');
  const openClient = (c = null) => {
    if (!editor || !form) return;
    editor.classList.remove('hidden');
    form.reset();
    form.id.value = c?.id || createId('cli');
    form.codigo.value = c?.codigo || '';
    form.pais.value = c?.pais || '';
    form.nombre.value = c?.nombre || '';
    form.contacto.value = c?.contacto || '';
    form.telefono.value = c?.telefono || '';
    form.correo_contacto.value = c?.correo_contacto || '';
    form.vendedorId.value = c?.vendedorId || filterVend || '';
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  document.getElementById('btn-new-client')?.addEventListener('click', () => openClient(null));
  document.getElementById('btn-cancel-client')?.addEventListener('click', () => editor?.classList.add('hidden'));

  document.querySelectorAll('[data-edit-client]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const c = getState().clients.find((x) => x.id === btn.dataset.editClient);
      openClient(c);
    });
  });
  document.querySelectorAll('[data-del-client]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!confirm('¿Eliminar este cliente?')) return;
      deleteClient(btn.dataset.delClient);
      showToast('Cliente eliminado.');
      render();
    });
  });

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const vendedorId = String(fd.get('vendedorId') || '').trim();
    const seller = getState().users.find((u) => u.id === vendedorId);
    upsertClient({
      id: String(fd.get('id')),
      codigo: String(fd.get('codigo') || '').trim(),
      pais: String(fd.get('pais') || '').trim(),
      nombre: String(fd.get('nombre') || '').trim(),
      contacto: String(fd.get('contacto') || '').trim(),
      telefono: String(fd.get('telefono') || '').trim(),
      correo_contacto: String(fd.get('correo_contacto') || '').trim(),
      vendedorId,
      vendedorNombre: seller?.nombre || '',
      origen: 'manual',
      activo: true,
    });
    showToast('Cliente guardado.');
    render();
  });
}

function renderAdminHistorial(basePath = '/admin/historial') {
  const state = getState();
  const isAdminView = basePath.startsWith('/admin');
  const params = new URLSearchParams(location.search);
  const filterVend = params.get('vendedor') || '';
  const filterFecha = params.get('fecha') || '';
  let changes = [...(state.contactChanges || [])].sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt))
  );
  if (filterVend) changes = changes.filter((x) => x.vendedorId === filterVend);
  if (filterFecha) changes = changes.filter((x) => String(x.createdAt).slice(0, 10) === filterFecha);
  let ejecutivos = getEjecutivos();
  if (!ejecutivos.length) {
    const seen = new Map();
    for (const x of state.contactChanges || []) {
      if (x.vendedorId && !seen.has(x.vendedorId)) {
        seen.set(x.vendedorId, { id: x.vendedorId, nombre: x.vendedorNombre || '', pais: x.pais || '' });
      }
    }
    ejecutivos = [...seen.values()];
  }
  const sellerOpts = ejecutivos
    .map(
      (u) =>
        `<option value="${escapeHtml(u.id)}" ${u.id === filterVend ? 'selected' : ''}>${escapeHtml(`${u.pais ? `[${u.pais}] ` : ''}${u.nombre}`)}</option>`
    )
    .join('');

  app.innerHTML = shell(
    `
    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 class="text-sm font-black uppercase tracking-wider text-slate-900">Historial de contactos</h3>
      <p class="mt-1 text-xs text-slate-500">Cambios de contacto hechos por cada ejecutivo en su cartera.</p>
      <div class="mb-3 mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div class="flex-1">
          <label class="mb-1 block text-[11px] font-bold uppercase text-slate-400">Ejecutivo</label>
          <select id="filter-vendedor-hist" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
            <option value="">Todos</option>
            ${sellerOpts}
          </select>
        </div>
        <div>
          <label class="mb-1 block text-[11px] font-bold uppercase text-slate-400">Fecha</label>
          <input id="filter-fecha-hist" type="date" value="${escapeHtml(filterFecha)}" class="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
        </div>
      </div>
      <p class="mb-2 text-xs text-slate-500">${changes.length} cambio${changes.length === 1 ? '' : 's'}</p>
      <div class="max-h-[28rem] overflow-y-auto rounded-xl border border-slate-100">
        <table class="min-w-full text-left text-sm">
          <thead class="sticky top-0 bg-slate-50 text-xs uppercase tracking-wider text-slate-400">
            <tr>
              <th class="px-3 py-2">Fecha</th>
              <th class="px-3 py-2">Ejecutivo</th>
              <th class="px-3 py-2">Cliente</th>
              <th class="px-3 py-2">Campo</th>
              <th class="px-3 py-2">Anterior</th>
              <th class="px-3 py-2">Nuevo</th>
            </tr>
          </thead>
          <tbody>
            ${
              changes.length
                ? changes
                    .map(
                      (x) => `
              <tr class="border-t border-slate-100">
                <td class="px-3 py-2 whitespace-nowrap text-slate-500">${escapeHtml(String(x.createdAt || '').slice(0, 16).replace('T', ' '))}</td>
                <td class="px-3 py-2 text-slate-600">${escapeHtml(x.vendedorNombre || '—')}</td>
                <td class="px-3 py-2 font-semibold text-slate-900">${escapeHtml(x.clienteNombre || '—')}</td>
                <td class="px-3 py-2 text-slate-600">${escapeHtml(x.campoLabel || x.campo || '—')}</td>
                <td class="px-3 py-2 text-slate-500">${escapeHtml(x.anterior || '— (vacío)')}</td>
                <td class="px-3 py-2 font-semibold text-slate-900">${escapeHtml(x.nuevo || '— (vacío)')}</td>
              </tr>`
                    )
                    .join('')
                : '<tr><td colspan="6" class="px-3 py-4 text-slate-400">Sin cambios registrados.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </section>
    `,
    { title: 'Historial de contactos', showBack: true, backTo: isAdminView ? '/admin' : '/' }
  );
  if (isAdminView) bindAdminSubShell();
  else bindShell('/');
  const apply = () => {
    const v = document.getElementById('filter-vendedor-hist')?.value || '';
    const f = document.getElementById('filter-fecha-hist')?.value || '';
    const q = new URLSearchParams();
    if (v) q.set('vendedor', v);
    if (f) q.set('fecha', f);
    go(q.toString() ? `${basePath}?${q.toString()}` : basePath);
  };
  document.getElementById('filter-vendedor-hist')?.addEventListener('change', apply);
  document.getElementById('filter-fecha-hist')?.addEventListener('change', apply);
}

function renderAdminSolicitudes(basePath = '/admin/solicitudes') {
  const state = getState();
  const user = state.session;
  const isAdminView = basePath.startsWith('/admin');
  const teamIds = isAdminView
    ? null
    : new Set([user.id, ...getTeamVendedores(user).map((t) => t.id)]);
  const pendingReqs = state.clientRequests.filter((r) => {
    if (r.estado !== 'pendiente') return false;
    if (!teamIds) return true;
    return teamIds.has(r.vendedorId);
  });
  app.innerHTML = shell(
    `
    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 class="text-sm font-black uppercase tracking-wider text-slate-900">Solicitudes</h3>
      <p class="mt-1 text-xs text-slate-500">${isAdminView ? 'Apruebe o rechace altas pedidas por vendedores.' : 'Altas a cartera pedidas por su equipo.'}</p>
      <div class="mt-4 space-y-3">
        ${
          pendingReqs.length
            ? pendingReqs
                .map(
                  (r) => `
          <div class="rounded-xl border border-amber-200 bg-amber-50/40 p-3">
            <div class="text-sm font-black text-slate-900">${escapeHtml(r.nombre)}${r.codigo ? ` <span class="text-xs font-semibold text-slate-500">(${escapeHtml(r.codigo)})</span>` : ''}</div>
            <div class="mt-0.5 text-xs text-slate-600">Contacto: ${escapeHtml(r.contacto || '—')}${r.contacto_rol ? ` (${escapeHtml(r.contacto_rol)})` : ''}${r.telefono ? ` · Tel: ${escapeHtml(r.telefono)}` : ''}${r.correo_contacto ? ` · ${escapeHtml(r.correo_contacto)}` : ''}</div>
            ${r.ubicacion ? `<p class="mt-1 text-xs text-slate-500">Ubicación: ${escapeHtml(r.ubicacion)}</p>` : ''}
            <div class="mt-0.5 text-xs text-slate-600">Solicitó: ${escapeHtml(r.vendedorNombre)}</div>
            ${r.notas ? `<p class="mt-1 text-xs text-slate-500">${escapeHtml(r.notas)}</p>` : ''}
            <div class="mt-3 flex flex-wrap gap-2">
              <button data-approve="${r.id}" class="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Aprobar</button>
              <button data-reject="${r.id}" class="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white">Rechazar</button>
            </div>
          </div>`
                )
                .join('')
            : '<p class="text-sm text-slate-400">No hay solicitudes pendientes.</p>'
        }
      </div>
    </section>
    `,
    { title: 'Solicitudes', showBack: true, backTo: isAdminView ? '/admin' : '/' }
  );
  if (isAdminView) bindAdminSubShell();
  else bindShell('/');
  document.querySelectorAll('[data-approve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const req = getState().clientRequests.find((r) => r.id === btn.dataset.approve);
      if (!req || req.estado !== 'pendiente') return;
      btn.disabled = true;
      try {
        await sendToMake({
          formulario: 'solicitud_cliente',
          request_id: req.id,
          nombre_cliente: req.nombre,
          contacto_cliente: req.contacto,
          telefono_cliente: req.telefono || '',
          correo_vendedor: req.vendedorCorreo,
          correo_ventas: getState().correo_ventas,
          accion: 'aprobado',
          vendedor: req.vendedorNombre,
        });
      } catch {
        showToast('No se pudo completar la solicitud. La solicitud sigue pendiente.', 'err');
        btn.disabled = false;
        return;
      }
      resolveClientRequest(req.id, 'aprobado');
      showToast('Cliente aprobado y notificado.');
      render();
    });
  });
  document.querySelectorAll('[data-reject]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const motivo = prompt('Motivo del rechazo (opcional):') || '';
      const req = getState().clientRequests.find((r) => r.id === btn.dataset.reject);
      if (!req || req.estado !== 'pendiente') return;
      btn.disabled = true;
      try {
        await sendToMake({
          formulario: 'solicitud_cliente',
          request_id: req.id,
          nombre_cliente: req.nombre,
          contacto_cliente: req.contacto,
          telefono_cliente: req.telefono || '',
          correo_vendedor: req.vendedorCorreo,
          correo_ventas: getState().correo_ventas,
          accion: 'rechazado',
          motivo,
          vendedor: req.vendedorNombre,
        });
      } catch {
        showToast('No se pudo completar la solicitud. La solicitud sigue pendiente.', 'err');
        btn.disabled = false;
        return;
      }
      resolveClientRequest(req.id, 'rechazado', motivo);
      showToast('Solicitud rechazada y notificada.');
      render();
    });
  });
}

function bindCatalogHandlers() {
  document.querySelectorAll('[data-cat-toggle]').forEach((input) => {
    input.addEventListener('change', () => {
      setCatalogItemActive(input.dataset.catToggle, input.dataset.catId, input.checked);
      showToast(input.checked ? 'Opción activada.' : 'Opción desactivada.');
    });
  });
  document.querySelectorAll('[data-cat-add]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const key = btn.dataset.catAdd;
      const details = document.querySelector(`[data-catalog="${key}"]`);
      if (details) details.open = true;
      const form = document.querySelector(`[data-cat-form="${key}"]`);
      form.classList.remove('hidden');
      form.reset();
      form.id.value = createId('cat');
      form.label.focus();
    });
  });
  document.querySelectorAll('[data-cat-cancel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelector(`[data-cat-form="${btn.dataset.catCancel}"]`)?.classList.add('hidden');
    });
  });
  document.querySelectorAll('[data-cat-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.catEdit;
      const item = getState().catalogos[key].find((x) => x.id === btn.dataset.catId);
      if (!item) return;
      const details = document.querySelector(`[data-catalog="${key}"]`);
      if (details) details.open = true;
      const form = document.querySelector(`[data-cat-form="${key}"]`);
      form.classList.remove('hidden');
      form.id.value = item.id;
      form.label.value = item.label;
      form.label.focus();
    });
  });
  document.querySelectorAll('[data-cat-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!confirm('¿Eliminar esta opción del catálogo?')) return;
      deleteCatalogItem(btn.dataset.catDel, btn.dataset.catId);
      showToast('Opción eliminada.');
      render();
    });
  });
  document.querySelectorAll('[data-cat-form]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const key = form.dataset.catForm;
      const fd = new FormData(form);
      const existing = getState().catalogos[key].find((x) => x.id === fd.get('id'));
      upsertCatalogItem(key, {
        id: fd.get('id'),
        label: fd.get('label'),
        activo: existing ? existing.activo : true,
      });
      showToast('Opción guardada.');
      render();
    });
  });
}

function renderAdminCatalogos() {
  const state = getState();
  app.innerHTML = shell(
    `
    <div class="mb-4">
      <h3 class="text-sm font-black uppercase tracking-wider text-slate-900">Catálogos globales</h3>
      <p class="mt-1 text-xs text-slate-500">Expanda cada bloque para editar las opciones de los formularios.</p>
    </div>
    <div class="space-y-3">
      ${CATALOG_META.map((meta) => catalogBlock(meta, state.catalogos[meta.key] || [])).join('')}
    </div>
    `,
    { title: 'Catálogos globales', showBack: true, backTo: '/admin' }
  );
  bindAdminSubShell();
  bindCatalogHandlers();
}

function renderAdminUsuarios() {
  const state = getState();
  const params = new URLSearchParams(location.search);
  const paisSel = params.get('pais') || 'SV';
  const countPais = (p) => state.users.filter((u) => (u.pais || '') === p).length;
  const sinPais = state.users.filter((u) => !u.pais).length;
  const visibleUsers =
    paisSel === 'XX' ? state.users.filter((u) => !u.pais) : state.users.filter((u) => u.pais === paisSel);
  const userActions = (u) => `
    <div class="flex flex-wrap gap-x-3 gap-y-1">
      <button data-edit="${u.id}" class="text-xs font-bold text-red-600 hover:underline">Editar</button>
      <button data-reset="${u.id}" class="text-xs font-bold text-slate-600 hover:text-red-600 hover:underline">Clave</button>
      ${
        u.rol === 'vendedor'
          ? `<button data-cartera="${u.id}" class="text-xs font-bold text-slate-600 hover:text-red-600 hover:underline">Cartera</button>`
          : ''
      }
      ${
        u.usuario !== 'admin'
          ? `<button data-del="${u.id}" class="text-xs font-bold text-slate-400 hover:text-red-600">Eliminar</button>`
          : ''
      }
    </div>`;

  const usersCards = visibleUsers
    .map(
      (u) => `
      <article class="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-sm font-black text-slate-900 break-words">${escapeHtml(u.nombre)}</div>
            <div class="mt-0.5 text-xs font-semibold text-slate-500 break-all">Usuario: ${escapeHtml(u.usuario)}</div>
          </div>
          <span class="shrink-0 rounded-full ${u.activo !== false ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'} px-2 py-0.5 text-[10px] font-bold">${u.activo !== false ? 'Activo' : 'Inactivo'}</span>
        </div>
        <dl class="mt-3 space-y-2 text-xs text-slate-600">
          <div class="min-w-0">
            <span class="font-bold uppercase tracking-wider text-[10px] text-slate-400">Correo</span>
            <div class="break-all">${escapeHtml(u.correo || '—')}</div>
          </div>
          <div class="min-w-0">
            <span class="font-bold uppercase tracking-wider text-[10px] text-slate-400">Correo del jefe</span>
            <div class="break-all">${escapeHtml(u.correo_jefe || '—')}</div>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span class="capitalize font-semibold text-slate-800">${escapeHtml(u.rol)}</span>
            <span class="inline-flex items-center gap-2 text-[11px] font-bold text-slate-500">Combustible ${iosSwitch('combustible_row', u.combustible_activo, {
              dataAttr: `data-toggle-fuel="${u.id}"`,
            })}</span>
          </div>
          <div class="text-[11px] text-slate-500">Forma de pago combustible: ${escapeHtml(u.pago_combustible_default || '—')}</div>
        </dl>
        <div class="mt-auto border-t border-slate-100 pt-3">${userActions(u)}</div>
      </article>`
    )
    .join('');

  const paisLabel = paisSel === 'GT' ? 'Guatemala' : paisSel === 'SV' ? 'El Salvador' : 'Sin país';

  app.innerHTML = shell(
    `
    <div class="space-y-4">
      <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-black uppercase tracking-wider text-slate-900">Usuarios</h3>
            <p class="mt-0.5 text-xs text-slate-500">Perfiles, roles y opciones heredadas de catálogos.</p>
          </div>
          <button id="btn-new-user" class="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:border-red-200 hover:text-red-600">+ Nuevo</button>
        </div>
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <button data-nav="/admin/usuarios?pais=GT" class="rounded-full border px-3 py-1.5 text-xs font-bold transition ${paisSel === 'GT' ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600 hover:border-red-200'}">
            Guatemala · ${countPais('GT')}
          </button>
          <button data-nav="/admin/usuarios?pais=SV" class="rounded-full border px-3 py-1.5 text-xs font-bold transition ${paisSel === 'SV' ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600 hover:border-red-200'}">
            El Salvador · ${countPais('SV')}
          </button>
          ${
            sinPais
              ? `<button data-nav="/admin/usuarios?pais=XX" class="rounded-full border px-3 py-1.5 text-xs font-bold transition ${paisSel === 'XX' ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-500 hover:border-red-200'}">Sin país · ${sinPais}</button>`
              : ''
          }
          <span class="ml-auto text-xs font-semibold text-slate-500">${paisLabel} · ${visibleUsers.length}</span>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          ${usersCards || '<p class="text-sm text-slate-400 sm:col-span-2 xl:col-span-3">Sin usuarios en este país.</p>'}
        </div>
      </section>

      <section id="user-editor" class="hidden rounded-2xl border border-red-100 bg-red-50/40 p-5">
        <h3 class="text-sm font-black uppercase tracking-wider text-red-700">Editar usuario</h3>
        <form id="form-user" class="mt-4 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" />
          ${field('Usuario', 'usuario')}
          ${field('Contraseña', 'password', { required: false, placeholder: 'Dejar vacío para no cambiar' })}
          ${field('Nombre', 'nombre')}
          ${field('Cargo', 'cargo', { required: false })}
          ${field('Sucursal', 'sucursal', { required: false })}
          ${field('País', 'pais', {
            type: 'select',
            required: false,
            value: `<option value="">—</option><option value="SV">El Salvador (SV)</option><option value="GT">Guatemala (GT)</option>`,
          })}
          ${field('Correo', 'correo', { type: 'email', required: false })}
          ${field('Correo jefe', 'correo_jefe', { type: 'email', required: false })}
          ${field('Rol', 'rol', {
            type: 'select',
            value: `<option value="vendedor">Vendedor</option><option value="jefe">Jefe de ventas</option><option value="admin">Admin</option>`,
          })}
          <div class="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:col-span-2">
            <span class="text-sm font-bold text-slate-800">Usuario activo (puede iniciar sesión)</span>
            ${iosSwitch('activo', true)}
          </div>
          <div class="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:col-span-2">
            <span class="text-sm font-bold text-slate-800">Combustible activo (si el global está OFF)</span>
            ${iosSwitch('combustible_activo', true)}
          </div>
          <div id="user-options" class="contents"></div>
          <div class="sm:col-span-2 flex gap-2">
            <button class="inline-flex flex-1 items-center justify-center rounded-xl bg-red-600 px-5 py-3 text-sm font-black uppercase text-white hover:bg-red-700">Guardar usuario</button>
            <button type="button" id="btn-cancel-user" class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600">Cancelar</button>
          </div>
        </form>
      </section>
    </div>
    `,
    { title: 'Usuarios', showBack: true, backTo: '/admin', wide: true }
  );
  bindAdminSubShell();

  document.querySelectorAll('[data-toggle-fuel]').forEach((input) => {
    input.addEventListener('change', () => {
      setUserCombustible(input.dataset.toggleFuel, input.checked);
      showToast(input.checked ? 'Combustible activado.' : 'Combustible desactivado.');
    });
  });

  const editor = document.getElementById('user-editor');
  const formUser = document.getElementById('form-user');
  const userOptions = document.getElementById('user-options');

  function paintUserOptions(user = null) {
    const cats = getState().catalogos;
    const optionCats = CATALOG_META.filter(
      (m) => m.key === 'tipos_salida' || m.key === 'tipos_visita'
    );
    userOptions.innerHTML = `
      ${optionCats
        .map((meta) => userOptionChecks(meta.key, cats[meta.key] || [], user?.[meta.key] || []))
        .join('')}
      <div class="sm:col-span-2 grid gap-3 sm:grid-cols-2">
        ${field('Transporte asignado', 'transporte_default', {
          type: 'select',
          required: false,
          value: catalogOptionsHtml(cats.tipos_transporte || [], user?.transporte_default || ''),
        })}
        ${field('Pago combustible asignado', 'pago_combustible_default', {
          type: 'select',
          required: false,
          value: catalogOptionsHtml(cats.tipos_pago || [], user?.pago_combustible_default || ''),
        })}
      </div>
      <p class="sm:col-span-2 text-[11px] text-slate-400">Transporte y pago quedan fijos en el reporte de visita del vendedor.</p>
    `;

    userOptions.querySelectorAll('[data-inherit]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const key = cb.dataset.inherit;
        const grid = userOptions.querySelector(`[data-option-grid="${key}"]`);
        if (!grid) return;
        if (cb.checked) {
          grid.style.opacity = '0.45';
          grid.style.pointerEvents = 'none';
          grid.querySelectorAll('input[type="checkbox"]').forEach((i) => {
            i.checked = false;
          });
        } else {
          grid.style.opacity = '1';
          grid.style.pointerEvents = 'auto';
        }
      });
    });
  }

  function openUser(user = null) {
    editor.classList.remove('hidden');
    formUser.reset();
    formUser.id.value = user?.id || createId('user');
    formUser.usuario.value = user?.usuario || '';
    formUser.password.value = '';
    formUser.nombre.value = user?.nombre || '';
    formUser.cargo.value = user?.cargo || '';
    formUser.sucursal.value = user?.sucursal || '';
    if (formUser.pais) formUser.pais.value = user?.pais || '';
    formUser.correo.value = user?.correo || '';
    formUser.correo_jefe.value = user?.correo_jefe || '';
    formUser.rol.value = user?.rol || 'vendedor';
    formUser.activo.checked = user?.activo ?? true;
    formUser.combustible_activo.checked = user?.combustible_activo ?? true;
    paintUserOptions(user);
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  document.getElementById('btn-new-user').addEventListener('click', () => openUser(null));
  document.getElementById('btn-cancel-user').addEventListener('click', () => editor.classList.add('hidden'));

  document.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const user = getState().users.find((u) => u.id === btn.dataset.edit);
      openUser(user);
    });
  });

  document.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!confirm('¿Eliminar este usuario?')) return;
      deleteUser(btn.dataset.del);
      showToast('Usuario eliminado.');
      render();
    });
  });

  document.querySelectorAll('[data-reset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const user = getState().users.find((u) => u.id === btn.dataset.reset);
      if (!user) return;
      const local = String(user.correo || user.usuario || '')
        .split('@')[0]
        .toLowerCase();
      const nueva = `${local}12345`;
      if (!confirm(`¿Restablecer la contraseña de ${user.nombre} a ${nueva}?`)) return;
      upsertUser({ ...user, password: nueva });
      showToast(`Clave de ${user.nombre}: ${nueva}`);
      render();
    });
  });

  document.querySelectorAll('[data-cartera]').forEach((btn) => {
    btn.addEventListener('click', () => {
      go(`/admin/base-datos?view=clientes&vendedor=${encodeURIComponent(btn.dataset.cartera)}`);
    });
  });

  formUser.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(formUser);
    const existing = getState().users.find((u) => u.id === fd.get('id'));
    const password = String(fd.get('password') || '').trim() || existing?.password || 'cambiar123';

    const picks = {};
    for (const key of ['tipos_salida', 'tipos_visita']) {
      const inherit = formUser.querySelector(`[data-inherit="${key}"]`)?.checked;
      if (inherit) picks[key] = [];
      else picks[key] = fd.getAll(key).map(String);
    }
    picks.tipos_transporte = [];
    picks.tipos_pago = [];

    const pagoAsignado = String(fd.get('pago_combustible_default') || '').trim();
    const esLegacy = pagoAsignado === LEGACY_PAGO_LABEL;
    upsertUser({
      id: fd.get('id'),
      usuario: String(fd.get('usuario')).trim(),
      password,
      nombre: String(fd.get('nombre')).trim(),
      cargo: String(fd.get('cargo') || '').trim(),
      sucursal: String(fd.get('sucursal') || '').trim(),
      pais: String(fd.get('pais') || '').trim().toUpperCase(),
      correo: String(fd.get('correo') || '').trim(),
      correo_jefe: String(fd.get('correo_jefe') || '').trim(),
      rol: fd.get('rol'),
      combustible_activo: esLegacy ? false : fd.get('combustible_activo') === 'on',
      activo: fd.get('activo') === 'on',
      transporte_default: String(fd.get('transporte_default') || '').trim(),
      pago_combustible_default: pagoAsignado,
      ...picks,
    });
    showToast(esLegacy ? 'Usuario guardado (Legacy Intelfon: sin combustible).' : 'Usuario guardado.');
    render();
  });
}

function routeAdmin(path) {
  switch (path) {
    case '/admin/config':
      renderAdminConfig();
      break;
    case '/admin/clientes':
    case '/admin/base-datos':
      renderAdminBaseDatos();
      break;
    case '/admin/solicitudes':
      renderAdminSolicitudes();
      break;
    case '/admin/catalogos':
      renderAdminCatalogos();
      break;
    case '/admin/usuarios':
      renderAdminUsuarios();
      break;
    case '/admin/historial':
      renderAdminHistorial();
      break;
    case '/admin/dashboard':
      renderDashboard();
      break;
    case '/admin':
      renderAdminHub();
      break;
    default:
      go('/admin', { replace: true, animate: false });
  }
}

function render() {
  const path = pathOf();
  const state = getState();
  const user = state.session;

  if (path === '/admin/login') {
    go(user?.rol === 'admin' ? '/admin' : '/', { replace: true, animate: false });
    return;
  }

  if (path === '/admin' || path.startsWith('/admin/')) {
    if (!user) {
      go('/', { replace: true, animate: false });
      return;
    }
    if (user.rol !== 'admin') {
      go(homeForRole(user), { replace: true, animate: false });
      return;
    }
    routeAdmin(path);
    return;
  }

  const isSellerSide = user?.rol === 'vendedor' || user?.rol === 'jefe';
  if (!user || !isSellerSide) {
    if (user?.rol === 'admin') {
      go('/admin', { replace: true, animate: false });
      return;
    }
    if (path !== '/') {
      go('/', { replace: true, animate: false });
      return;
    }
    renderLogin();
    return;
  }

  if (path === '/visita' || path.startsWith('/visita/')) {
    renderVisita();
    return;
  }

  switch (path) {
    case '/salida':
      renderSalida();
      break;
    case '/cartera':
      renderCartera();
      break;
    case '/historial':
      go('/', { replace: true, animate: false });
      break;
    case '/solicitudes':
      if (isJefe(user)) renderAdminSolicitudes('/solicitudes');
      else {
        showToast('Mis solicitudes estará disponible cuando se conecte SAN.', 'err');
        go('/', { replace: true, animate: false });
      }
      break;
    case '/citas':
      renderCitas();
      break;
    case '/dashboard':
      renderDashboard();
      break;
    case '/reintegro':
      renderReintegro();
      break;
    case '/cliente':
      go('/', { replace: true, animate: false });
      break;
    default:
      if (path !== '/') go('/', { replace: true, animate: false });
      else renderHome();
  }
}

window.addEventListener('popstate', render);

(async () => {
  app.innerHTML = `
    <div class="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
      Cargando plataforma…
    </div>
  `;
  try {
    await initStore();
  } catch (err) {
    console.error(err);
  }
  render();
})();
