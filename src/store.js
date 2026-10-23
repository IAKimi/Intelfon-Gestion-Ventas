import { DEFAULT_WEBHOOK_URL } from './config.js';
import {
  apiAvailable,
  apiGetState,
  apiLogin,
  apiLogout,
  apiPutState,
  getToken,
  setToken,
} from './api.js';

const STORAGE_KEY = 'red-gestion-ventas-v3';
const LEGACY_KEYS = ['red-gestion-ventas-v2', 'red-gestion-ventas-v1'];

const DEFAULT_CATALOGOS = {
  tipos_salida: [
    { id: 'salida-visita', label: 'Visita comercial', activo: true },
    { id: 'salida-seguimiento', label: 'Seguimiento', activo: true },
    { id: 'salida-cobro', label: 'Cobro', activo: true },
    { id: 'salida-otro', label: 'Otro', activo: true },
  ],
  tipos_visita: [
    { id: 'visita-comercial', label: 'Visita comercial', activo: true },
    { id: 'visita-seguimiento', label: 'Seguimiento', activo: true },
    { id: 'visita-cobro', label: 'Cobro', activo: true },
    { id: 'visita-otro', label: 'Otro', activo: true },
  ],
  tipos_transporte: [
    { id: 'trans-moto', label: 'Moto', activo: true },
    { id: 'trans-carro', label: 'Carro', activo: true },
  ],
  tipos_pago: [
    { id: 'pago-conteo', label: 'Pago por conteo', activo: true },
    { id: 'pago-km', label: 'Pago por kilometraje', activo: true },
  ],
};

const DEFAULT_STATE = {
  combustibleGlobal: true,
  catalogoClientesActivo: false,
  webhookUrl: DEFAULT_WEBHOOK_URL,
  correo_ventas: 'ventas@red.com.sv',
  export_api_key: '',
  catalogos: structuredClone(DEFAULT_CATALOGOS),
  clients: [],
  clientRequests: [],
  contactChanges: [],
  notifications: [],
  salidas: [],
  citas: [],
  users: [
    {
      id: 'admin-1',
      usuario: 'admin',
      password: 'VentasINTELFON12345',
      nombre: 'Administrador RED',
      cargo: 'Administración',
      sucursal: 'San Salvador',
      correo: 'admin@red.com.sv',
      correo_jefe: 'admin@red.com.sv',
      rol: 'admin',
      combustible_activo: true,
      activo: true,
      tipos_salida: [],
      tipos_visita: [],
      tipos_transporte: [],
      tipos_pago: [],
      transporte_default: '',
      pago_combustible_default: '',
    },
    {
      id: 'vend-1',
      usuario: 'vendedor',
      password: '123',
      nombre: 'Ejecutivo Demo',
      cargo: 'Ejecutivo de Ventas',
      sucursal: 'San Salvador',
      correo: 'vendedor@red.com.sv',
      correo_jefe: 'admin@red.com.sv',
      rol: 'vendedor',
      combustible_activo: true,
      activo: true,
      tipos_salida: [],
      tipos_visita: [],
      tipos_transporte: [],
      tipos_pago: [],
      transporte_default: 'Moto',
      pago_combustible_default: 'Pago por conteo',
    },
  ],
};

let remoteMode = false;
let memory = null;
let syncTimer = null;
let syncing = false;
let syncDirty = false;

export function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeUser(u) {
  const pais = String(u.pais || '').trim().toUpperCase();
  return {
    ...u,
    pais: pais === 'GT' || pais === 'SV' ? pais : '',
    tipos_salida: Array.isArray(u.tipos_salida) ? u.tipos_salida : [],
    tipos_visita: Array.isArray(u.tipos_visita) ? u.tipos_visita : [],
    tipos_transporte: Array.isArray(u.tipos_transporte) ? u.tipos_transporte : [],
    tipos_pago: Array.isArray(u.tipos_pago) ? u.tipos_pago : [],
    transporte_default: String(u.transporte_default || '').trim(),
    pago_combustible_default: String(u.pago_combustible_default || '').trim(),
  };
}

function slugLogin(nombre, pais) {
  const base = String(nombre || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 40);
  const tag = String(pais || 'sv').toLowerCase();
  return `${base || 'ejecutivo'}.${tag}`;
}

function normalizeRole(r) {
  if (!r || typeof r !== 'object') return { nombre: '', tel_fijo: '', celular: '', correo: '' };
  return {
    nombre: String(r.nombre || '').trim(),
    tel_fijo: String(r.tel_fijo || '').trim(),
    celular: String(r.celular || '').trim(),
    correo: String(r.correo || '').trim(),
  };
}

function normalizeContactEntry(x) {
  if (!x || typeof x !== 'object') return null;
  const nombre = String(x.nombre || '').trim();
  if (!nombre) return null;
  return {
    id: x.id || createId('ctc'),
    nombre,
    cargo: String(x.cargo || '').trim(),
    telefono: String(x.telefono || '').trim(),
    telefono_fijo: String(x.telefono_fijo || '').trim(),
    correo: String(x.correo || '').trim(),
  };
}

/** Lista unificada: contactos guardados + GG/GO/GF + contacto principal. */
export function listClientContacts(client) {
  if (!client) return [];
  const out = [];
  const seen = new Set();
  const push = (entry) => {
    const n = normalizeContactEntry(entry);
    if (!n) return;
    const key = n.nombre.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(n);
  };
  (Array.isArray(client.contactos) ? client.contactos : []).forEach(push);
  for (const [cargo, role] of [
    ['GG', client.gg],
    ['GO', client.go],
    ['GF', client.gf],
  ]) {
    if (role?.nombre) {
      push({
        nombre: role.nombre,
        cargo,
        telefono: role.celular || '',
        telefono_fijo: role.tel_fijo || '',
        correo: role.correo || '',
      });
    }
  }
  if (client.contacto) {
    push({
      nombre: client.contacto,
      cargo: client.contacto_rol || '',
      telefono: client.telefono || '',
      telefono_fijo: client.telefono_fijo || '',
      correo: client.correo_contacto || '',
    });
  }
  return out;
}

export function normalizeClient(c) {
  const pais = String(c.pais || '').trim().toUpperCase();
  const contactos = (Array.isArray(c.contactos) ? c.contactos : [])
    .map(normalizeContactEntry)
    .filter(Boolean);
  return {
    id: c.id || createId('cli'),
    codigo: String(c.codigo || '').trim(),
    nombre: String(c.nombre || '').trim(),
    contacto: String(c.contacto || '').trim(),
    telefono: String(c.telefono || '').trim(),
    telefono_fijo: String(c.telefono_fijo || '').trim(),
    correo_contacto: String(c.correo_contacto || '').trim(),
    contacto_rol: String(c.contacto_rol || '').trim(),
    contactos,
    gg: normalizeRole(c.gg),
    go: normalizeRole(c.go),
    gf: normalizeRole(c.gf),
    pais: pais === 'GT' || pais === 'SV' ? pais : '',
    vendedorId: c.vendedorId || '',
    vendedorNombre: String(c.vendedorNombre || '').trim(),
    tipo: c.tipo === 'prospecto' ? 'prospecto' : 'cliente',
    ubicacion: String(c.ubicacion || '').trim(),
    notas: String(c.notas || '').trim(),
    origen: c.origen || 'manual',
    activo: c.activo !== false,
    createdAt: c.createdAt || new Date().toISOString(),
  };
}

function normalizeCatalogos(raw) {
  const base = structuredClone(DEFAULT_CATALOGOS);
  if (!raw || typeof raw !== 'object') return base;
  for (const key of Object.keys(base)) {
    if (Array.isArray(raw[key]) && raw[key].length) {
      base[key] = raw[key].map((x) => ({
        id: x.id || createId('cat'),
        label: String(x.label || '').trim() || 'Sin nombre',
        activo: x.activo !== false,
      }));
    }
  }
  return base;
}

function omitSession(state) {
  const { session, ...persistable } = state;
  return persistable;
}

function applyRemotePayload(payload, sessionOverride) {
  memory = {
    combustibleGlobal: Boolean(payload.combustibleGlobal),
    catalogoClientesActivo: Boolean(payload.catalogoClientesActivo),
    webhookUrl: String(payload.webhookUrl || '').trim() || DEFAULT_WEBHOOK_URL,
    correo_ventas: payload.correo_ventas || DEFAULT_STATE.correo_ventas,
    export_api_key: payload.export_api_key || '',
    catalogos: normalizeCatalogos(payload.catalogos),
    clients: (Array.isArray(payload.clients) ? payload.clients : []).map(normalizeClient),
    clientRequests: Array.isArray(payload.clientRequests) ? payload.clientRequests : [],
    contactChanges: Array.isArray(payload.contactChanges) ? payload.contactChanges : [],
    notifications: Array.isArray(payload.notifications) ? payload.notifications : [],
    salidas: Array.isArray(payload.salidas) ? payload.salidas : [],
    citas: Array.isArray(payload.citas) ? payload.citas : [],
    users: (payload.users || []).map(normalizeUser),
    session: sessionOverride || payload.session || null,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(omitSession(memory)));
  } catch {
    /* ignore quota */
  }
  return memory;
}

function loadLocal() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      for (const k of LEGACY_KEYS) {
        raw = localStorage.getItem(k);
        if (raw) break;
      }
    }
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT_STATE),
      ...parsed,
      catalogos: normalizeCatalogos(parsed.catalogos),
      users: (parsed.users?.length ? parsed.users : DEFAULT_STATE.users).map(normalizeUser),
      clients: (Array.isArray(parsed.clients) ? parsed.clients : []).map(normalizeClient),
      clientRequests: Array.isArray(parsed.clientRequests) ? parsed.clientRequests : [],
      contactChanges: Array.isArray(parsed.contactChanges) ? parsed.contactChanges : [],
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
      salidas: Array.isArray(parsed.salidas) ? parsed.salidas : [],
      citas: Array.isArray(parsed.citas) ? parsed.citas : [],
      correo_ventas: parsed.correo_ventas || DEFAULT_STATE.correo_ventas,
      catalogoClientesActivo: Boolean(parsed.catalogoClientesActivo),
      webhookUrl: String(parsed.webhookUrl || '').trim() || DEFAULT_WEBHOOK_URL,
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function ensureMemory() {
  if (!memory) memory = loadLocal();
  return memory;
}

function saveLocal(state) {
  memory = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(omitSession(state)));
}

function queueRemoteSync() {
  if (!remoteMode || !getToken()) return;
  syncDirty = true;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runRemoteSync, 250);
}

async function runRemoteSync() {
  if (syncing || !syncDirty) return;
  syncing = true;
  syncDirty = false;
  try {
    const state = ensureMemory();
    const session = state.session;
    const payload = await apiPutState({
      combustibleGlobal: state.combustibleGlobal,
      catalogoClientesActivo: state.catalogoClientesActivo,
      webhookUrl: state.webhookUrl,
      correo_ventas: state.correo_ventas,
      export_api_key: state.export_api_key || '',
      catalogos: state.catalogos,
      clients: state.clients,
      clientRequests: state.clientRequests,
      contactChanges: state.contactChanges || [],
      notifications: state.notifications,
      salidas: state.salidas,
      citas: state.citas || [],
      users: state.users,
    });
    // Si hubo cambios durante el envío, no pisarlos con la respuesta.
    if (!syncDirty) applyRemotePayload(payload, session);
  } catch (err) {
    console.warn('Sync remoto falló', err);
    syncDirty = true;
  } finally {
    syncing = false;
    if (syncDirty) {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(runRemoteSync, 800);
    }
  }
}

function save(state) {
  saveLocal(state);
  queueRemoteSync();
}

export function isRemoteMode() {
  return remoteMode;
}

/** Arranca modo API si el servidor responde. */
export async function initStore() {
  remoteMode = await apiAvailable();
  if (!remoteMode) {
    memory = loadLocal();
    const sessionRaw = sessionStorage.getItem('red-session');
    if (sessionRaw) {
      try {
        memory.session = JSON.parse(sessionRaw);
      } catch {
        memory.session = null;
      }
    }
    return { remote: false };
  }

  if (!getToken()) {
    memory = {
      ...structuredClone(DEFAULT_STATE),
      users: [],
      session: null,
    };
    return { remote: true };
  }

  try {
    const payload = await apiGetState();
    applyRemotePayload(payload, payload.session);
    if (payload.session) setSession(payload.session);
    return { remote: true };
  } catch {
    setToken('');
    setSession(null);
    memory = {
      ...structuredClone(DEFAULT_STATE),
      users: [],
      session: null,
    };
    return { remote: true };
  }
}

export function getState() {
  const data = ensureMemory();
  let session = data.session || null;
  if (!remoteMode) {
    const sessionRaw = sessionStorage.getItem('red-session');
    if (sessionRaw) {
      try {
        session = JSON.parse(sessionRaw);
      } catch {
        session = null;
      }
    }
  }
  if (session?.id) {
    const fresh = data.users.find((u) => u.id === session.id);
    if (fresh) {
      session = normalizeUser({ ...fresh, password: undefined });
      delete session.password;
    }
  }
  return { ...data, session };
}

export function setSession(user) {
  const state = ensureMemory();
  if (!user) {
    sessionStorage.removeItem('red-session');
    state.session = null;
    return;
  }
  const safe = { ...user };
  delete safe.password;
  sessionStorage.setItem('red-session', JSON.stringify(safe));
  state.session = safe;
}

function matchesLogin(u, login) {
  const key = String(login || '').trim().toLowerCase();
  return (
    String(u.usuario || '').toLowerCase() === key ||
    String(u.correo || '').toLowerCase() === key
  );
}

/** @param {'admin' | 'vendedor' | 'jefe'} expectedRole */
export async function login(usuario, password, expectedRole) {
  if (remoteMode) {
    try {
      const data = await apiLogin(usuario, password, expectedRole);
      setToken(data.token);
      applyRemotePayload(data.state, data.user);
      setSession(data.user);
      return data.user;
    } catch {
      return null;
    }
  }

  const state = getState();
  const roleOk = (rol) => {
    if (expectedRole === 'admin') return rol === 'admin';
    if (expectedRole === 'vendedor') return rol === 'vendedor' || rol === 'jefe';
    return rol === expectedRole;
  };
  const user = state.users.find(
    (u) => matchesLogin(u, usuario) && u.password === password && u.activo && roleOk(u.rol)
  );
  if (!user) return null;
  setSession(user);
  return user;
}

export function isJefe(user) {
  if (!user) return false;
  if (user.rol === 'jefe' || user.es_jefe) return true;
  const correo = String(user.correo || '').toLowerCase();
  if (!correo) return false;
  return getState().users.some(
    (u) => u.rol !== 'admin' && String(u.correo_jefe || '').toLowerCase() === correo
  );
}

export async function logout() {
  if (remoteMode) await apiLogout();
  setSession(null);
}

export function resolveCombustible(user) {
  const state = getState();
  if (state.combustibleGlobal) return true;
  return Boolean(user?.combustible_activo);
}

export function resolveOptions(user, catalogKey) {
  const state = getState();
  const globalActive = (state.catalogos[catalogKey] || []).filter((x) => x.activo);
  const allowed = user?.[catalogKey];
  if (!Array.isArray(allowed) || allowed.length === 0) return globalActive;
  return globalActive.filter((x) => allowed.includes(x.id));
}

export function getActiveClients(forUser = null) {
  const user = forUser || getState().session;
  const all = getState().clients.filter((c) => c.activo !== false);
  if (!user || user.rol === 'admin') return all;
  return all.filter((c) => c.vendedorId === user.id);
}

export function getClientsByVendedor(vendedorId) {
  return getState().clients.filter((c) => c.activo !== false && c.vendedorId === vendedorId);
}

export function getClientesDe(user) {
  return getActiveClients(user).filter((c) => c.tipo !== 'prospecto');
}

export function getProspectosDe(user) {
  return getActiveClients(user).filter((c) => c.tipo === 'prospecto');
}

/** Prospecto libre: nace usable en salidas, sin aprobación ni tocar la cartera de clientes. */
export function createProspect({ nombre, contacto, telefono, ubicacion, notas }, seller) {
  const state = ensureMemory();
  const prospect = normalizeClient({
    id: createId('cli'),
    nombre,
    contacto,
    telefono: telefono || '',
    ubicacion: ubicacion || '',
    notas: notas || '',
    pais: seller?.pais || '',
    vendedorId: seller.id,
    vendedorNombre: seller.nombre,
    tipo: 'prospecto',
    origen: 'prospecto',
    activo: true,
    createdAt: new Date().toISOString(),
  });
  state.clients.push(prospect);
  save(state);
  return { state: getState(), prospect };
}

export function getEjecutivos() {
  return getState()
    .users.filter((u) => u.rol === 'vendedor' && u.activo !== false)
    .slice()
    .sort((a, b) => {
      const pa = a.pais || 'ZZ';
      const pb = b.pais || 'ZZ';
      if (pa !== pb) return pa.localeCompare(pb);
      return String(a.nombre || '').localeCompare(String(b.nombre || ''));
    });
}

export function updateConfig({
  combustibleGlobal,
  webhookUrl,
  correo_ventas,
  catalogoClientesActivo,
  export_api_key,
}) {
  const state = ensureMemory();
  if (typeof combustibleGlobal === 'boolean') state.combustibleGlobal = combustibleGlobal;
  if (typeof catalogoClientesActivo === 'boolean') state.catalogoClientesActivo = catalogoClientesActivo;
  if (typeof webhookUrl === 'string') state.webhookUrl = webhookUrl.trim();
  if (typeof correo_ventas === 'string') state.correo_ventas = correo_ventas.trim();
  if (typeof export_api_key === 'string') state.export_api_key = export_api_key.trim();
  save(state);
  return getState();
}

export function isCatalogoClientesActivo() {
  return Boolean(getState().catalogoClientesActivo);
}

export function upsertCatalogItem(catalogKey, itemData) {
  const state = ensureMemory();
  if (!state.catalogos[catalogKey]) return getState();
  const list = state.catalogos[catalogKey];
  const idx = list.findIndex((x) => x.id === itemData.id);
  const next = {
    id: itemData.id || createId('cat'),
    label: String(itemData.label || '').trim(),
    activo: itemData.activo !== false,
  };
  if (!next.label) return getState();
  if (idx >= 0) list[idx] = next;
  else list.push(next);
  save(state);
  return getState();
}

export function setCatalogItemActive(catalogKey, id, activo) {
  const state = ensureMemory();
  const item = state.catalogos[catalogKey]?.find((x) => x.id === id);
  if (!item) return getState();
  item.activo = Boolean(activo);
  save(state);
  return getState();
}

export function deleteCatalogItem(catalogKey, id) {
  const state = ensureMemory();
  if (!state.catalogos[catalogKey]) return getState();
  state.catalogos[catalogKey] = state.catalogos[catalogKey].filter((x) => x.id !== id);
  state.users = state.users.map((u) => ({
    ...u,
    [catalogKey]: (u[catalogKey] || []).filter((x) => x !== id),
  }));
  save(state);
  return getState();
}

const STUB_PASSWORD = 'Cambiar123!';

function findOrCreateEjecutivo(state, nombre, pais) {
  const name = String(nombre || '').trim();
  const country = pais === 'GT' ? 'GT' : pais === 'SV' ? 'SV' : '';
  if (!name) return null;

  let user = state.users.find(
    (u) =>
      u.rol === 'vendedor' &&
      String(u.nombre || '').trim().toLowerCase() === name.toLowerCase() &&
      (country ? String(u.pais || '') === country : true)
  );
  if (user) return user;

  let login = slugLogin(name, country || 'xx');
  let n = 2;
  while (state.users.some((u) => String(u.usuario).toLowerCase() === login.toLowerCase())) {
    login = `${slugLogin(name, country || 'xx')}.${n}`;
    n += 1;
  }

  user = normalizeUser({
    id: createId('vend'),
    usuario: login,
    password: STUB_PASSWORD,
    nombre: name,
    cargo: 'Ejecutivo de Ventas',
    sucursal: country === 'GT' ? 'Guatemala' : country === 'SV' ? 'El Salvador' : '',
    correo: '',
    correo_jefe: '',
    rol: 'vendedor',
    pais: country,
    combustible_activo: true,
    activo: true,
    tipos_salida: [],
    tipos_visita: [],
    tipos_transporte: [],
    tipos_pago: [],
    transporte_default: 'Moto',
    pago_combustible_default: 'Pago por conteo',
  });
  state.users.push(user);
  return user;
}

function clientMatchKey(c) {
  const pais = String(c.pais || '').toUpperCase();
  const codigo = String(c.codigo || '').trim().toUpperCase();
  if (codigo) return `c:${pais}:${codigo}`;
  return `n:${pais}:${String(c.nombre || '').trim().toLowerCase()}`;
}

/** Importa cartera INTELFON: crea stubs de ejecutivos y asigna clientes. mode: merge | replace */
export function importClients(rows, { omittedFile = 0, mode = 'merge' } = {}) {
  const state = ensureMemory();
  let added = 0;
  let updated = 0;
  let skipped = 0;
  let usersCreated = 0;
  const beforeUsers = state.users.length;
  const beforeClients = state.clients.filter((c) => c.tipo !== 'prospecto').length;

  if (mode === 'replace') {
    state.clients = state.clients.filter((c) => c.tipo === 'prospecto');
  }

  for (const row of rows) {
    const nombre = String(row.nombre || '').trim();
    if (!nombre) {
      skipped += 1;
      continue;
    }

    const pais = String(row.pais || '').trim().toUpperCase();
    const ejecutivo = String(row.ejecutivo || '').trim();
    let seller = null;
    if (ejecutivo) {
      const before = state.users.length;
      seller = findOrCreateEjecutivo(state, ejecutivo, pais === 'GT' || pais === 'SV' ? pais : '');
      if (state.users.length > before) usersCreated += 1;
    }

    const contactos = [];
    for (const [cargo, role] of [
      ['GG', row.gg],
      ['GO', row.go],
      ['GF', row.gf],
    ]) {
      if (role?.nombre) {
        contactos.push({
          id: createId('ctc'),
          nombre: role.nombre,
          cargo,
          telefono: role.celular || '',
          telefono_fijo: role.tel_fijo || '',
          correo: role.correo || '',
        });
      }
    }

    const next = normalizeClient({
      codigo: row.codigo,
      nombre,
      contacto: row.contacto,
      telefono: row.telefono,
      telefono_fijo: row.telefono_fijo,
      correo_contacto: row.correo_contacto,
      contacto_rol: row.contacto_rol,
      contactos,
      gg: row.gg,
      go: row.go,
      gf: row.gf,
      pais: pais === 'GT' || pais === 'SV' ? pais : '',
      vendedorId: seller?.id || '',
      vendedorNombre: seller?.nombre || ejecutivo,
      origen: 'import',
      activo: true,
    });

    const key = clientMatchKey(next);
    const idx = state.clients.findIndex((c) => clientMatchKey(c) === key && c.activo !== false);
    if (idx >= 0) {
      const prev = state.clients[idx];
      const mergedContacts = listClientContacts({ ...prev, contactos: next.contactos });
      state.clients[idx] = {
        ...prev,
        ...next,
        id: prev.id,
        createdAt: prev.createdAt,
        contactos: mergedContacts,
      };
      updated += 1;
    } else {
      state.clients.push(next);
      added += 1;
    }
  }

  save(state);
  return {
    state: getState(),
    added,
    updated,
    skipped: skipped + omittedFile,
    usersCreated: usersCreated || Math.max(0, state.users.length - beforeUsers),
    stubPassword: STUB_PASSWORD,
    beforeClients,
    afterClients: state.clients.filter((c) => c.tipo !== 'prospecto').length,
    mode,
  };
}

export function upsertClient(client) {
  const state = ensureMemory();
  const next = normalizeClient(client);
  const idx = state.clients.findIndex((c) => c.id === next.id);
  if (idx >= 0) state.clients[idx] = { ...state.clients[idx], ...next };
  else state.clients.push(next);
  save(state);
  return getState();
}

export const CONTACT_FIELDS = [
  { key: 'contacto', label: 'Contacto' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'telefono_fijo', label: 'Teléfono fijo' },
  { key: 'correo_contacto', label: 'Correo contacto' },
];

/** Agrega un contacto a la lista del cliente (y lo deja como principal). */
export function addClientContact(clientId, contactData, user) {
  const state = ensureMemory();
  const idx = state.clients.findIndex((c) => c.id === clientId);
  if (idx < 0 || !user) return { state: getState(), added: false };
  const client = state.clients[idx];
  if (user.rol !== 'admin' && client.vendedorId !== user.id) {
    return { state: getState(), added: false };
  }
  const entry = normalizeContactEntry(contactData);
  if (!entry) return { state: getState(), added: false };
  if (!Array.isArray(client.contactos)) client.contactos = [];
  const exists = listClientContacts(client).some(
    (x) => x.nombre.toLowerCase() === entry.nombre.toLowerCase()
  );
  if (!exists) client.contactos.push(entry);
  client.contacto = entry.nombre;
  client.telefono = entry.telefono || client.telefono;
  client.telefono_fijo = entry.telefono_fijo || client.telefono_fijo;
  client.correo_contacto = entry.correo || client.correo_contacto;
  client.contacto_rol = entry.cargo || client.contacto_rol;
  if (!Array.isArray(state.contactChanges)) state.contactChanges = [];
  state.contactChanges.push({
    id: createId('chg'),
    clientId: client.id,
    codigo: client.codigo || '',
    clienteNombre: client.nombre || '',
    pais: client.pais || '',
    campo: 'contacto_nuevo',
    campoLabel: 'Contacto nuevo',
    anterior: '',
    nuevo: entry.nombre,
    vendedorId: client.vendedorId || user.id,
    vendedorNombre: client.vendedorNombre || user.nombre || '',
    correo_jefe: state.users.find((u) => u.id === client.vendedorId)?.correo_jefe || '',
    createdAt: new Date().toISOString(),
  });
  save(state);
  return { state: getState(), added: true, contact: entry };
}

export function removeClientContact(clientId, contactId, user) {
  const state = ensureMemory();
  const idx = state.clients.findIndex((c) => c.id === clientId);
  if (idx < 0 || !user) return getState();
  const client = state.clients[idx];
  if (user.rol !== 'admin' && client.vendedorId !== user.id) return getState();
  client.contactos = (client.contactos || []).filter((x) => x.id !== contactId);
  save(state);
  return getState();
}

/** Edita contacto de un cliente propio y deja trazabilidad (anterior → nuevo). */
export function updateClientContact(clientId, fields, user) {
  const state = ensureMemory();
  if (!Array.isArray(state.contactChanges)) state.contactChanges = [];
  const idx = state.clients.findIndex((c) => c.id === clientId);
  if (idx < 0 || !user) return { state: getState(), changed: 0 };
  const client = state.clients[idx];
  if (user.rol !== 'admin' && client.vendedorId !== user.id) {
    return { state: getState(), changed: 0 };
  }
  const seller = state.users.find((u) => u.id === client.vendedorId);
  let changed = 0;
  for (const { key, label } of CONTACT_FIELDS) {
    if (!(key in fields)) continue;
    const before = String(client[key] || '').trim();
    const after = String(fields[key] || '').trim();
    if (before === after) continue;
    state.contactChanges.push({
      id: createId('chg'),
      clientId: client.id,
      codigo: client.codigo || '',
      clienteNombre: client.nombre || '',
      pais: client.pais || '',
      campo: key,
      campoLabel: label,
      anterior: before,
      nuevo: after,
      vendedorId: client.vendedorId || user.id,
      vendedorNombre: client.vendedorNombre || user.nombre || '',
      correo_jefe: seller?.correo_jefe || '',
      createdAt: new Date().toISOString(),
    });
    client[key] = after;
    changed += 1;
  }
  if (changed) save(state);
  return { state: getState(), changed };
}

export function deleteClient(id) {
  const state = ensureMemory();
  state.clients = state.clients.filter((c) => c.id !== id);
  save(state);
  return getState();
}

export function createClientRequest({ nombre, contacto, telefono, notas, prospectId = '' }, seller) {
  const state = ensureMemory();
  const req = {
    id: createId('req'),
    nombre: String(nombre || '').trim(),
    contacto: String(contacto || '').trim(),
    telefono: String(telefono || '').trim(),
    notas: String(notas || '').trim(),
    prospectId: prospectId || '',
    vendedorId: seller.id,
    vendedorNombre: seller.nombre,
    vendedorCorreo: seller.correo || '',
    estado: 'pendiente',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
  state.clientRequests.unshift(req);
  save(state);
  return { state: getState(), request: req };
}

export function resolveClientRequest(id, decision, adminNote = '') {
  const state = ensureMemory();
  const req = state.clientRequests.find((r) => r.id === id);
  if (!req || req.estado !== 'pendiente') return { state: getState(), request: null };

  req.estado = decision;
  req.resolvedAt = new Date().toISOString();
  req.adminNote = String(adminNote || '').trim();

  if (decision === 'aprobado' && req.prospectId) {
    const prospect = state.clients.find((c) => c.id === req.prospectId);
    if (prospect) prospect.tipo = 'cliente';
  } else if (decision === 'aprobado') {
    const exists = state.clients.some(
      (c) =>
        c.nombre.toLowerCase() === req.nombre.toLowerCase() &&
        c.vendedorId === req.vendedorId &&
        c.activo !== false
    );
    if (!exists) {
      const seller = state.users.find((u) => u.id === req.vendedorId);
      state.clients.push(
        normalizeClient({
          id: createId('cli'),
          nombre: req.nombre,
          contacto: req.contacto,
          telefono: req.telefono || '',
          pais: seller?.pais || '',
          vendedorId: req.vendedorId,
          vendedorNombre: req.vendedorNombre,
          origen: 'aprobado',
          activo: true,
          createdAt: new Date().toISOString(),
        })
      );
    }
  }

  state.notifications.unshift({
    id: createId('ntf'),
    userId: req.vendedorId,
    tipo: decision === 'aprobado' ? 'cliente_aprobado' : 'cliente_rechazado',
    titulo:
      decision === 'aprobado'
        ? 'Solicitud de cliente aprobada'
        : 'Solicitud de cliente rechazada',
    mensaje:
      decision === 'aprobado'
        ? `Su solicitud para registrar “${req.nombre}” fue aprobada. Ya puede seleccionarlo en salidas y visitas.`
        : `Su solicitud para registrar “${req.nombre}” fue rechazada.${
            req.adminNote ? ` Motivo: ${req.adminNote}` : ''
          }`,
    leida: false,
    createdAt: new Date().toISOString(),
    requestId: req.id,
  });

  save(state);
  return { state: getState(), request: req };
}

export function getUserNotifications(userId) {
  return getState().notifications.filter((n) => n.userId === userId);
}

export function markNotificationsRead(userId) {
  const state = ensureMemory();
  state.notifications = state.notifications.map((n) =>
    n.userId === userId ? { ...n, leida: true } : n
  );
  save(state);
  return getState();
}

export function upsertUser(user) {
  const state = ensureMemory();
  const normalized = normalizeUser(user);
  const idx = state.users.findIndex((u) => u.id === normalized.id);
  if (idx >= 0) state.users[idx] = { ...state.users[idx], ...normalized };
  else state.users.push(normalized);
  save(state);
  return getState();
}

export function setUserCombustible(id, combustible_activo) {
  const state = ensureMemory();
  const idx = state.users.findIndex((u) => u.id === id);
  if (idx < 0) return getState();
  state.users[idx].combustible_activo = Boolean(combustible_activo);
  save(state);
  return getState();
}

export function deleteUser(id) {
  const state = ensureMemory();
  state.users = state.users.filter((u) => u.id !== id);
  save(state);
  return getState();
}


function lastSalidaKey(userId) {
  return `red-last-salida-${userId}`;
}

export function saveLastSalida(userId, coords) {
  sessionStorage.setItem(
    lastSalidaKey(userId),
    JSON.stringify({
      ...coords,
      savedAt: new Date().toISOString(),
    })
  );
}

export function getLastSalida(userId) {
  try {
    const raw = sessionStorage.getItem(lastSalidaKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Crea una salida pendiente tras enviar el registro a Make. */
export function createPendingSalida(data, seller) {
  const state = ensureMemory();
  if (!Array.isArray(state.salidas)) state.salidas = [];
  const salida = {
    id: createId('sal'),
    vendedorId: seller.id,
    vendedorNombre: seller.nombre || '',
    estado: 'pendiente',
    createdAt: new Date().toISOString(),
    visitedAt: null,
    fecha_registro_salida: data.fecha_registro_salida || '',
    hora_registro_salida: data.hora_registro_salida || '',
    cliente_registro_salida: data.cliente_registro_salida || '',
    contacto_registro_salida: data.contacto_registro_salida || '',
    telefono_registro_salida: data.telefono_registro_salida || '',
    tipo_registro_salida: data.tipo_registro_salida || '',
    punto_referencia: data.punto_referencia || '',
    objetivo_registro_salida: data.objetivo_registro_salida || '',
    latitud_registro_salidas: String(data.latitud_registro_salidas || ''),
    longitud_registro_salidas: String(data.longitud_registro_salidas || ''),
    gps_accuracy_salida: data.gps_accuracy_salida ?? null,
  };
  state.salidas.unshift(salida);
  save(state);
  saveLastSalida(seller.id, {
    latitud: salida.latitud_registro_salidas,
    longitud: salida.longitud_registro_salidas,
    cliente: salida.cliente_registro_salida,
    salidaId: salida.id,
  });
  return { state: getState(), salida };
}

export function getPendingSalidas(userId) {
  return (getState().salidas || []).filter(
    (s) => s.vendedorId === userId && s.estado === 'pendiente'
  );
}

export function getSalidaById(id) {
  return (getState().salidas || []).find((s) => s.id === id) || null;
}

export function markSalidaVisitada(id, extra = {}) {
  const state = ensureMemory();
  if (!Array.isArray(state.salidas)) state.salidas = [];
  const idx = state.salidas.findIndex((s) => s.id === id);
  if (idx < 0) return getState();
  state.salidas[idx] = {
    ...state.salidas[idx],
    estado: 'visitada',
    visitedAt: new Date().toISOString(),
    reporte_tardio: Boolean(extra.reporte_tardio),
    fecha_reporte_real: extra.fecha_reporte_real || '',
    dias_retraso: extra.dias_retraso || 0,
  };
  save(state);
  return getState();
}

/** Vendedores cuyo correo_jefe es el del usuario (su equipo por país). */
export function getTeamVendedores(user) {
  if (!user) return [];
  if (user.rol === 'admin') return getEjecutivos();
  const jefe = String(user.correo || '').trim().toLowerCase();
  if (!jefe) return [];
  return getEjecutivos().filter(
    (u) => String(u.correo_jefe || '').trim().toLowerCase() === jefe
  );
}

/** El jefe (o admin) programa una cita a un vendedor de su equipo. */
export function createCita(data, creator) {
  const state = ensureMemory();
  if (!Array.isArray(state.citas)) state.citas = [];
  const seller = state.users.find((u) => u.id === data.vendedorId);
  const cita = {
    id: createId('cit'),
    vendedorId: data.vendedorId || '',
    vendedorNombre: seller?.nombre || '',
    creadoPorId: creator.id,
    creadoPorNombre: creator.nombre || '',
    clienteId: data.clienteId || '',
    clienteNombre: String(data.clienteNombre || '').trim(),
    contacto: String(data.contacto || '').trim(),
    telefono: String(data.telefono || '').trim(),
    fecha: data.fecha || '',
    hora: data.hora || '',
    objetivo: String(data.objetivo || '').trim(),
    estado: 'programada',
    salidaId: null,
    createdAt: new Date().toISOString(),
  };
  state.citas.unshift(cita);
  state.notifications.unshift({
    id: createId('ntf'),
    userId: cita.vendedorId,
    tipo: 'cita_programada',
    titulo: 'Cita programada',
    mensaje: `${creator.nombre} le programó una visita a “${cita.clienteNombre}” el ${cita.fecha}${cita.hora ? ` a las ${cita.hora}` : ''}.`,
    leida: false,
    createdAt: new Date().toISOString(),
    citaId: cita.id,
  });
  save(state);
  return { state: getState(), cita };
}

export function getCitasForUser(userId) {
  return (getState().citas || []).filter((c) => c.vendedorId === userId);
}

export function getCitaById(id) {
  return (getState().citas || []).find((c) => c.id === id) || null;
}

export function markCitaRegistrada(citaId, salidaId) {
  const state = ensureMemory();
  const cita = (state.citas || []).find((c) => c.id === citaId);
  if (!cita) return getState();
  cita.estado = 'registrada';
  cita.salidaId = salidaId || null;
  save(state);
  return getState();
}

export function cancelCita(citaId) {
  const state = ensureMemory();
  const cita = (state.citas || []).find((c) => c.id === citaId);
  if (!cita) return getState();
  cita.estado = 'cancelada';
  save(state);
  return getState();
}

export const CATALOG_META = [
  { key: 'tipos_salida', title: 'Tipos de salida', hint: 'Opciones del formulario de registro de salida' },
  { key: 'tipos_visita', title: 'Tipos de visita', hint: 'Opciones del reporte de visita' },
  { key: 'tipos_transporte', title: 'Tipos de transporte', hint: 'Moto, carro u otros' },
  { key: 'tipos_pago', title: 'Tipos de pago de combustible', hint: 'Conteo, kilometraje u otros' },
];
