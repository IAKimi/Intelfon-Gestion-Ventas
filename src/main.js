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
  saveLastSalida,
  getLastSalida,
  resolveOptions,
  upsertCatalogItem,
  setCatalogItemActive,
  deleteCatalogItem,
  CATALOG_META,
  getActiveClients,
  importClients,
  deleteClient,
  createClientRequest,
  resolveClientRequest,
  getUserNotifications,
  markNotificationsRead,
  isCatalogoClientesActivo,
} from './store.js';
import { getGps, fileToDataUrl, sendToMake } from './webhook.js';
import { parseClientFile } from './clients-import.js';

const app = document.getElementById('app');
let toastTimer = null;
let navToken = 0;

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

function showToast(message, type = 'ok') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.className = `toast fixed bottom-5 left-1/2 z-50 max-w-sm -translate-x-1/2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-xl ${
    type === 'ok' ? 'bg-slate-900' : 'bg-red-600'
  }`;
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3600);
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
        <p class="text-center text-[11px] text-slate-400">Acceso: <span class="font-semibold">vendedor@red.com.sv</span></p>
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
      go('/', { replace: true });
    } finally {
      if (btn) btn.disabled = false;
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
        <p class="text-center text-[11px] text-slate-400">Acceso: <span class="font-semibold">admin@red.com.sv</span></p>
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
  selected = '',
  contactValue = '',
  contactLabel = 'Contacto',
} = {}) {
  if (!isCatalogoClientesActivo()) {
    return `
      ${field('Cliente', nameField, { placeholder: 'Nombre de la empresa o cliente', value: selected })}
      ${field(contactLabel, contactField, { placeholder: 'Persona de contacto', required: false, value: contactValue })}
    `;
  }

  const clients = getActiveClients();
  const opts = clients
    .map(
      (c) =>
        `<option value="${escapeHtml(c.nombre)}" data-contacto="${escapeHtml(c.contacto || '')}" ${
          c.nombre === selected ? 'selected' : ''
        }>${escapeHtml(c.nombre)}</option>`
    )
    .join('');
  return `
    <div>
      <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Cliente</label>
      <select name="${nameField}" required data-client-select="${contactField}" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/20">
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
  `;
}

function bindClientSelect(form) {
  form.querySelectorAll('[data-client-select]').forEach((sel) => {
    const contactName = sel.dataset.clientSelect;
    if (!contactName) return;
    const sync = () => {
      const opt = sel.selectedOptions[0];
      const contactInput = form.querySelector(`[name="${contactName}"]`);
      if (contactInput && opt) contactInput.value = opt.dataset.contacto || '';
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
      ${actionCard('/salida', 'Registro de salida', 'Punto de partida y destino.', 'salida')}
      ${actionCard('/visita', 'Reporte de visita', 'Resultado y evidencia GPS.', 'visita')}
      ${actionCard('/reintegro', 'Reintegro', 'Solicitud del periodo.', 'reintegro')}
      ${
        isCatalogoClientesActivo()
          ? actionCard('/cliente', 'Registrar cliente', 'Solicitud con aprobación.', 'cliente')
          : ''
      }
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

  const panel = document.getElementById('notes-panel');
  document.getElementById('btn-notes')?.addEventListener('click', () => {
    panel.classList.toggle('hidden');
    markNotificationsRead(user.id);
  });
  document.getElementById('btn-notes-close')?.addEventListener('click', () => {
    panel.classList.add('hidden');
  });
}

function field(label, name, { type = 'text', required = true, value = '', placeholder = '', rows } = {}) {
  if (type === 'textarea') {
    return `
      <div>
        <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">${label}</label>
        <textarea name="${name}" rows="${rows || 3}" ${required ? 'required' : ''} placeholder="${placeholder}" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/20">${escapeHtml(value)}</textarea>
      </div>`;
  }
  if (type === 'select') {
    return `
      <div>
        <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">${label}</label>
        <select name="${name}" ${required ? 'required' : ''} class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/20">${value}</select>
      </div>`;
  }
  return `
    <div>
      <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">${label}</label>
      <input name="${name}" type="${type}" ${required ? 'required' : ''} value="${escapeHtml(value)}" placeholder="${placeholder}" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/20" />
    </div>`;
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
      showToast(err.message || 'Ocurrió un error.', 'err');
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

  app.innerHTML = shell(
    `
    <form id="form-salida" class="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        Al pulsar <strong>Registrar salida</strong>, se capturará su <strong>GPS en tiempo real</strong> como punto A.
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        ${field('Fecha', 'fecha_registro_salida', { type: 'date', value: fecha })}
        ${field('Hora', 'hora_registro_salida', { type: 'time', value: hora })}
      </div>
      ${clientFieldsHtml({
        nameField: 'cliente_registro_salida',
        contactField: 'contacto_registro_salida',
      })}
      ${field('Tipo de salida', 'tipo_registro_salida', {
        type: 'select',
        required: tipos.length > 0,
        value: optionsHtml(tipos),
      })}
      ${field('Punto de referencia', 'punto_referencia', { placeholder: 'Referencia del destino' })}
      ${field('Objetivo de la visita', 'objetivo_registro_salida', { type: 'textarea', placeholder: '¿Qué se busca lograr?' })}
      <button id="submit-btn" class="inline-flex w-full items-center justify-center rounded-xl bg-red-600 px-5 py-3.5 text-sm font-black uppercase tracking-tight text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-red-700">Registrar salida</button>
    </form>
    `,
    { title: 'Registro de salida', showBack: true, backTo: '/' }
  );
  bindShell('/');
  bindClientSelect(document.getElementById('form-salida'));
  bindFormSubmit('form-salida', async (data, btn) => {
    const session = getState().session;
    btn.textContent = 'Obteniendo GPS…';
    const gps = await getGps();
    btn.textContent = 'Enviando…';
    const result = await sendToMake({
      formulario: 'registro_salidas',
      ...data,
      latitud_registro_salidas: gps.latitud,
      longitud_registro_salidas: gps.longitud,
      gps_accuracy_salida: gps.accuracy,
    });
    saveLastSalida(session.id, {
      latitud: gps.latitud,
      longitud: gps.longitud,
      cliente: data.cliente_registro_salida,
    });
    showToast(`${result.message} GPS: ${gps.latitud}, ${gps.longitud}`);
    go('/');
  });
}

function renderVisita() {
  const { fecha, hora } = nowParts();
  const user = getState().session;
  const last = getLastSalida(user.id);
  const tiposVisita = resolveOptions(user, 'tipos_visita');
  const transportes = resolveOptions(user, 'tipos_transporte');
  const pagos = resolveOptions(user, 'tipos_pago');

  app.innerHTML = shell(
    `
    <form id="form-visita" class="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        Al enviar se captura el <strong>GPS actual</strong> (punto B). El punto A viene de su última salida.
      </div>
      ${
        last
          ? `<div class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
              Punto A listo: <strong>${escapeHtml(last.latitud)}, ${escapeHtml(last.longitud)}</strong>
            </div>`
          : `<div class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              Registre primero una <strong>salida</strong> para calcular la distancia A→B.
            </div>`
      }
      <div class="grid gap-4 sm:grid-cols-2">
        ${field('Fecha', 'fecha_reporte_visitas', { type: 'date', value: fecha })}
        ${field('Hora', 'hora_reporte_visitas', { type: 'time', value: hora })}
      </div>
      ${clientFieldsHtml({
        nameField: 'cliente_reporte_visitas',
        contactField: 'contacto_reporte_visitas',
        selected: last?.cliente || '',
        contactLabel: 'Contacto atendido',
      })}
      ${field('Tipo de visita', 'tipo_visita', {
        type: 'select',
        required: tiposVisita.length > 0,
        value: optionsHtml(tiposVisita),
      })}
      ${field('Punto de referencia', 'punto_referencia_visitas', { required: false })}
      ${field('Objetivo', 'objetivo_visita', { type: 'textarea', required: false })}
      ${field('Informe / resultado', 'informe_visitas', { type: 'textarea', placeholder: '¿Qué ocurrió en la visita?' })}
      ${field('Tareas pendientes', 'tareas_pendientes_reporte_visitas', { type: 'textarea', required: false })}
      <div class="grid gap-4 sm:grid-cols-2">
        ${field('Tipo de transporte', 'tipo_transporte', {
          type: 'select',
          required: transportes.length > 0,
          value: optionsHtml(transportes),
        })}
        ${field('Tipo de pago combustible', 'tipo_pago_combustible', {
          type: 'select',
          required: pagos.length > 0,
          value: optionsHtml(pagos),
        })}
      </div>
      <div>
        <label class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Evidencia fotográfica</label>
        <input name="foto" type="file" accept="image/*" capture="environment" class="w-full rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm" />
      </div>
      <button id="submit-btn" ${!last ? 'disabled' : ''} class="inline-flex w-full items-center justify-center rounded-xl bg-red-600 px-5 py-3.5 text-sm font-black uppercase tracking-tight text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">Reportar visita</button>
    </form>
    `,
    { title: 'Reporte de visita', showBack: true, backTo: '/' }
  );
  bindShell('/');
  bindClientSelect(document.getElementById('form-visita'));
  bindFormSubmit('form-visita', async (data, btn, form) => {
    const current = getLastSalida(getState().session.id);
    if (!current?.latitud || !current?.longitud) {
      throw new Error('Registre primero una salida para obtener el punto A.');
    }
    btn.textContent = 'Obteniendo GPS…';
    const gps = await getGps();
    const file = form.querySelector('input[name="foto"]').files[0];
    btn.textContent = 'Procesando imagen…';
    const foto = await fileToDataUrl(file);
    btn.textContent = 'Enviando…';
    const result = await sendToMake({
      formulario: 'reportes_visitas',
      ...data,
      latitud_registro_salidas: current.latitud,
      longitud_registro_salidas: current.longitud,
      latitud_reporte_visitas: gps.latitud,
      longitud_reporte_visitas: gps.longitud,
      gps_accuracy_visita: gps.accuracy,
      galeria_fotos_reporte_visitas: foto || null,
    });
    showToast(`${result.message} GPS visita: ${gps.latitud}, ${gps.longitud}`);
    go('/');
  });
}

function renderReintegro() {
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
      ${field('Contacto', 'contacto', { placeholder: 'Nombre, teléfono o correo', required: false })}
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
                    <div class="text-[11px] opacity-80 capitalize">${escapeHtml(r.estado)} · ${escapeHtml(r.contacto || 'Sin contacto')}</div>
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
      notas_solicitud: request.notas,
      correo_ventas: state.correo_ventas,
      accion: 'pendiente_aprobacion',
    });
    showToast(result.message || 'Solicitud enviada a Ventas.');
    go('/cliente');
  });
}

function catalogBlock(meta, items) {
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
    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-catalog="${meta.key}">
      <div class="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 class="text-sm font-black uppercase tracking-wider text-slate-900">${meta.title}</h3>
          <p class="mt-1 text-xs text-slate-500">${meta.hint}</p>
        </div>
        <button type="button" data-cat-add="${meta.key}" class="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-red-200 hover:text-red-600">+ Agregar</button>
      </div>
      <div class="space-y-2">${rows || '<p class="text-sm text-slate-400">Sin opciones aún.</p>'}</div>
      <form data-cat-form="${meta.key}" class="mt-3 hidden grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input type="hidden" name="id" />
        <input name="label" required placeholder="Nombre de la opción" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-red-500" />
        <button class="rounded-xl bg-red-600 px-4 py-2.5 text-xs font-black uppercase text-white">Guardar</button>
        <button type="button" data-cat-cancel="${meta.key}" class="rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-600">Cancelar</button>
      </form>
    </section>
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

function renderAdmin() {
  const state = getState();

  const usersRows = state.users
    .map(
      (u) => `
      <tr class="border-t border-slate-100">
        <td class="px-3 py-3 text-sm font-semibold text-slate-900">${escapeHtml(u.usuario)}</td>
        <td class="px-3 py-3 text-sm text-slate-600">${escapeHtml(u.nombre)}</td>
        <td class="px-3 py-3 text-sm capitalize">${escapeHtml(u.rol)}</td>
        <td class="px-3 py-3">
          ${iosSwitch('combustible_row', u.combustible_activo, {
            dataAttr: `data-toggle-fuel="${u.id}"`,
          })}
        </td>
        <td class="px-3 py-3 text-right whitespace-nowrap">
          <button data-edit="${u.id}" class="text-xs font-bold text-red-600 hover:underline">Editar</button>
          ${
            u.usuario !== 'admin'
              ? `<button data-del="${u.id}" class="ml-2 text-xs font-bold text-slate-400 hover:text-red-600">Eliminar</button>`
              : ''
          }
        </td>
      </tr>`
    )
    .join('');

  const pendingReqs = state.clientRequests.filter((r) => r.estado === 'pendiente');
  const clients = state.clients.filter((c) => c.activo !== false);

  app.innerHTML = shell(
    `
    <div class="stagger space-y-5">
      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 class="text-sm font-black uppercase tracking-wider text-slate-900">Configuración global</h3>
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
              <p class="text-xs text-slate-500">OFF = el vendedor escribe libre. ON = debe elegir de la lista (import/aprobación).</p>
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

      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 class="text-sm font-black uppercase tracking-wider text-slate-900">Clientes</h3>
        <p class="mt-1 text-xs text-slate-500">
          Carga masiva por Excel/CSV (<strong>nombre</strong>, <strong>contacto</strong>).
          ${
            state.catalogoClientesActivo
              ? '<span class="font-semibold text-emerald-700"> Catálogo ON: obligatorio en formularios.</span>'
              : '<span class="font-semibold text-slate-500"> Catálogo OFF: formularios en modo libre.</span>'
          }
        </p>
        <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input id="file-clients" type="file" accept=".csv,.xlsx,.xls" class="w-full flex-1 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm" />
          <button id="btn-import-clients" class="rounded-xl bg-slate-900 px-4 py-3 text-xs font-black uppercase tracking-tight text-white hover:bg-slate-800">Importar</button>
        </div>
        <p id="import-status" class="mt-2 text-xs text-slate-500"></p>
        <div class="mt-4 max-h-56 overflow-y-auto rounded-xl border border-slate-100">
          <table class="min-w-full text-left text-sm">
            <thead class="sticky top-0 bg-slate-50 text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th class="px-3 py-2">Nombre</th>
                <th class="px-3 py-2">Contacto</th>
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
                  <td class="px-3 py-2 font-semibold text-slate-900">${escapeHtml(c.nombre)}</td>
                  <td class="px-3 py-2 text-slate-600">${escapeHtml(c.contacto || '—')}</td>
                  <td class="px-3 py-2 text-right">
                    <button data-del-client="${c.id}" class="text-xs font-bold text-slate-400 hover:text-red-600">Eliminar</button>
                  </td>
                </tr>`
                      )
                      .join('')
                  : '<tr><td colspan="3" class="px-3 py-4 text-slate-400">Sin clientes cargados.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 class="text-sm font-black uppercase tracking-wider text-slate-900">Solicitudes de clientes</h3>
        <p class="mt-1 text-xs text-slate-500">Apruebe o rechace altas pedidas por vendedores. Make puede notificar por correo con el mismo webhook.</p>
        <div class="mt-4 space-y-3">
          ${
            pendingReqs.length
              ? pendingReqs
                  .map(
                    (r) => `
            <div class="rounded-xl border border-amber-200 bg-amber-50/40 p-3">
              <div class="text-sm font-black text-slate-900">${escapeHtml(r.nombre)}</div>
              <div class="mt-0.5 text-xs text-slate-600">Contacto: ${escapeHtml(r.contacto || '—')} · Solicitó: ${escapeHtml(r.vendedorNombre)}</div>
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

      <div>
        <h3 class="mb-1 text-sm font-black uppercase tracking-wider text-slate-900">Catálogos globales</h3>
        <p class="mb-3 text-xs text-slate-500">Lo que ve el vendedor en los formularios. Active/desactive o agregue opciones.</p>
        <div class="space-y-4">
          ${CATALOG_META.map((meta) => catalogBlock(meta, state.catalogos[meta.key] || [])).join('')}
        </div>
      </div>

      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-black uppercase tracking-wider text-slate-900">Usuarios</h3>
            <p class="mt-1 text-xs text-slate-500">Por perfil puede limitar transporte, pago y tipos de visita.</p>
          </div>
          <button id="btn-new-user" class="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:border-red-200 hover:text-red-600">+ Nuevo</button>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full text-left">
            <thead class="text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th class="px-3 py-2">Usuario</th>
                <th class="px-3 py-2">Nombre</th>
                <th class="px-3 py-2">Rol</th>
                <th class="px-3 py-2">Combustible</th>
                <th class="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>${usersRows}</tbody>
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
          ${field('Correo', 'correo', { type: 'email', required: false })}
          ${field('Correo jefe', 'correo_jefe', { type: 'email', required: false })}
          ${field('Rol', 'rol', {
            type: 'select',
            value: `<option value="vendedor">Vendedor</option><option value="admin">Admin</option>`,
          })}
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
    { title: 'Configuración' }
  );

  bindShell('/admin/login');

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
      const rows = await parseClientFile(file);
      const { added, skipped } = importClients(rows);
      showToast(`Importación lista: ${added} nuevos, ${skipped} omitidos.`);
      render();
    } catch (err) {
      status.textContent = '';
      showToast(err.message || 'No se pudo leer el archivo.', 'err');
    }
  });

  document.querySelectorAll('[data-del-client]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!confirm('¿Eliminar este cliente?')) return;
      deleteClient(btn.dataset.delClient);
      showToast('Cliente eliminado.');
      render();
    });
  });

  document.querySelectorAll('[data-approve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { request } = resolveClientRequest(btn.dataset.approve, 'aprobado');
      if (!request) return;
      await sendToMake({
        formulario: 'solicitud_cliente',
        request_id: request.id,
        nombre_cliente: request.nombre,
        contacto_cliente: request.contacto,
        correo_vendedor: request.vendedorCorreo,
        correo_ventas: getState().correo_ventas,
        accion: 'aprobado',
        vendedor: request.vendedorNombre,
      });
      showToast('Cliente aprobado y notificado.');
      render();
    });
  });

  document.querySelectorAll('[data-reject]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const motivo = prompt('Motivo del rechazo (opcional):') || '';
      const { request } = resolveClientRequest(btn.dataset.reject, 'rechazado', motivo);
      if (!request) return;
      await sendToMake({
        formulario: 'solicitud_cliente',
        request_id: request.id,
        nombre_cliente: request.nombre,
        contacto_cliente: request.contacto,
        correo_vendedor: request.vendedorCorreo,
        correo_ventas: getState().correo_ventas,
        accion: 'rechazado',
        motivo,
        vendedor: request.vendedorNombre,
      });
      showToast('Solicitud rechazada y notificada.');
      render();
    });
  });

  document.querySelectorAll('[data-toggle-fuel]').forEach((input) => {
    input.addEventListener('change', () => {
      setUserCombustible(input.dataset.toggleFuel, input.checked);
      showToast(input.checked ? 'Combustible activado.' : 'Combustible desactivado.');
    });
  });

  // Catálogos
  document.querySelectorAll('[data-cat-toggle]').forEach((input) => {
    input.addEventListener('change', () => {
      setCatalogItemActive(input.dataset.catToggle, input.dataset.catId, input.checked);
      showToast(input.checked ? 'Opción activada.' : 'Opción desactivada.');
    });
  });

  document.querySelectorAll('[data-cat-add]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.catAdd;
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

  const editor = document.getElementById('user-editor');
  const formUser = document.getElementById('form-user');
  const userOptions = document.getElementById('user-options');

  function paintUserOptions(user = null) {
    const cats = getState().catalogos;
    userOptions.innerHTML = CATALOG_META.map((meta) =>
      userOptionChecks(meta.key, cats[meta.key] || [], user?.[meta.key] || [])
    ).join('');

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
    formUser.correo.value = user?.correo || '';
    formUser.correo_jefe.value = user?.correo_jefe || '';
    formUser.rol.value = user?.rol || 'vendedor';
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

  formUser.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(formUser);
    const existing = getState().users.find((u) => u.id === fd.get('id'));
    const password = String(fd.get('password') || '').trim() || existing?.password || 'cambiar123';

    const picks = {};
    for (const meta of CATALOG_META) {
      const inherit = formUser.querySelector(`[data-inherit="${meta.key}"]`)?.checked;
      if (inherit) picks[meta.key] = [];
      else picks[meta.key] = fd.getAll(meta.key).map(String);
    }

    upsertUser({
      id: fd.get('id'),
      usuario: String(fd.get('usuario')).trim(),
      password,
      nombre: String(fd.get('nombre')).trim(),
      cargo: String(fd.get('cargo') || '').trim(),
      sucursal: String(fd.get('sucursal') || '').trim(),
      correo: String(fd.get('correo') || '').trim(),
      correo_jefe: String(fd.get('correo_jefe') || '').trim(),
      rol: fd.get('rol'),
      combustible_activo: fd.get('combustible_activo') === 'on',
      activo: true,
      ...picks,
    });
    showToast('Usuario guardado.');
    render();
  });
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
    renderAdmin();
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

  switch (path) {
    case '/salida':
      renderSalida();
      break;
    case '/visita':
      renderVisita();
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
