// api.js — StudySprint shared API helper
// Include this in every HTML page with: <script src="api.js"></script>

const API_BASE = '/api';

// ── Token helpers ─────────────────────────────────
const getToken  = ()      => localStorage.getItem('ss_token');
const setToken  = (t)     => localStorage.setItem('ss_token', t);
const setUser   = (u)     => localStorage.setItem('ss_user', JSON.stringify(u));
const getUser   = ()      => { try { return JSON.parse(localStorage.getItem('ss_user')); } catch { return null; } };
const clearAuth = ()      => { localStorage.removeItem('ss_token'); localStorage.removeItem('ss_user'); };

// ── Core fetch wrapper ────────────────────────────
async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json();

  // Auto-logout on 401
  if (res.status === 401) {
    clearAuth();
    window.location.href = 'studysprint_login.html';
    return;
  }

  return { ok: res.ok, status: res.status, ...data };
}

// ── Auth ──────────────────────────────────────────
const Auth = {
  async register(full_name, email, password, student_id, program, terms_accepted) {
    const res = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ full_name, email, password, student_id, program, terms_accepted }),
    });
    if (res?.token) { setToken(res.token); setUser(res.user); }
    return res;
  },

  async login(email, password) {
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (res?.token) { setToken(res.token); setUser(res.user); }
    return res;
  },

  async getMe()           { return apiFetch('/auth/me'); },
  async updateProfile(d)  { return apiFetch('/auth/profile', { method: 'PUT', body: JSON.stringify(d) }); },
  async changePassword(d) { return apiFetch('/auth/change-password', { method: 'PUT', body: JSON.stringify(d) }); },

  logout() { clearAuth(); window.location.href = 'studysprint_login.html'; },
  isLoggedIn() { return !!getToken(); },
  currentUser() { return getUser(); },
};

// ── Dashboard ─────────────────────────────────────
const Dashboard = {
  async get() { return apiFetch('/dashboard'); },
};

// ── Courses ───────────────────────────────────────
const Courses = {
  async list()         { return apiFetch('/courses'); },
  async get(id)        { return apiFetch(`/courses/${id}`); },
  async create(data)   { return apiFetch('/courses', { method: 'POST', body: JSON.stringify(data) }); },
  async update(id, d)  { return apiFetch(`/courses/${id}`, { method: 'PUT', body: JSON.stringify(d) }); },
  async remove(id)     { return apiFetch(`/courses/${id}`, { method: 'DELETE' }); },
};

// ── Syllabi ───────────────────────────────────────
const Syllabi = {
  async parse(course_id, text, file_name, file_size) {
    return apiFetch('/syllabi', {
      method: 'POST',
      body: JSON.stringify({ course_id, text, file_name, file_size }),
    });
  },
  async list()     { return apiFetch('/syllabi'); },
  async get(id)    { return apiFetch(`/syllabi/${id}`); },
};

// ── Sprints ───────────────────────────────────────
const Sprints = {
  async generate(course_id)  { return apiFetch('/sprints', { method: 'POST', body: JSON.stringify({ course_id }) }); },
  async list(week, course_id) {
    const params = new URLSearchParams();
    if (week)      params.set('week', week);
    if (course_id) params.set('course_id', course_id);
    return apiFetch(`/sprints?${params}`);
  },
  async today()              { return apiFetch('/sprints/today'); },
  async complete(id)         { return apiFetch(`/sprints/${id}/complete`, { method: 'PATCH' }); },
  async postpone(id, days=1) { return apiFetch(`/sprints/${id}/postpone`, { method: 'PATCH', body: JSON.stringify({ days }) }); },
  async remove(id)           { return apiFetch(`/sprints/${id}`, { method: 'DELETE' }); },
};

// ── Guard: redirect to login if not authenticated ─
function requireAuth() {
  if (!Auth.isLoggedIn()) {
    window.location.href = 'studysprint_login.html';
  }
}
