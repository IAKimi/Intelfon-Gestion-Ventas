import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

const DEFAULT_WEBHOOK_URL =
  process.env.WEBHOOK_URL ||
  'https://hook.us2.make.com/ow654uexjzi3zpullwocow1p0fbdcwvs';

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

const SEED_USERS = [
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
    transporte_default: '',
    pago_combustible_default: '',
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
    transporte_default: 'Moto',
    pago_combustible_default: 'Pago por conteo',
  },
];

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  // Coolify internal DNS often has no TLS
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function publicUser(row) {
  const pais = String(row.pais || '').trim().toUpperCase();
  return {
    id: row.id,
    usuario: row.usuario,
    nombre: row.nombre,
    cargo: row.cargo,
    sucursal: row.sucursal,
    correo: row.correo,
    correo_jefe: row.correo_jefe,
    rol: row.rol,
    pais: pais === 'GT' || pais === 'SV' ? pais : '',
    combustible_activo: row.combustible_activo,
    activo: row.activo,
    tipos_salida: row.tipos_salida || [],
    tipos_visita: row.tipos_visita || [],
    tipos_transporte: row.tipos_transporte || [],
    tipos_pago: row.tipos_pago || [],
    transporte_default: row.transporte_default || '',
    pago_combustible_default: row.pago_combustible_default || '',
  };
}

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      usuario TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      nombre TEXT NOT NULL DEFAULT '',
      cargo TEXT NOT NULL DEFAULT '',
      sucursal TEXT NOT NULL DEFAULT '',
      correo TEXT NOT NULL DEFAULT '',
      correo_jefe TEXT NOT NULL DEFAULT '',
      rol TEXT NOT NULL CHECK (rol IN ('admin', 'vendedor')),
      combustible_activo BOOLEAN NOT NULL DEFAULT TRUE,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      tipos_salida JSONB NOT NULL DEFAULT '[]'::jsonb,
      tipos_visita JSONB NOT NULL DEFAULT '[]'::jsonb,
      tipos_transporte JSONB NOT NULL DEFAULT '[]'::jsonb,
      tipos_pago JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_state (
      id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      combustible_global BOOLEAN NOT NULL DEFAULT TRUE,
      catalogo_clientes_activo BOOLEAN NOT NULL DEFAULT FALSE,
      webhook_url TEXT NOT NULL DEFAULT '',
      correo_ventas TEXT NOT NULL DEFAULT 'ventas@red.com.sv',
      catalogos JSONB NOT NULL DEFAULT '{}'::jsonb,
      clients JSONB NOT NULL DEFAULT '[]'::jsonb,
      client_requests JSONB NOT NULL DEFAULT '[]'::jsonb,
      notifications JSONB NOT NULL DEFAULT '[]'::jsonb,
      salidas JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_correo ON users(correo);
  `);

  await pool.query(`
    ALTER TABLE app_state
    ADD COLUMN IF NOT EXISTS salidas JSONB NOT NULL DEFAULT '[]'::jsonb
  `);

  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS transporte_default TEXT NOT NULL DEFAULT ''
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS pago_combustible_default TEXT NOT NULL DEFAULT ''
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS pais TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    UPDATE users
    SET transporte_default = 'Moto',
        pago_combustible_default = 'Pago por conteo'
    WHERE id = 'vend-1'
      AND (transporte_default = '' OR pago_combustible_default = '')
  `);

  const stateCount = await pool.query('SELECT COUNT(*)::int AS c FROM app_state');
  if (stateCount.rows[0].c === 0) {
    await pool.query(
      `INSERT INTO app_state (id, combustible_global, catalogo_clientes_activo, webhook_url, correo_ventas, catalogos, clients, client_requests, notifications)
       VALUES (1, TRUE, FALSE, $1, 'ventas@red.com.sv', $2::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
      [DEFAULT_WEBHOOK_URL, JSON.stringify(DEFAULT_CATALOGOS)]
    );
  }

  const userCount = await pool.query('SELECT COUNT(*)::int AS c FROM users');
  if (userCount.rows[0].c === 0) {
    for (const u of SEED_USERS) {
      const hash = await bcrypt.hash(u.password, 10);
      await pool.query(
        `INSERT INTO users (
          id, usuario, password_hash, nombre, cargo, sucursal, correo, correo_jefe, rol,
          combustible_activo, activo, tipos_salida, tipos_visita, tipos_transporte, tipos_pago,
          transporte_default, pago_combustible_default
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17)`,
        [
          u.id,
          u.usuario,
          hash,
          u.nombre,
          u.cargo,
          u.sucursal,
          u.correo,
          u.correo_jefe,
          u.rol,
          u.combustible_activo,
          u.activo,
          JSON.stringify(u.tipos_salida),
          JSON.stringify(u.tipos_visita),
          JSON.stringify(u.tipos_transporte),
          JSON.stringify(u.tipos_pago),
          u.transporte_default || '',
          u.pago_combustible_default || '',
        ]
      );
    }
    console.log('Seeded admin@red.com.sv and vendedor@red.com.sv');
  }
}

async function getUsers() {
  const { rows } = await pool.query('SELECT * FROM users ORDER BY rol, nombre');
  return rows.map(publicUser);
}

async function getAppPayload(sessionUser = null) {
  const { rows } = await pool.query('SELECT * FROM app_state WHERE id = 1');
  const s = rows[0];
  const users = await getUsers();
  return {
    combustibleGlobal: s.combustible_global,
    catalogoClientesActivo: s.catalogo_clientes_activo,
    webhookUrl: s.webhook_url || DEFAULT_WEBHOOK_URL,
    correo_ventas: s.correo_ventas,
    catalogos: s.catalogos || DEFAULT_CATALOGOS,
    clients: s.clients || [],
    clientRequests: s.client_requests || [],
    notifications: s.notifications || [],
    salidas: s.salidas || [],
    users,
    session: sessionUser ? publicUser(sessionUser) : null,
  };
}

async function findUserByLogin(login) {
  const key = String(login || '').trim().toLowerCase();
  if (!key) return null;
  const { rows } = await pool.query(
    `SELECT * FROM users
     WHERE lower(usuario) = $1 OR lower(correo) = $1
     LIMIT 1`,
    [key]
  );
  return rows[0] || null;
}

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.headers['x-session-token'];
  if (!token) {
    req.user = null;
    req.token = null;
    return next();
  }
  const { rows } = await pool.query(
    `SELECT u.*, s.token, s.expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1`,
    [token]
  );
  if (!rows[0] || new Date(rows[0].expires_at) < new Date()) {
    if (rows[0]) await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    req.user = null;
    req.token = null;
    return next();
  }
  req.user = rows[0];
  req.token = token;
  return next();
}

function requireAuth(req, res, next) {
  if (!req.user || !req.user.activo) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.rol !== 'admin') {
    return res.status(403).json({ error: 'Solo administrador' });
  }
  return next();
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(authMiddleware);

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const login = String(req.body?.usuario || req.body?.login || '').trim();
    const password = String(req.body?.password || '');
    const expectedRole = String(req.body?.rol || '').trim();
    const user = await findUserByLogin(login);
    if (!user || !user.activo) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    if (expectedRole && user.rol !== expectedRole) {
      return res.status(401).json({ error: 'Sin acceso para este rol' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + SESSION_TTL_MS);
    await pool.query(
      'INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)',
      [token, user.id, expires.toISOString()]
    );
    const state = await getAppPayload(user);
    res.json({ token, user: publicUser(user), state });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error de autenticación' });
  }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM sessions WHERE token = $1', [req.token]);
  res.json({ ok: true });
});

app.get('/api/state', requireAuth, async (req, res) => {
  try {
    const state = await getAppPayload(req.user);
    res.json(state);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar el estado' });
  }
});

app.put('/api/state', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const isAdmin = req.user.rol === 'admin';

    const current = await getAppPayload(req.user);
    const next = {
      combustibleGlobal: isAdmin
        ? Boolean(body.combustibleGlobal ?? current.combustibleGlobal)
        : current.combustibleGlobal,
      catalogoClientesActivo: isAdmin
        ? Boolean(body.catalogoClientesActivo ?? current.catalogoClientesActivo)
        : current.catalogoClientesActivo,
      webhookUrl: isAdmin
        ? String(body.webhookUrl ?? current.webhookUrl).trim() || DEFAULT_WEBHOOK_URL
        : current.webhookUrl,
      correo_ventas: isAdmin
        ? String(body.correo_ventas ?? current.correo_ventas).trim()
        : current.correo_ventas,
      catalogos: isAdmin ? body.catalogos || current.catalogos : current.catalogos,
      clients: isAdmin ? body.clients || current.clients : current.clients,
      clientRequests: Array.isArray(body.clientRequests)
        ? body.clientRequests
        : current.clientRequests,
      notifications: Array.isArray(body.notifications)
        ? body.notifications
        : current.notifications,
      salidas: Array.isArray(body.salidas) ? body.salidas : current.salidas,
    };

    await pool.query(
      `UPDATE app_state SET
        combustible_global = $1,
        catalogo_clientes_activo = $2,
        webhook_url = $3,
        correo_ventas = $4,
        catalogos = $5::jsonb,
        clients = $6::jsonb,
        client_requests = $7::jsonb,
        notifications = $8::jsonb,
        salidas = $9::jsonb,
        updated_at = NOW()
       WHERE id = 1`,
      [
        next.combustibleGlobal,
        next.catalogoClientesActivo,
        next.webhookUrl,
        next.correo_ventas,
        JSON.stringify(next.catalogos),
        JSON.stringify(next.clients),
        JSON.stringify(next.clientRequests),
        JSON.stringify(next.notifications),
        JSON.stringify(next.salidas),
      ]
    );

    if (isAdmin && Array.isArray(body.users)) {
      for (const u of body.users) {
        if (!u?.id) continue;
        const existing = await pool.query('SELECT id FROM users WHERE id = $1', [u.id]);
        const password = String(u.password || '').trim();
        const paisRaw = String(u.pais || '').trim().toUpperCase();
        const pais = paisRaw === 'GT' || paisRaw === 'SV' ? paisRaw : '';
        if (existing.rowCount === 0) {
          const hash = await bcrypt.hash(password || 'Cambiar123!', 10);
          await pool.query(
            `INSERT INTO users (
              id, usuario, password_hash, nombre, cargo, sucursal, correo, correo_jefe, rol,
              combustible_activo, activo, tipos_salida, tipos_visita, tipos_transporte, tipos_pago,
              transporte_default, pago_combustible_default, pais
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17,$18)`,
            [
              u.id,
              u.usuario,
              hash,
              u.nombre || '',
              u.cargo || '',
              u.sucursal || '',
              u.correo || '',
              u.correo_jefe || '',
              u.rol === 'admin' ? 'admin' : 'vendedor',
              u.combustible_activo !== false,
              u.activo !== false,
              JSON.stringify(u.tipos_salida || []),
              JSON.stringify(u.tipos_visita || []),
              JSON.stringify(u.tipos_transporte || []),
              JSON.stringify(u.tipos_pago || []),
              String(u.transporte_default || '').trim(),
              String(u.pago_combustible_default || '').trim(),
              pais,
            ]
          );
        } else {
          const baseParams = [
            u.usuario,
            u.nombre || '',
            u.cargo || '',
            u.sucursal || '',
            u.correo || '',
            u.correo_jefe || '',
            u.rol === 'admin' ? 'admin' : 'vendedor',
            u.combustible_activo !== false,
            u.activo !== false,
            JSON.stringify(u.tipos_salida || []),
            JSON.stringify(u.tipos_visita || []),
            JSON.stringify(u.tipos_transporte || []),
            JSON.stringify(u.tipos_pago || []),
            String(u.transporte_default || '').trim(),
            String(u.pago_combustible_default || '').trim(),
            pais,
          ];
          if (password) {
            const hash = await bcrypt.hash(password, 10);
            await pool.query(
              `UPDATE users SET
                usuario=$1, nombre=$2, cargo=$3, sucursal=$4, correo=$5, correo_jefe=$6, rol=$7,
                combustible_activo=$8, activo=$9,
                tipos_salida=$10::jsonb, tipos_visita=$11::jsonb, tipos_transporte=$12::jsonb, tipos_pago=$13::jsonb,
                transporte_default=$14, pago_combustible_default=$15, pais=$16,
                password_hash=$17, updated_at=NOW()
               WHERE id=$18`,
              [...baseParams, hash, u.id]
            );
          } else {
            await pool.query(
              `UPDATE users SET
                usuario=$1, nombre=$2, cargo=$3, sucursal=$4, correo=$5, correo_jefe=$6, rol=$7,
                combustible_activo=$8, activo=$9,
                tipos_salida=$10::jsonb, tipos_visita=$11::jsonb, tipos_transporte=$12::jsonb, tipos_pago=$13::jsonb,
                transporte_default=$14, pago_combustible_default=$15, pais=$16,
                updated_at=NOW()
               WHERE id=$17`,
              [...baseParams, u.id]
            );
          }
        }
      }

      const keepIds = body.users.map((u) => u.id).filter(Boolean);
      if (keepIds.length) {
        await pool.query(
          `DELETE FROM users WHERE id <> ALL($1::text[]) AND id <> $2`,
          [keepIds, req.user.id]
        );
      }
    }

    const state = await getAppPayload(req.user);
    res.json(state);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar' });
  }
});

const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) res.status(404).send('Frontend no construido');
  });
});

await migrate();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`INTELFON API listening on :${PORT}`);
});
