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

function shouldOmitRow({ pais, codigo, cliente, ejecutivo }) {
  const el = ejecutivo.toLowerCase();
  const cl = cliente.toLowerCase();
  if (!cliente) return true;
  if (el.includes('ningun empleado') || el.includes('ningún empleado')) return true;
  if (cl.includes('intelfon guatemala')) return true;
  if (pais === 'GT' && codigo === 'CL000001' && cl.includes('intelfon')) return true;
  return false;
}

/**
 * Parsea Excel/CSV INTELFON (País…GG: Correo) o formato simple nombre/contacto/teléfono.
 * @returns {{ rows: Array, omitted: number }}
 */
export async function parseClientFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });

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
      const contacto = pick(map, 'gg: nombre', 'gg nombre', 'contacto', 'nombre de contacto');
      const telFijo = pick(map, 'gg: tel fijo', 'gg tel fijo', 'tel fijo', 'telefono fijo');
      const celular = pick(map, 'gg: celular', 'gg celular', 'celular', 'telefono', 'tel');
      const correo = pick(map, 'gg: correo', 'gg correo', 'correo', 'email');

      if (shouldOmitRow({ pais, codigo, cliente, ejecutivo })) {
        omitted += 1;
        continue;
      }

      rows.push({
        pais: pais === 'GT' ? 'GT' : 'SV',
        codigo,
        nombre: cliente,
        ejecutivo,
        contacto,
        telefono: celular || telFijo,
        correo_contacto: correo,
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
    });
  }

  return { rows, omitted };
}
