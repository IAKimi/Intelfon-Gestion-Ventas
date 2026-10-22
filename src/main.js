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
  updateClientContact,
  createClientRequest,
  resolveClientRequest,
  getUserNotifications,
  markNotificationsRead,
  isCatalogoClientesActivo,
  getTeamVendedores,
  createCita,
  getCitasForUser,
  getCitaById,
  markCitaRegistrada,
  cancelCita,
} from './store.js';
import { getGps, fileToDataUrl, sendToMake } from './webhook.js';
import {
  ensureLocationAccess,
  getLocationStatus,
  hasUsableLocation,
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
  el.innerHTML = `
    <div class="gps-busy-card">
      <div class="gps-busy-spinner" aria-hidden="true"></div>
      <div class="text-sm font-black text-slate-900">${escapeHtml(message)}</div>
      <p class="mt-2 text-xs leading-relaxed text-slate-500">Espere un momento. No toque la pantalla hasta que termine.</p>
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
    if (err?.code === 'denied') {
      window.alert(
        'Sin permiso de ubicación no se pueden registrar salidas ni visitas.\n\nEn el navegador: toque el candado o la información del sitio → Permisos → Ubicación → Permitir, y luego pulse «Activar ubicación».'
      );
    }
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

async function ensureSellerLocationGate() {
  if (locationPrompted && hasUsableLocation()) return true;
  locationPrompted = true;
  showGpsBusy('Activando ubicación…');
  try {
    const result = await ensureLocationAccess();
    if (result.ok) return true;
    const err = result.error;
    window.alert(
      `${err?.message || 'Se requiere ubicación.'}\n\nSin ubicación activa no podrá registrar salidas ni visitas.`
    );
    return false;
  } finally {
    hideGpsBusy();
  }
}

async function requireGpsOrPrompt() {
  if (hasUsableLocation()) {
    showGpsBusy('Capturando GPS…');
    try {
      return await getGps({ maximumAge: 30000, timeout: 12000 });
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
  showGpsBusy('Capturando GPS…');
  try {
    return await getGps({ maximumAge: 5000, timeout: 15000 });
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

function shell(content, { title = '', showBack = false, backTo = '/' } = {}) {
  const state = getState();
  const user = state.session;
  return `
    <div class="relative min-h-screen">
      <div class="pointer-events-none absolute inset-0 overflow-hidden">
        <div class="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-red-100/70 blur-3xl animate-pulse" style="animation-duration:6s"></div>
        <div class="absolute -left-16 bottom-0 h-64 w-64 rounded-full bg-slate-200/80 blur-3xl"></div>
      </div>

      <header class="relative z-10 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div class="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-3 py-3 sm:px-4">
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

      <main class="relative z-10 mx-auto w-full max-w-3xl px-3 sm:px-4 py-5 sm:py-6 pb-24">
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

function renderSellerLogin() {
  app.innerHTML = shell(
    `
    <div class="mx-auto mt-8 max-w-md">
      <div class="mb-8 text-center">
        <img src="/logo-red.png" alt="RED" class="mx-auto mb-4 h-24 w-24 object-contain drop-shadow-sm" />
        <h1 class="text-2xl font-black tracking-tight text-slate-900">Gestión de Ventas</h1>
        <p class="mt-2 text-sm text-slate-500">Acceso para ejecutivos de campo</p>
      </div>
      <form id="login-form" class="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Usuario o correo</label>
          <input name="usuario" required autocomplete="username" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/20" placeholder="vendedor@red.com.sv" />
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
      const user = await login(String(fd.get('usuario')).trim(), fd.get('password'), 'vendedor');
      if (!user) {
        showToast('Credenciales inválidas o sin acceso de vendedor.', 'err');
        return;
      }
      locationPrompted = false;
      if (btn) btn.textContent = 'Solicitando ubicación…';
      await ensureSellerLocationGate();
      go('/', { replace: true });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Ingresar';
      }
    }
  });
}

function renderAdminLogin() {
  app.innerHTML = shell(
    `
    <div class="mx-auto mt-8 max-w-md">
      <div class="mb-8 text-center">
        <img src="/logo-red.png" alt="RED" class="mx-auto mb-4 h-24 w-24 object-contain" />
        <h1 class="text-2xl font-black tracking-tight text-slate-900">Administración</h1>
        <p class="mt-2 text-sm text-slate-500">Acceso restringido a configuración</p>
      </div>
      <form id="login-form" class="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Usuario o correo administrador</label>
          <input name="usuario" required autocomplete="username" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20" placeholder="admin@red.com.sv" />
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Contraseña</label>
          <input name="password" type="password" required autocomplete="current-password" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20" placeholder="••••••••" />
        </div>
        <button class="inline-flex w-full items-center justify-center rounded-xl bg-red-600 px-5 py-3.5 text-sm font-black uppercase tracking-tight text-white shadow-lg hover:bg-red-700">Ingresar</button>
      </form>
    </div>
    `,
    { title: 'Admin' }
  );

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button');
    if (btn) btn.disabled = true;
    try {
      const user = await login(String(fd.get('usuario')).trim(), fd.get('password'), 'admin');
      if (!user) {
        showToast('Credenciales inválidas o sin acceso de administrador.', 'err');
        return;
      }
      go('/admin', { replace: true });
    } finally {
      if (btn) btn.disabled = false;
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

function actionCard(path, title, desc, iconKey) {
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
} = {}) {
  const phoneBlock = phoneField
    ? field(phoneLabel, phoneField, {
        type: 'tel',
        placeholder: 'Ej. 7777-8888',
        required: false,
        value: phoneValue,
      })
    : '';

  if (!isCatalogoClientesActivo()) {
    return `
      ${field('Cliente', nameField, { placeholder: 'Nombre de la empresa o cliente', value: selected })}
      ${field(contactLabel, contactField, { placeholder: 'Persona de contacto', required: false, value: contactValue })}
      ${phoneBlock}
    `;
  }

  const clients = getActiveClients();
  const opts = clients
    .map(
      (c) =>
        `<option value="${escapeHtml(c.nombre)}" data-contacto="${escapeHtml(c.contacto || '')}" data-telefono="${escapeHtml(c.telefono || '')}" data-correo="${escapeHtml(c.correo_contacto || '')}" ${
          c.nombre === selected ? 'selected' : ''
        }>${escapeHtml(c.codigo ? `${c.codigo} · ` : '')}${escapeHtml(c.nombre)}</option>`
    )
    .join('');
  return `
    <div>
      <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Cliente</label>
      <select name="${nameField}" required data-client-select="${contactField}" ${
        phoneField ? `data-client-phone="${phoneField}"` : ''
      } class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-base sm:text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/20">
        <option value="">Seleccione un cliente</option>
        ${opts || '<option value="" disabled>No hay clientes cargados</option>'}
      </select>
      ${
        !clients.length
          ? `<p class="mt-1 text-[11px] text-amber-700">Catálogo activo: cargue clientes en Admin o solicite un alta.</p>`
          : ''
      }
    </div>
    ${field(contactLabel, contactField, { placeholder: 'Se completa al elegir cliente', required: false, value: contactValue })}
    ${phoneBlock}
  `;
}

function bindClientSelect(form, { autofill = true } = {}) {
  if (!autofill) return;
  form.querySelectorAll('[data-client-select]').forEach((sel) => {
    const contactName = sel.dataset.clientSelect;
    const phoneName = sel.dataset.clientPhone;
    if (!contactName) return;
    const sync = () => {
      const opt = sel.selectedOptions[0];
      const contactInput = form.querySelector(`[name="${contactName}"]`);
      if (contactInput && opt) contactInput.value = opt.dataset.contacto || '';
      if (phoneName) {
        const phoneInput = form.querySelector(`[name="${phoneName}"]`);
        if (phoneInput && opt) phoneInput.value = opt.dataset.telefono || '';
      }
    };
    sel.addEventListener('change', sync);
    sync();
  });
}

function renderHome() {
  const state = getState();
  const user = state.session;
  const combustible = resolveCombustible(user);
  const notes = getUserNotifications(user.id);
  const unread = notes.filter((n) => !n.leida).length;
  const gpsOk = hasUsableLocation();
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
          GPS ${gpsOk ? 'activo' : 'pendiente'}
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

    ${locationBannerHtml()}

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

    <div class="stagger grid grid-cols-2 gap-3 sm:gap-4 ${gpsOk ? '' : 'opacity-60'}">
      ${actionCard('/salida', 'Registro de salida', 'Punto de partida y destino.', 'salida')}
      ${actionCard(
        '/visita',
        'Reporte de visita',
        pendingVisitas
          ? `${pendingVisitas} pendiente${pendingVisitas > 1 ? 's' : ''} por reportar.`
          : 'Elija una salida pendiente.',
        'visita'
      )}
      ${actionCard('/cartera', 'Mi cartera', 'Sus clientes y contactos.', 'usuarios')}
      ${user.es_jefe ? actionCard('/citas', 'Programar citas', 'Agende visitas a su equipo.', 'salida') : ''}
      ${user.es_jefe ? actionCard('/dashboard', 'Dashboard', 'Visitas y pendientes de su equipo.', 'solicitudes') : ''}
      ${user.es_jefe ? actionCard('/historial', 'Historial de equipo', 'Cambios de contacto de su equipo.', 'solicitudes') : ''}
      ${combustible ? actionCard('/reintegro', 'Reintegro', 'Solicitud del periodo.', 'reintegro') : ''}
      ${
        isCatalogoClientesActivo()
          ? actionCard('/cliente', 'Registrar cliente', 'Solicitud con aprobación.', 'cliente')
          : ''
      }
    </div>
    ${(() => {
      const citas = getCitasForUser(user.id)
        .filter((c) => c.estado === 'programada')
        .sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`));
      if (!citas.length) return '';
      return `
      <section class="mt-5 rounded-2xl border border-red-100 bg-white p-4 shadow-sm">
        <h3 class="text-xs font-black uppercase tracking-wider text-slate-900">Citas programadas para usted</h3>
        <div class="mt-3 space-y-2">
          ${citas
            .map(
              (c) => `
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
              <div class="min-w-0">
                <div class="text-sm font-bold text-slate-900">${escapeHtml(c.clienteNombre)}</div>
                <p class="text-[11px] text-slate-500">${escapeHtml(c.fecha)}${c.hora ? ` · ${escapeHtml(c.hora)}` : ''} · Programada por ${escapeHtml(c.creadoPorNombre)}</p>
              </div>
              <button data-cita-salida="${c.id}" class="shrink-0 rounded-xl bg-red-600 px-3.5 py-2 text-xs font-black uppercase tracking-tight text-white hover:bg-red-700">Registrar salida</button>
            </div>`
            )
            .join('')}
        </div>
      </section>`;
    })()}
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
  document.querySelectorAll('[data-cita-salida]').forEach((btn) => {
    btn.addEventListener('click', () => go(`/salida?cita=${encodeURIComponent(btn.dataset.citaSalida)}`));
  });

  const panel = document.getElementById('notes-panel');
  document.getElementById('btn-notes')?.addEventListener('click', () => {
    panel.classList.toggle('hidden');
    markNotificationsRead(user.id);
  });
  document.getElementById('btn-notes-close')?.addEventListener('click', () => {
    panel.classList.add('hidden');
  });

  if (!locationPrompted) {
    locationPrompted = true;
    void ensureLocationAccess().then((result) => {
      if (!result.ok && result.error) {
        showToast(result.error.message, 'err', {
          actionLabel: 'Activar ubicación',
          onAction: async () => {
            const ok = await requestLocationFromUi();
            if (ok) render();
          },
          duration: 10000,
        });
      } else if (result.ok) {
        render();
      }
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

function renderSalida() {
  const { fecha, hora } = nowParts();
  const user = getState().session;
  const tipos = resolveOptions(user, 'tipos_salida');
  const citaId = new URLSearchParams(location.search).get('cita') || '';
  const citaRaw = citaId ? getCitaById(citaId) : null;
  const cita =
    citaRaw && citaRaw.vendedorId === user.id && citaRaw.estado === 'programada' ? citaRaw : null;

  app.innerHTML = shell(
    `
    <form id="form-salida" class="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      ${locationBannerHtml()}
      <div class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        Al pulsar <strong>Registrar salida</strong>, se capturará su <strong>GPS en tiempo real</strong> como punto A.
      </div>
      ${
        cita
          ? `<div class="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">Cita programada por <strong>${escapeHtml(cita.creadoPorNombre)}</strong>. Los datos del cliente ya vienen cargados.</div>`
          : ''
      }
      <div class="grid gap-4 sm:grid-cols-2">
        ${field('Fecha', 'fecha_registro_salida', { type: 'date', value: cita?.fecha || fecha })}
        ${field('Hora', 'hora_registro_salida', { type: 'time', value: cita?.hora || hora })}
      </div>
      ${clientFieldsHtml({
        nameField: 'cliente_registro_salida',
        contactField: 'contacto_registro_salida',
        phoneField: 'telefono_registro_salida',
        selected: cita?.clienteNombre || '',
        contactValue: cita?.contacto || '',
        phoneValue: cita?.telefono || '',
      })}
      ${field('Tipo de salida', 'tipo_registro_salida', {
        type: 'select',
        required: tipos.length > 0,
        value: optionsHtml(tipos),
      })}
      ${field('Punto de referencia', 'punto_referencia', { placeholder: 'Referencia del destino' })}
      ${field('Objetivo de la visita', 'objetivo_registro_salida', { type: 'textarea', placeholder: '¿Qué se busca lograr?', value: cita?.objetivo || '' })}
      <button id="submit-btn" class="inline-flex w-full items-center justify-center rounded-xl bg-red-600 px-5 py-3.5 text-sm font-black uppercase tracking-tight text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-red-700">Registrar salida</button>
    </form>
    `,
    { title: 'Registro de salida', showBack: true, backTo: '/' }
  );
  bindShell('/');
  bindGpsBanner();
  // El contacto solo se precarga cuando la salida nace de una cita programada.
  bindClientSelect(document.getElementById('form-salida'), { autofill: Boolean(cita) });
  bindFormSubmit('form-salida', async (data, btn) => {
    const session = getState().session;
    btn.textContent = 'Obteniendo GPS…';
    const gps = await requireGpsOrPrompt();
    btn.textContent = 'Enviando…';
    const result = await sendToMake({
      formulario: 'registro_salidas',
      ...data,
      latitud_registro_salidas: gps.latitud,
      longitud_registro_salidas: gps.longitud,
      gps_accuracy_salida: gps.accuracy,
    });
    const { salida } = createPendingSalida(
      {
        ...data,
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
  const fechaReporte = salida.fecha_registro_salida || '';

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
        <p class="text-[11px] leading-relaxed text-slate-400">La fecha debe coincidir con el día de la salida. Solo puede ajustar la hora del reporte.</p>
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
          <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Evidencia fotográfica <span class="font-semibold normal-case tracking-normal text-slate-400">(opcional)</span></label>
          <input name="foto" type="file" accept="image/*" capture="environment" class="w-full rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm" />
          <p class="mt-1.5 text-[11px] leading-relaxed text-slate-400">Si no adjunta imagen, el reporte se envía sin evidencia.</p>
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
    btn.textContent = 'Obteniendo GPS…';
    const gps = await requireGpsOrPrompt();
    const file = form.querySelector('input[name="foto"]').files?.[0] || null;
    let foto = null;
    if (file) {
      btn.textContent = 'Procesando imagen…';
      foto = await fileToDataUrl(file);
    }
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
      fecha_reporte_visitas: current.fecha_registro_salida,
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
      galeria_fotos_reporte_visitas: foto,
    });
    markSalidaVisitada(salidaId);
    showToast(`${result.message} GPS visita: ${gps.latitud}, ${gps.longitud}`);
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
  const team = getTeamVendedores(user);
  const { fecha, hora } = nowParts();
  const citas = (getState().citas || [])
    .filter((c) => c.creadoPorId === user.id || team.some((t) => t.id === c.vendedorId))
    .sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`));

  app.innerHTML = shell(
    `
    <form id="form-cita" class="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p class="text-sm text-slate-500">La cita le llegará al vendedor con el contacto ya cargado.</p>
      <div class="grid gap-4 sm:grid-cols-2">
        ${field('Vendedor', 'vendedorId', {
          type: 'select',
          value: `<option value="">Seleccione…</option>${team.map((t) => `<option value="${t.id}">${escapeHtml(t.nombre)} (${escapeHtml(t.pais || '')})</option>`).join('')}`,
        })}
        <div>
          <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Cliente</label>
          <select name="clienteId" required class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-base sm:text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/20">
            <option value="">Primero elija vendedor</option>
          </select>
        </div>
        ${field('Nombre de contacto', 'contacto', { required: false, placeholder: 'Se completa al elegir cliente' })}
        ${field('Teléfono', 'telefono', { type: 'tel', required: false, placeholder: 'Ej. 7777-8888' })}
        ${field('Fecha', 'fecha', { type: 'date', value: fecha })}
        ${field('Hora', 'hora', { type: 'time', value: hora })}
      </div>
      ${field('Objetivo de la visita', 'objetivo', { type: 'textarea', required: false, placeholder: '¿Qué se busca lograr?' })}
      <button id="submit-btn" class="inline-flex w-full items-center justify-center rounded-xl bg-red-600 px-5 py-3.5 text-sm font-black uppercase tracking-tight text-white shadow-lg hover:bg-red-700">Programar cita</button>
    </form>

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
                <div class="text-sm font-bold text-slate-900">${escapeHtml(c.clienteNombre)} · ${escapeHtml(c.vendedorNombre)}</div>
                <p class="text-[11px] text-slate-500">${escapeHtml(c.fecha)}${c.hora ? ` · ${escapeHtml(c.hora)}` : ''} · ${escapeHtml(c.estado)}</p>
              </div>
              ${c.estado === 'programada' ? `<button data-cancel-cita="${c.id}" class="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600">Cancelar</button>` : ''}
            </div>`
                )
                .join('')
            : '<p class="text-sm text-slate-400">Aún no ha programado citas.</p>'
        }
      </div>
    </section>
    `,
    { title: 'Programar citas', showBack: true, backTo: '/' }
  );
  bindShell('/');
  const form = document.getElementById('form-cita');
  const vendedorSel = form.querySelector('[name="vendedorId"]');
  const clienteSel = form.querySelector('[name="clienteId"]');
  const fillClientes = () => {
    const clientes = getClientsByVendedor(vendedorSel.value);
    clienteSel.innerHTML =
      '<option value="">Seleccione un cliente</option>' +
      clientes
        .map(
          (c) =>
            `<option value="${c.id}" data-nombre="${escapeHtml(c.nombre)}" data-contacto="${escapeHtml(c.contacto || '')}" data-telefono="${escapeHtml(c.telefono || '')}">${escapeHtml(c.codigo ? `${c.codigo} · ` : '')}${escapeHtml(c.nombre)}</option>`
        )
        .join('');
  };
  vendedorSel.addEventListener('change', fillClientes);
  clienteSel.addEventListener('change', () => {
    const opt = clienteSel.selectedOptions[0];
    if (!opt) return;
    form.querySelector('[name="contacto"]').value = opt.dataset.contacto || '';
    form.querySelector('[name="telefono"]').value = opt.dataset.telefono || '';
  });
  document.querySelectorAll('[data-cancel-cita]').forEach((btn) => {
    btn.addEventListener('click', () => {
      cancelCita(btn.dataset.cancelCita);
      showToast('Cita cancelada.');
      render();
    });
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const opt = clienteSel.selectedOptions[0];
    if (!opt?.value) {
      showToast('Elija un cliente.', 'err');
      return;
    }
    createCita(
      {
        vendedorId: String(fd.get('vendedorId') || ''),
        clienteId: opt.value,
        clienteNombre: opt.dataset.nombre || '',
        contacto: String(fd.get('contacto') || ''),
        telefono: String(fd.get('telefono') || ''),
        fecha: String(fd.get('fecha') || ''),
        hora: String(fd.get('hora') || ''),
        objetivo: String(fd.get('objetivo') || ''),
      },
      user
    );
    showToast('Cita programada. El vendedor ya la puede ver.');
    render();
  });
}

function renderDashboard() {
  const user = getState().session;
  const isAdmin = user.rol === 'admin';
  const ejecutivos = isAdmin ? getEjecutivos() : getTeamVendedores(user);
  const state = getState();
  const rows = ejecutivos.map((u) => {
    const salidas = (state.salidas || []).filter((s) => s.vendedorId === u.id);
    const visitadas = salidas.filter((s) => s.estado === 'visitada').length;
    return {
      nombre: u.nombre,
      pais: u.pais || '',
      clientes: getClientsByVendedor(u.id).length,
      salidas: salidas.length,
      visitadas,
      pendientes: salidas.length - visitadas,
      citas: getCitasForUser(u.id).filter((c) => c.estado === 'programada').length,
    };
  });
  const tot = rows.reduce(
    (a, r) => ({
      salidas: a.salidas + r.salidas,
      visitadas: a.visitadas + r.visitadas,
      pendientes: a.pendientes + r.pendientes,
    }),
    { salidas: 0, visitadas: 0, pendientes: 0 }
  );
  const card = (label, value) => `
    <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400">${label}</div>
      <div class="mt-1 text-2xl font-black text-slate-900">${value}</div>
    </div>`;

  app.innerHTML = shell(
    `
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      ${card('Ejecutivos', rows.length)}
      ${card('Salidas registradas', tot.salidas)}
      ${card('Visitas reportadas', tot.visitadas)}
      ${card('Pendientes', tot.pendientes)}
    </div>
    <section class="mt-5 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table class="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr class="border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400">
            <th class="px-4 py-3 font-bold">Ejecutivo</th>
            <th class="px-4 py-3 font-bold">País</th>
            <th class="px-4 py-3 font-bold">Clientes</th>
            <th class="px-4 py-3 font-bold">Salidas</th>
            <th class="px-4 py-3 font-bold">Reportadas</th>
            <th class="px-4 py-3 font-bold">Pendientes</th>
            <th class="px-4 py-3 font-bold">Citas prog.</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map(
                    (r) => `
            <tr class="border-b border-slate-50">
              <td class="px-4 py-3 font-semibold text-slate-900">${escapeHtml(r.nombre)}</td>
              <td class="px-4 py-3 text-slate-600">${escapeHtml(r.pais || '—')}</td>
              <td class="px-4 py-3 text-slate-600">${r.clientes}</td>
              <td class="px-4 py-3 text-slate-600">${r.salidas}</td>
              <td class="px-4 py-3 text-emerald-700 font-semibold">${r.visitadas}</td>
              <td class="px-4 py-3 ${r.pendientes ? 'text-amber-700 font-semibold' : 'text-slate-600'}">${r.pendientes}</td>
              <td class="px-4 py-3 text-slate-600">${r.citas}</td>
            </tr>`
                  )
                  .join('')
              : '<tr><td colspan="7" class="px-4 py-6 text-center text-slate-400">Sin ejecutivos en el alcance.</td></tr>'
          }
        </tbody>
      </table>
    </section>
    <p class="mt-3 text-[11px] text-slate-400">Los kilómetros por ejecutivo se calculan en Make y quedan en Sheets (columnas O y P de Reporte de Visitas).</p>
    `,
    { title: 'Dashboard', showBack: true, backTo: isAdmin ? '/admin' : '/' }
  );
  if (isAdmin) bindAdminSubShell();
  else bindShell('/');
}

function renderCartera() {
  const user = getState().session;
  const params = new URLSearchParams(location.search);
  const q = (params.get('q') || '').toLowerCase();
  const editId = params.get('edit') || '';
  let clients = getActiveClients(user);
  if (q) {
    clients = clients.filter((c) =>
      `${c.nombre} ${c.codigo} ${c.contacto} ${c.telefono}`.toLowerCase().includes(q)
    );
  }
  const editing = editId ? clients.find((c) => c.id === editId) : null;

  app.innerHTML = shell(
    `
    <div class="mb-4">
      <p class="text-xs font-bold uppercase tracking-[0.2em] text-red-600">Mi cartera</p>
      <h2 class="mt-1 text-xl font-black text-slate-900">${clients.length} cliente${clients.length === 1 ? '' : 's'}</h2>
      <p class="mt-1 text-sm text-slate-500">Actualice los datos de contacto de sus clientes. Cada cambio queda registrado.</p>
    </div>
    <form id="form-buscar-cartera" class="mb-3 flex gap-2">
      <input name="q" value="${escapeHtml(params.get('q') || '')}" placeholder="Buscar cliente, código o contacto" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-red-500" />
      <button class="rounded-xl bg-slate-900 px-4 py-3 text-xs font-black uppercase text-white">Buscar</button>
    </form>
    ${
      editing
        ? `<section class="mb-4 rounded-2xl border border-red-100 bg-red-50/40 p-5">
      <h3 class="text-sm font-black text-slate-900">${escapeHtml(editing.nombre)}</h3>
      <p class="mt-0.5 text-xs text-slate-500">${escapeHtml(editing.codigo || '')} ${editing.pais ? `· ${escapeHtml(editing.pais)}` : ''}</p>
      <form id="form-contacto" class="mt-3 grid gap-3 sm:grid-cols-2">
        ${field('Contacto', 'contacto', { required: false, value: editing.contacto || '' })}
        ${field('Teléfono', 'telefono', { required: false, type: 'tel', value: editing.telefono || '' })}
        ${field('Teléfono fijo', 'telefono_fijo', { required: false, type: 'tel', value: editing.telefono_fijo || '' })}
        ${field('Correo contacto', 'correo_contacto', { required: false, type: 'email', value: editing.correo_contacto || '' })}
        <div class="flex gap-2 sm:col-span-2">
          <button class="flex-1 rounded-xl bg-red-600 px-5 py-3 text-sm font-black uppercase text-white hover:bg-red-700">Guardar</button>
          <button type="button" id="btn-cancel-contacto" class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600">Cancelar</button>
        </div>
      </form>
    </section>`
        : ''
    }
    <div class="space-y-2">
      ${
        clients.length
          ? clients
              .map(
                (c) => `
        <div class="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-black text-slate-900">${escapeHtml(c.nombre)}</div>
            <div class="mt-0.5 truncate text-xs text-slate-500">${escapeHtml(c.codigo || 'Sin código')}${c.contacto ? ` · ${escapeHtml(c.contacto)}` : ' · Sin contacto'}${c.telefono ? ` · ${escapeHtml(c.telefono)}` : ''}</div>
          </div>
          <button data-edit-contact="${c.id}" class="shrink-0 text-xs font-bold text-red-600 hover:underline">Editar</button>
        </div>`
              )
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
  document.querySelectorAll('[data-edit-contact]').forEach((btn) => {
    btn.addEventListener('click', () => go(`/cartera?edit=${encodeURIComponent(btn.dataset.editContact)}`));
  });
  document.getElementById('btn-cancel-contacto')?.addEventListener('click', () => go('/cartera'));
  document.getElementById('form-contacto')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const { changed } = updateClientContact(
      editing.id,
      {
        contacto: fd.get('contacto'),
        telefono: fd.get('telefono'),
        telefono_fijo: fd.get('telefono_fijo'),
        correo_contacto: fd.get('correo_contacto'),
      },
      getState().session
    );
    showToast(changed ? 'Contacto actualizado y registrado.' : 'Sin cambios.');
    go('/cartera');
  });
}

function renderRegistrarCliente() {
  const user = getState().session;
  const mine = getState().clientRequests.filter((r) => r.vendedorId === user.id).slice(0, 8);

  app.innerHTML = shell(
    `
    <form id="form-cliente" class="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        La solicitud se envía a <strong>Ventas</strong> para aprobación. Solo si es aprobada, el cliente entra a la lista usable en salidas y visitas.
      </div>
      ${field('Nombre (empresa o cliente)', 'nombre', { placeholder: 'Ej. Distribuidora ABC' })}
      ${field('Nombre de contacto', 'contacto', { placeholder: 'Persona de contacto', required: false })}
      ${field('Teléfono', 'telefono', { type: 'tel', placeholder: 'Ej. 7777-8888', required: false })}
      ${field('Notas / justificación', 'notas', { type: 'textarea', required: false, placeholder: 'Por qué solicita el alta' })}
      <button id="submit-btn" class="inline-flex w-full items-center justify-center rounded-xl bg-red-600 px-5 py-3.5 text-sm font-black uppercase tracking-tight text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-red-700">Solicitar registro</button>
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
    { title: 'Registrar cliente', showBack: true, backTo: '/' }
  );
  bindShell('/');
  bindFormSubmit('form-cliente', async (data, btn) => {
    const session = getState().session;
    btn.textContent = 'Enviando…';
    const { request } = createClientRequest(data, session);
    const state = getState();
    const result = await sendToMake({
      formulario: 'solicitud_cliente',
      request_id: request.id,
      nombre_cliente: request.nombre,
      contacto_cliente: request.contacto,
      telefono_cliente: request.telefono || '',
      notas_solicitud: request.notas,
      correo_ventas: state.correo_ventas,
      accion: 'pendiente_aprobacion',
    });
    showToast(result.message || 'Solicitud enviada a Ventas.');
    go('/cliente');
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
  bindShell('/admin/login');
}

function bindAdminSubShell() {
  bindShell('/admin/login');
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

  const tab = (id, label) => {
    const active = view === id;
    const href =
      id === 'clientes' && filterVend
        ? `/admin/base-datos?view=clientes&vendedor=${encodeURIComponent(filterVend)}`
        : `/admin/base-datos?view=${id}`;
    return `<a href="${href}" data-nav class="rounded-full px-3 py-1.5 text-xs font-bold ${
      active ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600'
    }">${label}</a>`;
  };

  const sellerOpts = ejecutivos
    .map(
      (u) =>
        `<option value="${escapeHtml(u.id)}" ${u.id === filterVend ? 'selected' : ''}>${escapeHtml(
          `${u.pais ? `[${u.pais}] ` : ''}${u.nombre}`
        )}</option>`
    )
    .join('');

  app.innerHTML = shell(
    `
    <div class="mb-4">
      <h3 class="text-sm font-black uppercase tracking-wider text-slate-900">Base de datos · ${view === 'ejecutivos' ? 'Ejecutivos' : view === 'clientes' ? 'Clientes' : 'Importar'}</h3>
      <p class="mt-1 text-xs text-slate-500">Ejecutivos, carteras e importación masiva (SV / GT).</p>
      <button data-nav="/admin/base-datos" class="mt-2 text-xs font-bold text-red-600 hover:underline">← Cambiar sección</button>
    </div>

    ${
      view === 'importar'
        ? `
    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h4 class="text-sm font-black text-slate-900">Importar Excel</h4>
      <p class="mt-1 text-xs text-slate-500">Columnas A–H: País, Código, Cliente, Ejecutivo, GG Nombre/Tel/Celular/Correo. Crea perfiles stub y asigna cartera. Omite Intelfon Guatemala.</p>
      <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input id="file-clients" type="file" accept=".csv,.xlsx,.xls" class="w-full flex-1 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm" />
        <button id="btn-import-clients" class="rounded-xl bg-slate-900 px-4 py-3 text-xs font-black uppercase tracking-tight text-white hover:bg-slate-800">Importar</button>
      </div>
      <p id="import-status" class="mt-2 text-xs text-slate-500"></p>
      <p class="mt-3 text-[11px] text-slate-400">Los ejecutivos nuevos nacen con clave temporal: asigne correos y claves en Usuarios.</p>
    </section>`
        : ''
    }

    ${
      view === 'ejecutivos'
        ? `
    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div class="flex-1">
          <label class="mb-1 block text-[11px] font-bold uppercase text-slate-400">Buscar</label>
          <input id="filter-eq" value="${escapeHtml(params.get('eq') || '')}" placeholder="Nombre, usuario o correo" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
        </div>
        <div>
          <label class="mb-1 block text-[11px] font-bold uppercase text-slate-400">País</label>
          <select id="filter-epais" class="rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
            <option value="">Todos</option>
            <option value="SV" ${ePais === 'SV' ? 'selected' : ''}>El Salvador</option>
            <option value="GT" ${ePais === 'GT' ? 'selected' : ''}>Guatemala</option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-[11px] font-bold uppercase text-slate-400">Orden</label>
          <select id="filter-orden" class="rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
            <option value="nombre" ${eOrden === 'nombre' ? 'selected' : ''}>Por nombre</option>
            <option value="mas" ${eOrden === 'mas' ? 'selected' : ''}>Más clientes</option>
            <option value="menos" ${eOrden === 'menos' ? 'selected' : ''}>Menos clientes</option>
          </select>
        </div>
      </div>
      <p class="mb-2 text-xs text-slate-500">${ejecutivos.length} ejecutivo${ejecutivos.length === 1 ? '' : 's'}</p>
      <div class="max-h-[32rem] overflow-y-auto">
        <table class="min-w-full text-left text-sm">
          <thead class="sticky top-0 bg-slate-50 text-xs uppercase tracking-wider text-slate-400">
            <tr>
              <th class="px-3 py-2">País</th>
              <th class="px-3 py-2">Ejecutivo</th>
              <th class="px-3 py-2">Usuario</th>
              <th class="px-3 py-2">Clientes</th>
              <th class="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            ${
              ejecutivos.length
                ? ejecutivos
                    .map((u) => {
                      const n = u._clientes;
                      return `
              <tr class="border-t border-slate-100">
                <td class="px-3 py-2 font-bold text-slate-700">${escapeHtml(u.pais || '—')}</td>
                <td class="px-3 py-2 font-semibold text-slate-900">${escapeHtml(u.nombre)}</td>
                <td class="px-3 py-2 text-slate-500">${escapeHtml(u.usuario)}${u.correo ? '' : ' · sin correo'}</td>
                <td class="px-3 py-2 text-slate-700">${n}</td>
                <td class="px-3 py-2 text-right">
                  <a href="/admin/base-datos?view=clientes&vendedor=${encodeURIComponent(u.id)}" data-nav class="text-xs font-bold text-red-600 hover:underline">Cartera</a>
                </td>
              </tr>`;
                    })
                    .join('')
                : '<tr><td colspan="5" class="px-3 py-4 text-slate-400">Sin ejecutivos. Importe el Excel.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </section>`
        : ''
    }

    ${
      view === 'clientes'
        ? `
    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
          <select id="filter-pais" class="rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
            <option value="">Todos</option>
            <option value="SV" ${filterPais === 'SV' ? 'selected' : ''}>SV</option>
            <option value="GT" ${filterPais === 'GT' ? 'selected' : ''}>GT</option>
          </select>
        </div>
        <button id="btn-new-client" class="rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-700 hover:border-red-200 hover:text-red-600">+ Cliente</button>
      </div>
      <p class="mb-2 text-xs text-slate-500">${clients.length} cliente${clients.length === 1 ? '' : 's'}</p>
      <div class="max-h-[28rem] overflow-y-auto rounded-xl border border-slate-100">
        <table class="min-w-full text-left text-sm">
          <thead class="sticky top-0 bg-slate-50 text-xs uppercase tracking-wider text-slate-400">
            <tr>
              <th class="px-3 py-2">País</th>
              <th class="px-3 py-2">Código</th>
              <th class="px-3 py-2">Cliente</th>
              <th class="px-3 py-2">Contacto</th>
              <th class="px-3 py-2">Tel</th>
              <th class="px-3 py-2">Ejecutivo</th>
              <th class="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            ${
              clients.length
                ? clients
                    .map(
                      (c) => `
              <tr class="border-t border-slate-100">
                <td class="px-3 py-2">${escapeHtml(c.pais || '—')}</td>
                <td class="px-3 py-2 text-slate-500">${escapeHtml(c.codigo || '—')}</td>
                <td class="px-3 py-2 font-semibold text-slate-900">${escapeHtml(c.nombre)}</td>
                <td class="px-3 py-2 text-slate-600">${escapeHtml(c.contacto || '—')}</td>
                <td class="px-3 py-2 text-slate-600">${escapeHtml(c.telefono || '—')}</td>
                <td class="px-3 py-2 text-slate-600">${escapeHtml(c.vendedorNombre || '—')}</td>
                <td class="px-3 py-2 text-right whitespace-nowrap">
                  <button data-edit-client="${c.id}" class="text-xs font-bold text-red-600 hover:underline">Editar</button>
                  <button data-del-client="${c.id}" class="ml-2 text-xs font-bold text-slate-400 hover:text-red-600">Eliminar</button>
                </td>
              </tr>`
                    )
                    .join('')
                : '<tr><td colspan="7" class="px-3 py-4 text-slate-400">Sin clientes.</td></tr>'
            }
          </tbody>
        </table>
      </div>
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
    status.textContent = 'Procesando archivo…';
    try {
      const { rows, omitted } = await parseClientFile(file);
      const result = importClients(rows, { omittedFile: omitted });
      showToast(
        `Listo: ${result.added} nuevos, ${result.updated} actualizados, ${result.usersCreated} ejecutivos, ${result.skipped} omitidos.`
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

function renderAdminSolicitudes() {
  const state = getState();
  const pendingReqs = state.clientRequests.filter((r) => r.estado === 'pendiente');
  app.innerHTML = shell(
    `
    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 class="text-sm font-black uppercase tracking-wider text-slate-900">Solicitudes</h3>
      <p class="mt-1 text-xs text-slate-500">Apruebe o rechace altas pedidas por vendedores.</p>
      <div class="mt-4 space-y-3">
        ${
          pendingReqs.length
            ? pendingReqs
                .map(
                  (r) => `
          <div class="rounded-xl border border-amber-200 bg-amber-50/40 p-3">
            <div class="text-sm font-black text-slate-900">${escapeHtml(r.nombre)}</div>
            <div class="mt-0.5 text-xs text-slate-600">Contacto: ${escapeHtml(r.contacto || '—')}${r.telefono ? ` · Tel: ${escapeHtml(r.telefono)}` : ''} · Solicitó: ${escapeHtml(r.vendedorNombre)}</div>
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
    { title: 'Solicitudes', showBack: true, backTo: '/admin' }
  );
  bindAdminSubShell();
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
  const usersRows = visibleUsers
    .map(
      (u) => `
      <tr class="border-t border-slate-100">
        <td class="px-3 py-3 text-sm font-semibold text-slate-900">${escapeHtml(u.usuario)}</td>
        <td class="px-3 py-3 text-sm text-slate-600">${escapeHtml(u.nombre)} <span class="ml-1 rounded-full ${u.activo !== false ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'} px-2 py-0.5 text-[10px] font-bold">${u.activo !== false ? 'Activo' : 'Inactivo'}</span></td>
        <td class="px-3 py-3 text-sm text-slate-600">${escapeHtml(u.correo || '—')}</td>
        <td class="px-3 py-3 text-sm text-slate-600">${escapeHtml(u.correo_jefe || '—')}</td>
        <td class="px-3 py-3 text-sm capitalize">${escapeHtml(u.rol)}</td>
        <td class="px-3 py-3">
          ${iosSwitch('combustible_row', u.combustible_activo, {
            dataAttr: `data-toggle-fuel="${u.id}"`,
          })}
        </td>
        <td class="px-3 py-3 text-right whitespace-nowrap">
          <button data-edit="${u.id}" class="text-xs font-bold text-red-600 hover:underline">Editar</button>
          <button data-reset="${u.id}" class="ml-2 text-xs font-bold text-slate-600 hover:text-red-600 hover:underline">Restablecer clave</button>
          ${
            u.rol === 'vendedor'
              ? `<button data-cartera="${u.id}" class="ml-2 text-xs font-bold text-slate-600 hover:text-red-600 hover:underline">Cartera</button>`
              : ''
          }
          ${
            u.usuario !== 'admin'
              ? `<button data-del="${u.id}" class="ml-2 text-xs font-bold text-slate-400 hover:text-red-600">Eliminar</button>`
              : ''
          }
        </td>
      </tr>`
    )
    .join('');

  app.innerHTML = shell(
    `
    <div class="space-y-5">
      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-black uppercase tracking-wider text-slate-900">Usuarios</h3>
            <p class="mt-1 text-xs text-slate-500">Perfiles, roles y opciones heredadas de catálogos.</p>
          </div>
          <button id="btn-new-user" class="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:border-red-200 hover:text-red-600">+ Nuevo</button>
        </div>
        <div class="mb-4 grid grid-cols-2 gap-3">
          <button data-nav="/admin/usuarios?pais=GT" class="card-lift rounded-2xl border ${paisSel === 'GT' ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'} p-4 text-left shadow-sm">
            <div class="text-sm font-black text-slate-900">Guatemala</div>
            <p class="mt-1 text-xs text-slate-500">${countPais('GT')} usuario${countPais('GT') === 1 ? '' : 's'}</p>
          </button>
          <button data-nav="/admin/usuarios?pais=SV" class="card-lift rounded-2xl border ${paisSel === 'SV' ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'} p-4 text-left shadow-sm">
            <div class="text-sm font-black text-slate-900">El Salvador</div>
            <p class="mt-1 text-xs text-slate-500">${countPais('SV')} usuario${countPais('SV') === 1 ? '' : 's'}</p>
          </button>
        </div>
        ${sinPais ? `<button data-nav="/admin/usuarios?pais=XX" class="mb-3 text-xs font-bold ${paisSel === 'XX' ? 'text-red-600' : 'text-slate-400'} hover:underline">${sinPais} usuario${sinPais === 1 ? '' : 's'} sin país asignado</button>` : ''}
        <p class="mb-2 text-xs font-semibold text-slate-700">${paisSel === 'GT' ? 'Guatemala' : paisSel === 'SV' ? 'El Salvador' : 'Sin país'} · ${visibleUsers.length} usuario${visibleUsers.length === 1 ? '' : 's'}</p>
        <div class="overflow-x-auto">
          <table class="min-w-full text-left">
            <thead class="text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th class="px-3 py-2">Usuario</th>
                <th class="px-3 py-2">Nombre</th>
                <th class="px-3 py-2">Correo</th>
                <th class="px-3 py-2">Correo jefe</th>
                <th class="px-3 py-2">Rol</th>
                <th class="px-3 py-2">Combustible</th>
                <th class="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>${usersRows || '<tr><td colspan="7" class="px-3 py-4 text-sm text-slate-400">Sin usuarios en este país.</td></tr>'}</tbody>
          </table>
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
            value: `<option value="vendedor">Vendedor</option><option value="admin">Admin</option>`,
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
    { title: 'Usuarios', showBack: true, backTo: '/admin' }
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
      combustible_activo: fd.get('combustible_activo') === 'on',
      activo: fd.get('activo') === 'on',
      transporte_default: String(fd.get('transporte_default') || '').trim(),
      pago_combustible_default: String(fd.get('pago_combustible_default') || '').trim(),
      ...picks,
    });
    showToast('Usuario guardado.');
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
    if (user?.rol === 'admin') {
      go('/admin', { replace: true, animate: false });
      return;
    }
    if (user?.rol === 'vendedor') void logout();
    renderAdminLogin();
    return;
  }

  if (path === '/admin' || path.startsWith('/admin/')) {
    if (!user) {
      go('/admin/login', { replace: true, animate: false });
      return;
    }
    if (user.rol !== 'admin') {
      void logout();
      go('/admin/login', { replace: true, animate: false });
      return;
    }
    routeAdmin(path);
    return;
  }

  if (!user || user.rol !== 'vendedor') {
    if (user?.rol === 'admin') {
      go('/admin', { replace: true, animate: false });
      return;
    }
    if (path !== '/') {
      go('/', { replace: true, animate: false });
      return;
    }
    renderSellerLogin();
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
      if (!user.es_jefe) {
        go('/', { replace: true, animate: false });
        return;
      }
      renderAdminHistorial('/historial');
      break;
    case '/citas':
      if (!user.es_jefe) {
        go('/', { replace: true, animate: false });
        return;
      }
      renderCitas();
      break;
    case '/dashboard':
      if (!user.es_jefe) {
        go('/', { replace: true, animate: false });
        return;
      }
      renderDashboard();
      break;
    case '/reintegro':
      renderReintegro();
      break;
    case '/cliente':
      if (!isCatalogoClientesActivo()) {
        go('/', { replace: true, animate: false });
        return;
      }
      renderRegistrarCliente();
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
