/**
 * Crea/actualiza usuarios SAC El Salvador en producción.
 * node scripts/create-sv-sac-users.mjs
 */
const BASE =
  process.env.BASE_URL || 'https://ldda7xmuo9srl7t5wd1p0v4c.207.244.239.237.sslip.io';
const ADMIN_USER = process.env.ADMIN_USER || 'admin@red.com.sv';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Ventas1234';

const SAC_USERS = [
  {
    nombre: 'Emerson Gomez',
    correo: 'egomez@red.com.sv',
  },
  {
    nombre: 'Jonathan Palacios',
    correo: 'mpalacios@red.com.sv',
  },
  {
    nombre: 'Kenny Soriano',
    correo: 'ksoriano@red.com.sv',
  },
  {
    nombre: 'Krisia Mazariego',
    correo: 'kmazariego@red.com.sv',
  },
  {
    nombre: 'Raúl Ramírez',
    correo: 'rramirez@red.com.sv',
  },
];

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function aliasOf(correo) {
  return String(correo || '')
    .split('@')[0]
    .trim()
    .toLowerCase();
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
  const correo = profile.correo;
  const alias = aliasOf(correo);
  return {
    id: existing?.id || createId('sac'),
    usuario: correo,
    password: `${alias}12345`,
    nombre: profile.nombre,
    cargo: existing?.cargo || 'Servicio al cliente',
    sucursal: existing?.sucursal || 'El Salvador',
    correo,
    correo_jefe: existing?.correo_jefe || 'Cabrego@red.com.sv',
    rol: 'sac',
    pais: 'SV',
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
  const created = [];

  for (const profile of SAC_USERS) {
    const correo = profile.correo.toLowerCase();
    const idx = users.findIndex(
      (u) =>
        String(u.correo || '').toLowerCase() === correo ||
        String(u.usuario || '').toLowerCase() === correo
    );
    const next = buildUser(profile, idx >= 0 ? users[idx] : null);
    if (idx >= 0) {
      users[idx] = { ...users[idx], ...next };
      console.log(`Actualizado: ${profile.correo} (${users[idx].id}) → ${next.password}`);
    } else {
      users.push(next);
      console.log(`Creado: ${profile.correo} (${next.id}) → ${next.password}`);
    }
    created.push({
      nombre: next.nombre,
      correo: next.correo,
      password: next.password,
      rol: next.rol,
      pais: next.pais,
    });
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

  console.log('--- VERIFY ---');
  for (const u of created) {
    try {
      const r = await api('/api/auth/login', {
        method: 'POST',
        body: { usuario: u.correo, password: u.password },
      });
      console.log(
        `LOGIN OK ${u.correo} rol=${r.user?.rol} pais=${r.user?.pais} clients=${(r.state?.clients || []).length}`
      );
    } catch (e) {
      console.log(`LOGIN FAIL ${u.correo}: ${e.message}`);
    }
  }

  console.log(JSON.stringify(created, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
