/**
 * Build Make import JSON with case-insensitive pago/transporte formulas.
 * Writes to Desktop/JSONs Intelfon — does NOT call Make MCP.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, '.tmp-mcp-update-args-only.json');
const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
const bp = raw.blueprint;

const REPLACEMENTS = [
  [
    '1.tipo_pago_combustible = "Pago por Kilometraje"',
    'lower(trim(1.tipo_pago_combustible)) = "pago por kilometraje"',
  ],
  [
    '1.tipo_pago_combustible = "Pago por Conteo"',
    'lower(trim(1.tipo_pago_combustible)) = "pago por conteo"',
  ],
  [
    '1.tipo_transporte = "Moto"',
    'lower(trim(1.tipo_transporte)) = "moto"',
  ],
  [
    '1.tipo_transporte = "Carro"',
    'lower(trim(1.tipo_transporte)) = "carro"',
  ],
  [
    '78.`12` = "Pago por Conteo"',
    'lower(trim(78.`12`)) = "pago por conteo"',
  ],
  [
    '78.`12` = "Pago por Kilometraje"',
    'lower(trim(78.`12`)) = "pago por kilometraje"',
  ],
  [
    '78.`13` = "Moto"',
    'lower(trim(78.`13`)) = "moto"',
  ],
  [
    '78.`13` = "Carro"',
    'lower(trim(78.`13`)) = "carro"',
  ],
];

function fixFormulas(obj) {
  if (typeof obj === 'string') {
    let s = obj;
    for (const [from, to] of REPLACEMENTS) {
      if (s.includes(from)) s = s.split(from).join(to);
    }
    return s;
  }
  if (Array.isArray(obj)) return obj.map(fixFormulas);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = fixFormulas(v);
    return out;
  }
  return obj;
}

const fixed = fixFormulas(bp);

const wh = fixed.flow.find((m) => m.id === 1);
if (wh?.metadata?.interface) {
  const names = new Set(wh.metadata.interface.map((i) => i.name));
  for (const e of [
    { name: 'telefono_registro_salida', type: 'text' },
    { name: 'telefono_reporte_visitas', type: 'text' },
    { name: 'telefono_cliente', type: 'text' },
  ]) {
    if (!names.has(e.name)) wh.metadata.interface.push(e);
  }
}

const importBp = {
  name: fixed.name,
  flow: fixed.flow,
  metadata: fixed.metadata,
};

const outDir = path.join(process.env.USERPROFILE || 'C:\\Users\\IAKIMI', 'Desktop', 'JSONs Intelfon');
fs.mkdirSync(outDir, { recursive: true });

const pretty = path.join(outDir, 'Automatizacion-Ventas-INTELFON-6621785-fix-casing.json');
const min = path.join(outDir, 'Automatizacion-Ventas-INTELFON-6621785-fix-casing.min.json');
const readme = path.join(outDir, 'LEEME-importar-Make.txt');

fs.writeFileSync(pretty, JSON.stringify(importBp, null, 2), 'utf8');
fs.writeFileSync(min, JSON.stringify(importBp), 'utf8');
fs.writeFileSync(
  readme,
  [
    'Automatización Ventas INTELFON — blueprint para importar en Make',
    '================================================================',
    '',
    'Archivo a importar:',
    '  Automatizacion-Ventas-INTELFON-6621785-fix-casing.json',
    '',
    'Qué cambió vs el flujo actual:',
    '  - Fórmulas de galones / monto_conteo (módulo 57) comparan con lower(trim(...))',
    '    para que "Pago por kilometraje" (app) coincida con "Pago por Kilometraje".',
    '  - Mismo ajuste en emails de visita (61, 62) y en reintegro (módulo 83).',
    '  - Interface del webhook: telefono_registro_salida, telefono_reporte_visitas, telefono_cliente.',
    '',
    'Cómo importar (manual — NO usar MCP):',
    '  1. Abrí escenario 6621785 en Make (us2.make.com).',
    '  2. Menú del escenario → Export/Import o "..." → Import blueprint',
    '     (o crear escenario nuevo y pegar blueprint si preferís no pisar).',
    '  3. Si Make pide re-mapear conexiones, usá las mismas:',
    '     - Google Sheets __IMTCONN__ 9391542',
    '     - Google Drive __IMTCONN__ 10403748',
    '     - Email account 10959496',
    '     - Hook 2931121',
    '  4. Guardá y activá.',
    '',
    'Probar visita con tipo_pago_combustible = "Pago por kilometraje" y Carro:',
    '  - distancia_km y distancia_ida_vuelta deben salir',
    '  - galones debe salir (~ distancia_ida_vuelta / 30), no null',
    '',
    'Nota GPS: si gps_accuracy_salida es ~10000, la distancia OSRM puede ser falsa',
    '(coordenada burda de salida). Eso es dato de la app, no de Make.',
    '',
  ].join('\n'),
  'utf8'
);

const txt = JSON.stringify(importBp);
const report = {
  outDir,
  pretty,
  prettyBytes: fs.statSync(pretty).size,
  remainingOldPagoChecks: (txt.match(/tipo_pago_combustible = "Pago por /g) || []).length,
  remainingOldSheetPago: (txt.match(/78\.`12` = "Pago por /g) || []).length,
  lowerKmCount: (txt.match(/pago por kilometraje/g) || []).length,
  lowerConteoCount: (txt.match(/pago por conteo/g) || []).length,
};
console.log(JSON.stringify(report, null, 2));
