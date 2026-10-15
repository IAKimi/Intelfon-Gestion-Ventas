/**
 * Carga usuarios + cartera INTELFON en producción (o BASE_URL).
 * node scripts/seed-cartera-prod.mjs
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { parseClientRows, shouldOmitRow } from '../src/clients-import.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE =
  process.env.BASE_URL || 'https://ldda7xmuo9srl7t5wd1p0v4c.207.244.239.237.sslip.io';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'VentasINTELFON12345';
const EXCEL =
  process.env.EXCEL_PATH ||
  path.join(
    process.env.USERPROFILE || '',
    'Downloads',
    'BASE DE DATOS ACTUALIZADA por ejecutivo.xlsx'
  );
const OUT_DIR =
  process.env.OUT_DIR || path.join(process.env.USERPROFILE || '', 'Desktop', 'JSONs Intelfon');

/** ejecutivo Excel (lower) → perfil */
const EXEC_MAP = {
  'carlos alfredo abrego cea': {
    correo: 'Cabrego@red.com.sv',
    nombre: 'Carlos Alfredo Abrego Cea',
    pais: 'SV',
    cargo: 'Jefe de ventas',
  },
  'esau vides': {
    correo: 'Eevides@red.com.sv',
    nombre: 'Esau Vides',
    pais: 'SV',
    cargo: 'Ejecutivo de Ventas',
  },
  'pedro antonio aguilar': {
    correo: 'Paguilar@red.com.sv',
    nombre: 'Pedro Antonio Aguilar',
    pais: 'SV',
    cargo: 'Ejecutivo de Ventas',
  },
  'mario ceron': {
    correo: 'Mceron@red.com.sv',
    nombre: 'Mario Ceron',
    pais: 'SV',
    cargo: 'Ejecutivo de Ventas',
  },
  'carlos mauricio kreitz': {
    correo: 'Ckreitz@red.com.sv',
    nombre: 'Carlos Mauricio Kreitz',
    pais: 'SV',
    cargo: 'Ejecutivo de Ventas',
  },
  'anyelo francisco hernandez': {
    correo: 'Ahernandez@red.com.sv',
    nombre: 'Anyelo Francisco Hernandez',
    pais: 'SV',
    cargo: 'Ejecutivo de Ventas',
  },
  'alexandra londono rubio': {
    correo: 'Alondono@red.com.gt',
    nombre: 'Alexandra Londono Rubio',
    pais: 'GT',
    cargo: 'Jefa de ventas',
  },
  'chelsea fuentes': {
    correo: 'Rfuentes@red.com.gt',
    nombre: 'Chelsea Fuentes',
    pais: 'GT',
    cargo: 'Ejecutivo de Ventas',
  },
  'gabriela herrera': {
    correo: 'gherrera@red.com.gt',
    nombre: 'Gabriela Herrera',
    pais: 'GT',
    cargo: 'Ejecutivo de Ventas',
  },
  'jorge obed hernandez': {
    correo: 'ohernandez@red.com.gt',
    nombre: 'Jorge Obed Hernandez',
    pais: 'GT',
    cargo: 'Ejecutivo de Ventas',
  },
  'silvia lucia conde': {
    correo: 'sconde@red.com.gt',
    nombre: 'Silvia Lucia Conde',
    pais: 'GT',
    cargo: 'Ejecutivo de Ventas',
  },
  'jaqueline mabel flores ixcajoc': {
    correo: 'jflores@red.com.gt',
    nombre: 'Jaqueline Mabel Flores Ixcajoc',
    pais: 'GT',
    cargo: 'Ejecutivo de Ventas',
  },
};

function normName(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function passwordFromEmail(correo) {
  const local = String(correo).split('@')[0];
  return `${local.toLowerCase()}12345`;
}

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

function buildUser(profile) {
  return {
    id: createId('vend'),
    usuario: profile.correo,
    password: passwordFromEmail(profile.correo),
    nombre: profile.nombre,
    cargo: profile.cargo,
    sucursal: profile.pais === 'GT' ? 'Guatemala' : 'El Salvador',
    correo: profile.correo,
    correo_jefe: '',
    rol: 'vendedor',
    pais: profile.pais,
    combustible_activo: true,
    activo: true,
    tipos_salida: [],
    tipos_visita: [],
    tipos_transporte: [],
    tipos_pago: [],
    transporte_default: 'Moto',
    pago_combustible_default: 'Pago por conteo',
  };
}

function main() {
  return (async () => {
    if (!fs.existsSync(EXCEL)) throw new Error(`No existe Excel: ${EXCEL}`);

    const wb = XLSX.readFile(EXCEL);
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

    // Filas omitidas / no mapeadas (para Excel aparte)
    const noAsignados = [];
    for (const row of raw) {
      const pais = String(row['País'] || '').trim().toUpperCase();
      const codigo = String(row['Código'] || '').trim();
      const cliente = String(row['Cliente'] || '').trim();
      const ejecutivo = String(row['Ejecutivo'] || '').trim();
      if (shouldOmitRow({ pais, codigo, cliente, ejecutivo })) {
        noAsignados.push({
          motivo: 'Omitido (Intelfon / sin empleado)',
          País: pais,
          Código: codigo,
          Cliente: cliente,
          Ejecutivo: ejecutivo,
        });
        continue;
      }
      if (!EXEC_MAP[normName(ejecutivo)]) {
        noAsignados.push({
          motivo: 'Sin usuario/correo mapeado',
          País: pais,
          Código: codigo,
          Cliente: cliente,
          Ejecutivo: ejecutivo,
          'GG Nombre': row['GG: Nombre'],
          'GG Celular': row['GG: Celular'],
          'GO Nombre': row['GO: Nombre'],
          'GO Celular': row['GO: Celular'],
          'GF Nombre': row['GF: Nombre'],
          'GF Celular': row['GF: Celular'],
        });
      }
    }

    const { rows, omitted } = parseClientRows(raw);
    console.log(`Parse: ${rows.length} filas útiles, omitted parse=${omitted}`);

    const login = await api('/api/auth/login', {
      method: 'POST',
      body: { usuario: ADMIN_USER, password: ADMIN_PASS, rol: 'admin' },
    });
    const token = login.token;
    const state = await api('/api/state', { token });

    const adminUsers = (state.users || []).filter((u) => u.rol === 'admin');
    const byCorreo = new Map();
    for (const u of state.users || []) {
      if (u.correo) byCorreo.set(String(u.correo).toLowerCase(), u);
      byCorreo.set(String(u.usuario).toLowerCase(), u);
    }

    const users = [...adminUsers];
    const sellerByExec = new Map();

    for (const [key, profile] of Object.entries(EXEC_MAP)) {
      const correoKey = profile.correo.toLowerCase();
      let user = byCorreo.get(correoKey);
      if (user) {
        user = {
          ...user,
          usuario: profile.correo,
          correo: profile.correo,
          nombre: profile.nombre,
          cargo: profile.cargo,
          pais: profile.pais,
          sucursal: profile.pais === 'GT' ? 'Guatemala' : 'El Salvador',
          rol: 'vendedor',
          activo: true,
          password: passwordFromEmail(profile.correo),
          transporte_default: user.transporte_default || 'Moto',
          pago_combustible_default: user.pago_combustible_default || 'Pago por conteo',
        };
      } else {
        user = buildUser(profile);
      }
      users.push(user);
      sellerByExec.set(key, user);
      console.log(`User OK: ${user.correo} / ${user.password}`);
    }

    // Demo vendedor: conservar si no choca
    for (const u of state.users || []) {
      if (u.rol !== 'vendedor') continue;
      const key = String(u.correo || u.usuario || '').toLowerCase();
      if ([...sellerByExec.values()].some((s) => s.id === u.id)) continue;
      if (users.some((x) => x.id === u.id)) continue;
      if (EXEC_MAP[normName(u.nombre)]) continue;
      // no re-agregar stubs viejos de import masivo
      if (!u.correo && String(u.usuario || '').includes('.')) continue;
      if (key && !users.some((x) => String(x.correo || x.usuario).toLowerCase() === key)) {
        users.push(u);
      }
    }

    const clients = [];
    let assigned = 0;
    for (const row of rows) {
      const seller = sellerByExec.get(normName(row.ejecutivo));
      if (!seller) continue;
      clients.push({
        id: createId('cli'),
        codigo: row.codigo || '',
        nombre: row.nombre,
        contacto: row.contacto || '',
        telefono: row.telefono || '',
        telefono_fijo: row.telefono_fijo || '',
        correo_contacto: row.correo_contacto || '',
        contacto_rol: row.contacto_rol || '',
        gg: row.gg || null,
        go: row.go || null,
        gf: row.gf || null,
        pais: row.pais,
        vendedorId: seller.id,
        vendedorNombre: seller.nombre,
        origen: 'import',
        activo: true,
        createdAt: new Date().toISOString(),
      });
      assigned += 1;
    }

    const payload = {
      combustibleGlobal: state.combustibleGlobal,
      catalogoClientesActivo: true,
      webhookUrl: state.webhookUrl,
      correo_ventas: state.correo_ventas,
      catalogos: state.catalogos,
      clients,
      clientRequests: state.clientRequests || [],
      notifications: state.notifications || [],
      salidas: state.salidas || [],
      users,
    };

    await api('/api/state', { method: 'PUT', body: payload, token });
    console.log(`PUT OK: ${users.length} users, ${clients.length} clients assigned=${assigned}`);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const outPath = path.join(OUT_DIR, 'Clientes-NO-ASIGNADOS-Intelfon.xlsx');
    const outWb = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(noAsignados);
    XLSX.utils.book_append_sheet(outWb, sheet, 'No asignados');
    XLSX.writeFile(outWb, outPath);
    console.log(`Excel no asignados (${noAsignados.length}): ${outPath}`);

    const summary = {};
    for (const c of clients) {
      summary[c.vendedorNombre] = (summary[c.vendedorNombre] || 0) + 1;
    }
    console.log('Cartera por ejecutivo:', summary);
  })();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
