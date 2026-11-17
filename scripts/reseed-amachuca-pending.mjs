/**
 * Limpia salidas pendientes de amachuca y crea 4 nuevas:
 * 2 hoy, 1 viernes, 1 próxima semana. Deja un cliente libre para demo en vivo.
 *
 * Uso:
 *   node scripts/reseed-amachuca-pending.mjs
 * Env:
 *   PROD_URL, ADMIN_USER, ADMIN_PASS
 */
const PROD_URL = (process.env.PROD_URL || 'https://ldda7xmuo9srl7t5wd1p0v4c.207.244.239.237.sslip.io').replace(
  /\/+$/,
  ''
);
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Ventas1234';
const TARGET_EMAIL = 'amachuca@iakimi.com';

function isoDay(offsetDays = 0) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function nextWeekday(targetWd) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  const cur = d.getDay();
  let add = (targetWd - cur + 7) % 7;
  if (add === 0) add = 7;
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
}

function id(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${PROD_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${method} ${path} → ${res.status}`);
  return data;
}

const login = await api('/api/auth/login', {
  method: 'POST',
  body: { usuario: ADMIN_USER, password: ADMIN_PASS },
});
const token = login.token;
const state = await api('/api/state', { token });

const seller = (state.users || []).find(
  (u) => String(u.correo || '').toLowerCase() === TARGET_EMAIL
);
if (!seller) throw new Error(`No está ${TARGET_EMAIL}`);

const clients = (state.clients || []).filter(
  (c) => c.vendedorId === seller.id && c.activo !== false && c.tipo !== 'prospecto'
);
if (clients.length < 5) {
  throw new Error(`Se necesitan ≥5 clientes; hay ${clients.length}`);
}

const keptFree = clients[0];
const used = clients.slice(1, 5);
const hoy = isoDay(0);
const viernes = nextWeekday(5);
const proxSem = isoDay(7);

const dates = [
  { fecha: hoy, hora: '09:00', cliente: used[0] },
  { fecha: hoy, hora: '14:30', cliente: used[1] },
  { fecha: viernes, hora: '10:00', cliente: used[2] },
  { fecha: proxSem, hora: '11:00', cliente: used[3] },
];

const salidas = (state.salidas || []).filter(
  (s) => !(s.vendedorId === seller.id && s.estado === 'pendiente')
);

for (const row of dates) {
  salidas.unshift({
    id: id('sal'),
    vendedorId: seller.id,
    vendedorNombre: seller.nombre || '',
    estado: 'pendiente',
    createdAt: new Date().toISOString(),
    visitedAt: null,
    fecha_registro_salida: row.fecha,
    hora_registro_salida: row.hora,
    cliente_registro_salida: row.cliente.nombre,
    contacto_registro_salida: row.cliente.contacto || '',
    telefono_registro_salida: row.cliente.telefono || '',
    tipo_registro_salida: 'Visita comercial',
    punto_referencia: row.cliente.ubicacion || 'Referencia demo',
    objetivo_registro_salida: 'Visita de capacitación / demo',
    latitud_registro_salidas: '13.6929',
    longitud_registro_salidas: '-89.2182',
    gps_accuracy_salida: 25,
  });
}

await api('/api/state', {
  method: 'PUT',
  token,
  body: { ...state, salidas },
});

console.log(
  JSON.stringify(
    {
      ok: true,
      seller: seller.correo,
      pending: dates.map((d) => ({
        fecha: d.fecha,
        hora: d.hora,
        cliente: d.cliente.nombre,
      })),
      libre_para_demo: keptFree.nombre,
    },
    null,
    2
  )
);
