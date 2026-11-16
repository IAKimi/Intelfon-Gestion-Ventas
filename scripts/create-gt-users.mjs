/**
 * Crea/actualiza DMORATAYA y JCIFUNTES en producción.
 * node scripts/create-gt-users.mjs
 */
const BASE =
  process.env.BASE_URL || 'https://ldda7xmuo9srl7t5wd1p0v4c.207.244.239.237.sslip.io';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Ventas1234';

const NEW_USERS = [
  {
    alias: 'DMORATAYA',
    password: 'DMORATAYA123',
    nombre: 'David Morataya',
    correo: 'DMORATAYA@red.com.gt',
  },
  {
    alias: 'JCIFUNTES',
    password: 'JCIFUNTES123',
    nombre: 'Joel Cifuentes',
    correo: 'JCIFUNTES@red.com.gt',
  },
];

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function api(pathname, { method = 'GET', body, token } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${pathname}`);
  return data;
}

function buildUser(profile, existing) {
  return {
    id: existing?.id || createId('vend'),
    usuario: profile.alias,
    password: profile.password,
    nombre: profile.nombre,
    cargo: existing?.cargo || 'Ejecutivo de Ventas',
    sucursal: 'Guatemala',
    correo: profile.correo,
    correo_jefe: existing?.correo_jefe || '',
    rol: 'vendedor',
    pais: 'GT',
    combustible_activo: false,
    activo: true,
    tipos_salida: existing?.tipos_salida || [],
    tipos_visita: existing?.tipos_visita || [],
    tipos_transporte: existing?.tipos_transporte || [],
    tipos_pago: existing?.tipos_pago || [],
    transporte_default: existing?.transporte_default || 'Moto',
    pago_combustible_default: existing?.pago_combustible_default || 'Legacy Intelfon',
  };
}

async function main() {
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { usuario: ADMIN_USER, password: ADMIN_PASS },
  });
  const token = login.token;
  const state = await api('/api/state', { token });
  const users = [...(state.users || [])];

  for (const profile of NEW_USERS) {
    const alias = profile.alias.toLowerCase();
    const correo = profile.correo.toLowerCase();
    const idx = users.findIndex(
      (u) =>
        String(u.usuario || '').toLowerCase() === alias ||
        String(u.correo || '').toLowerCase() === correo ||
        String(u.nombre || '').trim().toLowerCase() === profile.nombre.toLowerCase()
    );
    const next = buildUser(profile, idx >= 0 ? users[idx] : null);
    if (idx >= 0) {
      users[idx] = { ...users[idx], ...next };
      console.log(`Actualizado: ${profile.alias} (${users[idx].id})`);
    } else {
      users.push(next);
      console.log(`Creado: ${profile.alias} (${next.id})`);
    }
  }

  await api('/api/state', {
    method: 'PUT',
    token,
    body: {
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
      users,
    },
  });

  for (const profile of NEW_USERS) {
    const check = await api('/api/auth/login', {
      method: 'POST',
      body: { usuario: profile.alias, password: profile.password },
    });
    console.log(`Login OK ${profile.alias} → ${check.user?.nombre} (${check.user?.correo})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
