// server.js
// StudySprint — Main Express Server

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');

// ── Route imports ─────────────────────────────────
const authRoutes      = require('./routes/authRoutes');
const courseRoutes    = require('./routes/courseRoutes');
const syllabusRoutes  = require('./routes/syllabusRoutes');
const sprintRoutes    = require('./routes/sprintRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const materialsRoutes = require('./routes/materialsRoutes');

// ── DB connection (runs on import — will exit if fails) ──
require('./config/db');

const app  = express();
const PORT = process.env.PORT || 5000;

// ── Global middleware ─────────────────────────────
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'https://studysprint-production-1587.up.railway.app',
    'https://studysprint.study',
    'https://www.studysprint.study',
  ],
  credentials: true,
}));
// Increase limit to 10mb to support base64 file uploads
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(__dirname));

// ── Health check ──────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'StudySprint API is running ✅',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// — Root redirect ─────────────────────────────────
app.get('/', (req, res) => {
  res.redirect('/studysprint_landing.html');
});

// ── API routes ────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/courses',   courseRoutes);
app.use('/api/syllabi',   syllabusRoutes);
app.use('/api/sprints',   sprintRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/materials', materialsRoutes);

// ── 404 handler ───────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found.` });
});

// ── Global error handler ──────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).json({ success: false, message: 'Internal server error.' });
});

// ── Start server ──────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  StudySprint API running on http://localhost:${PORT}`);
  console.log(`📋  Health check: http://localhost:${PORT}/api/health\n`);
});
