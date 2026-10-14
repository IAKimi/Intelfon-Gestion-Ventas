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

function pickNombre(row) {
  const map = rowMap(row);
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
  const map = rowMap(row);
  return (
    map.contacto ||
    map['nombre de contacto'] ||
    map['nombre contacto'] ||
    map.contact ||
    map.persona ||
    ''
  );
}

function pickTelefono(row) {
  const map = rowMap(row);
  return (
    map.telefono ||
    map.tel ||
    map.celular ||
    map.movil ||
    map.phone ||
    map.whatsapp ||
    ''
  );
}

/**
 * Lee un File (.csv, .xlsx, .xls) y devuelve filas { nombre, contacto, telefono }.
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
    const telefono = String(pickTelefono(row) || '').trim();
    if (!nombre) continue;
    clients.push({ nombre, contacto, telefono });
  }
  return clients;
}
