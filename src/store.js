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
  catalogos: structuredClone(DEFAULT_CATALOGOS),
  clients: [],
  clientRequests: [],
  contactChanges: [],
  notifications: [],
  salidas: [],
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

export function normalizeClient(c) {
  const pais = String(c.pais || '').trim().toUpperCase();
  return {
    id: c.id || createId('cli'),
    codigo: String(c.codigo || '').trim(),
    nombre: String(c.nombre || '').trim(),
    contacto: String(c.contacto || '').trim(),
    telefono: String(c.telefono || '').trim(),
    telefono_fijo: String(c.telefono_fijo || '').trim(),
    correo_contacto: String(c.correo_contacto || '').trim(),
    contacto_rol: String(c.contacto_rol || '').trim(),
    gg: normalizeRole(c.gg),
    go: normalizeRole(c.go),
    gf: normalizeRole(c.gf),
    pais: pais === 'GT' || pais === 'SV' ? pais : '',
    vendedorId: c.vendedorId || '',
    vendedorNombre: String(c.vendedorNombre || '').trim(),
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
    catalogos: normalizeCatalogos(payload.catalogos),
    clients: (Array.isArray(payload.clients) ? payload.clients : []).map(normalizeClient),
    clientRequests: Array.isArray(payload.clientRequests) ? payload.clientRequests : [],
    contactChanges: Array.isArray(payload.contactChanges) ? payload.contactChanges : [],
    notifications: Array.isArray(payload.notifications) ? payload.notifications : [],
    salidas: Array.isArray(payload.salidas) ? payload.salidas : [],
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
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    if (syncing) return;
    syncing = true;
    try {
      const state = ensureMemory();
      const payload = await apiPutState({
        combustibleGlobal: state.combustibleGlobal,
        catalogoClientesActivo: state.catalogoClientesActivo,
        webhookUrl: state.webhookUrl,
        correo_ventas: state.correo_ventas,
        catalogos: state.catalogos,
        clients: state.clients,
        clientRequests: state.clientRequests,
        contactChanges: state.contactChanges || [],
        notifications: state.notifications,
        salidas: state.salidas,
        users: state.users,
      });
      applyRemotePayload(payload, state.session);
    } catch (err) {
      console.warn('Sync remoto falló', err);
    } finally {
      syncing = false;
    }
  }, 250);
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

/** @param {'admin' | 'vendedor'} expectedRole */
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
  const user = state.users.find(
    (u) =>
      matchesLogin(u, usuario) &&
      u.password === password &&
      u.activo &&
      u.rol === expectedRole
  );
  if (!user) return null;
  setSession(user);
  return user;
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

export function updateConfig({ combustibleGlobal, webhookUrl, correo_ventas, catalogoClientesActivo }) {
  const state = ensureMemory();
  if (typeof combustibleGlobal === 'boolean') state.combustibleGlobal = combustibleGlobal;
  if (typeof catalogoClientesActivo === 'boolean') state.catalogoClientesActivo = catalogoClientesActivo;
  if (typeof webhookUrl === 'string') state.webhookUrl = webhookUrl.trim();
  if (typeof correo_ventas === 'string') state.correo_ventas = correo_ventas.trim();
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

/** Importa cartera INTELFON: crea stubs de ejecutivos y asigna clientes. */
export function importClients(rows, { omittedFile = 0 } = {}) {
  const state = ensureMemory();
  let added = 0;
  let updated = 0;
  let skipped = 0;
  let usersCreated = 0;
  const beforeUsers = state.users.length;

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

    const next = normalizeClient({
      codigo: row.codigo,
      nombre,
      contacto: row.contacto,
      telefono: row.telefono,
      telefono_fijo: row.telefono_fijo,
      correo_contacto: row.correo_contacto,
      contacto_rol: row.contacto_rol,
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
      state.clients[idx] = {
        ...state.clients[idx],
        ...next,
        id: state.clients[idx].id,
        createdAt: state.clients[idx].createdAt,
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

export function createClientRequest({ nombre, contacto, telefono, notas }, seller) {
  const state = ensureMemory();
  const req = {
    id: createId('req'),
    nombre: String(nombre || '').trim(),
    contacto: String(contacto || '').trim(),
    telefono: String(telefono || '').trim(),
    notas: String(notas || '').trim(),
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

  if (decision === 'aprobado') {
    const exists = state.clients.some(
      (c) => c.nombre.toLowerCase() === req.nombre.toLowerCase() && c.activo !== false
    );
    if (!exists) {
      state.clients.push({
        id: createId('cli'),
        nombre: req.nombre,
        contacto: req.contacto,
        telefono: req.telefono || '',
        origen: 'aprobado',
        activo: true,
        createdAt: new Date().toISOString(),
        solicitadoPor: req.vendedorNombre,
      });
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

export function markSalidaVisitada(id) {
  const state = ensureMemory();
  if (!Array.isArray(state.salidas)) state.salidas = [];
  const idx = state.salidas.findIndex((s) => s.id === id);
  if (idx < 0) return getState();
  state.salidas[idx] = {
    ...state.salidas[idx],
    estado: 'visitada',
    visitedAt: new Date().toISOString(),
  };
  save(state);
  return getState();
}

export const CATALOG_META = [
  { key: 'tipos_salida', title: 'Tipos de salida', hint: 'Opciones del formulario de registro de salida' },
  { key: 'tipos_visita', title: 'Tipos de visita', hint: 'Opciones del reporte de visita' },
  { key: 'tipos_transporte', title: 'Tipos de transporte', hint: 'Moto, carro u otros' },
  { key: 'tipos_pago', title: 'Tipos de pago de combustible', hint: 'Conteo, kilometraje u otros' },
];
