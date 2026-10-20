const TOKEN_KEY = 'red-api-token';

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  if (!token) sessionStorage.removeItem(TOKEN_KEY);
  else sessionStorage.setItem(TOKEN_KEY, token);
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Error ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function apiLogin(usuario, password, rol) {
  return request('/api/auth/login', {
    method: 'POST',
    body: { usuario, password, rol },
  });
}

export async function apiLogout() {
  try {
    await request('/api/auth/logout', { method: 'POST', body: {} });
  } catch {
    /* ignore */
  } finally {
    setToken('');
  }
}

export async function apiGetState() {
  return request('/api/state');
}

export async function apiPutState(state) {
  return request('/api/state', { method: 'PUT', body: state });
}

export async function apiSendMake(body) {
  return request('/api/make', { method: 'POST', body });
}

/** Detecta si hay API de servidor (Coolify / docker). */
export async function apiAvailable() {
  try {
    const res = await fetch('/api/health', { headers: { Accept: 'application/json' } });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}
