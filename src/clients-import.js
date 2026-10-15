import * as XLSX from 'xlsx';

function normHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function rowMap(row) {
  const map = {};
  for (const [k, v] of Object.entries(row)) {
    map[normHeader(k)] = v;
  }
  return map;
}

function pick(map, ...keys) {
  for (const k of keys) {
    const v = map[normHeader(k)];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

function roleFrom(map, prefix) {
  const p = normHeader(prefix);
  return {
    nombre: pick(map, `${p}: nombre`, `${p} nombre`),
    tel_fijo: pick(map, `${p}: tel fijo`, `${p} tel fijo`),
    celular: pick(map, `${p}: celular`, `${p} celular`),
    correo: pick(map, `${p}: correo`, `${p} correo`),
  };
}

/** Prioridad: GG → GO → GF. */
export function resolveContactoPrincipal(gg, go, gf) {
  for (const [rol, data] of [
    ['GG', gg],
    ['GO', go],
    ['GF', gf],
  ]) {
    if (data?.nombre) {
      return {
        contacto_rol: rol,
        contacto: data.nombre,
        telefono: data.celular || data.tel_fijo || '',
        correo_contacto: data.correo || '',
        telefono_fijo: data.tel_fijo || '',
      };
    }
  }
  return {
    contacto_rol: '',
    contacto: '',
    telefono: '',
    correo_contacto: '',
    telefono_fijo: '',
  };
}

export function shouldOmitRow({ pais, codigo, cliente, ejecutivo }) {
  const el = String(ejecutivo || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const cl = String(cliente || '').toLowerCase();
  if (!cliente) return true;
  if (el.includes('ningun empleado')) return true;
  if (cl.includes('intelfon guatemala')) return true;
  if (pais === 'GT' && codigo === 'CL000001' && cl.includes('intelfon')) return true;
  return false;
}

/**
 * Parsea Excel/CSV INTELFON o formato simple.
 * @returns {{ rows: Array, omitted: number }}
 */
export async function parseClientFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return parseClientRows(raw);
}

export function parseClientRows(raw) {
  const rows = [];
  let omitted = 0;

  for (const row of raw) {
    const map = rowMap(row);
    const hasPais = Boolean(map.pais || map.country);
    const hasEjecutivo = Boolean(map.ejecutivo || map.vendedor);

    if (hasPais || hasEjecutivo || map.codigo) {
      const pais = pick(map, 'pais', 'country').toUpperCase() || 'SV';
      const codigo = pick(map, 'codigo', 'code', 'cod');
      const cliente = pick(map, 'cliente', 'nombre', 'empresa');
      const ejecutivo = pick(map, 'ejecutivo', 'vendedor');
      const gg = roleFrom(map, 'GG');
      const gf = roleFrom(map, 'GF');
      const go = roleFrom(map, 'GO');
      const primary = resolveContactoPrincipal(gg, go, gf);

      if (shouldOmitRow({ pais, codigo, cliente, ejecutivo })) {
        omitted += 1;
        continue;
      }

      rows.push({
        pais: pais === 'GT' ? 'GT' : 'SV',
        codigo,
        nombre: cliente,
        ejecutivo,
        ...primary,
        gg,
        go,
        gf,
      });
      continue;
    }

    const nombre = pick(map, 'nombre', 'empresa', 'cliente', 'nombre (empresa o cliente)');
    const contacto = pick(map, 'contacto', 'nombre de contacto', 'nombre contacto', 'contact');
    const telefono = pick(map, 'telefono', 'tel', 'celular', 'movil', 'phone');
    if (!nombre) {
      omitted += 1;
      continue;
    }
    rows.push({
      pais: '',
      codigo: '',
      nombre,
      ejecutivo: '',
      contacto,
      telefono,
      correo_contacto: '',
      telefono_fijo: '',
      contacto_rol: '',
      gg: null,
      go: null,
      gf: null,
    });
  }

  return { rows, omitted };
}
