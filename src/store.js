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
  notifications: [],
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
    },
  ],
};

let remoteMode = false;
let memory = null;
let syncTimer = null;
let syncing = false;

function normalizeUser(u) {
  return {
    ...u,
    tipos_salida: Array.isArray(u.tipos_salida) ? u.tipos_salida : [],
    tipos_visita: Array.isArray(u.tipos_visita) ? u.tipos_visita : [],
    tipos_transporte: Array.isArray(u.tipos_transporte) ? u.tipos_transporte : [],
    tipos_pago: Array.isArray(u.tipos_pago) ? u.tipos_pago : [],
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
    clients: Array.isArray(payload.clients) ? payload.clients : [],
    clientRequests: Array.isArray(payload.clientRequests) ? payload.clientRequests : [],
    notifications: Array.isArray(payload.notifications) ? payload.notifications : [],
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
      clients: Array.isArray(parsed.clients) ? parsed.clients : [],
      clientRequests: Array.isArray(parsed.clientRequests) ? parsed.clientRequests : [],
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
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
        notifications: state.notifications,
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
  if (remoteMode) {
    return { ...data, session: data.session || null };
  }
  const sessionRaw = sessionStorage.getItem('red-session');
  let session = null;
  if (sessionRaw) {
    try {
      const partial = JSON.parse(sessionRaw);
      const fresh = data.users.find((u) => u.id === partial.id);
      session = fresh ? normalizeUser({ ...fresh, password: undefined }) : partial;
      delete session.password;
    } catch {
      session = null;
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

export function getActiveClients() {
  return getState().clients.filter((c) => c.activo !== false);
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

export function importClients(rows) {
  const state = ensureMemory();
  let added = 0;
  let skipped = 0;
  for (const row of rows) {
    const nombre = String(row.nombre || '').trim();
    const contacto = String(row.contacto || '').trim();
    if (!nombre) {
      skipped += 1;
      continue;
    }
    const exists = state.clients.some(
      (c) => c.nombre.toLowerCase() === nombre.toLowerCase() && c.activo !== false
    );
    if (exists) {
      skipped += 1;
      continue;
    }
    state.clients.push({
      id: createId('cli'),
      nombre,
      contacto,
      origen: 'import',
      activo: true,
      createdAt: new Date().toISOString(),
    });
    added += 1;
  }
  save(state);
  return { state: getState(), added, skipped };
}

export function deleteClient(id) {
  const state = ensureMemory();
  state.clients = state.clients.filter((c) => c.id !== id);
  save(state);
  return getState();
}

export function createClientRequest({ nombre, contacto, notas }, seller) {
  const state = ensureMemory();
  const req = {
    id: createId('req'),
    nombre: String(nombre || '').trim(),
    contacto: String(contacto || '').trim(),
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

export function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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

export const CATALOG_META = [
  { key: 'tipos_salida', title: 'Tipos de salida', hint: 'Opciones del formulario de registro de salida' },
  { key: 'tipos_visita', title: 'Tipos de visita', hint: 'Opciones del reporte de visita' },
  { key: 'tipos_transporte', title: 'Tipos de transporte', hint: 'Moto, carro u otros' },
  { key: 'tipos_pago', title: 'Tipos de pago de combustible', hint: 'Conteo, kilometraje u otros' },
];
