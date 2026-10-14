import * as XLSX from 'xlsx';

function normHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function pickNombre(row) {
  const map = {};
  for (const [k, v] of Object.entries(row)) {
    map[normHeader(k)] = v;
  }
  return (
    map.nombre ||
    map.empresa ||
    map.cliente ||
    map['nombre (empresa o cliente)'] ||
    map['nombre empresa'] ||
    map.company ||
    ''
  );
}

function pickContacto(row) {
  const map = {};
  for (const [k, v] of Object.entries(row)) {
    map[normHeader(k)] = v;
  }
  return map.contacto || map.contact || map.telefono || map.email || map.correo || '';
}

/**
 * Lee un File (.csv, .xlsx, .xls) y devuelve filas { nombre, contacto }.
 */
export async function parseClientFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const clients = [];
  for (const row of rows) {
    const nombre = String(pickNombre(row) || '').trim();
    const contacto = String(pickContacto(row) || '').trim();
    if (!nombre) continue;
    clients.push({ nombre, contacto });
  }
  return clients;
}
