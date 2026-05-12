// controllers/materialsController.js
const db = require('../config/db');

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB limit

// POST /api/materials
// Body: { course_id, sprint_id (optional), file_name, file_type, file_size, file_data (base64) }
const uploadMaterial = async (req, res) => {
  try {
    const { course_id, sprint_id, file_name, file_type, file_size, file_data } = req.body;

    if (!course_id || !file_name || !file_data) {
      return res.status(400).json({ success: false, message: 'course_id, file_name, and file_data are required.' });
    }

    // Verify course belongs to this user
    const [courseRows] = await db.query(
      'SELECT id FROM courses WHERE id=? AND user_id=?', [course_id, req.user.id]
    );
    if (!courseRows.length) {
      return res.status(404).json({ success: false, message: 'Course not found.' });
    }

    // Verify sprint belongs to this user/course (if provided)
    if (sprint_id) {
      const [sprintRows] = await db.query(
        'SELECT id FROM sprints WHERE id=? AND user_id=? AND course_id=?', [sprint_id, req.user.id, course_id]
      );
      if (!sprintRows.length) {
        return res.status(404).json({ success: false, message: 'Sprint not found.' });
      }
    }

    // Check file size
    const sizeBytes = file_size || Buffer.byteLength(file_data, 'base64');
    if (sizeBytes > MAX_FILE_SIZE) {
      return res.status(413).json({ success: false, message: 'File too large. Maximum size is 5MB.' });
    }

    const [result] = await db.query(
      `INSERT INTO study_materials
        (user_id, course_id, sprint_id, file_name, file_type, file_size, file_data)
       VALUES (?,?,?,?,?,?,?)`,
      [
        req.user.id,
        course_id,
        sprint_id || null,
        file_name,
        file_type || null,
        sizeBytes,
        file_data,
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Material uploaded.',
      id: result.insertId,
    });
  } catch (err) {
    console.error('Upload material error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/materials?course_id=X&sprint_id=Y
// Returns course-level materials + sprint-specific materials (if sprint_id given)
// Does NOT return file_data (only metadata) — use GET /api/materials/:id for download
const getMaterials = async (req, res) => {
  try {
    const { course_id, sprint_id } = req.query;
    if (!course_id) {
      return res.status(400).json({ success: false, message: 'course_id is required.' });
    }

    let rows;
    if (sprint_id) {
      // Return course-level (sprint_id IS NULL) + this sprint's materials
      [rows] = await db.query(
        `SELECT id, course_id, sprint_id, file_name, file_type, file_size, created_at
         FROM study_materials
         WHERE user_id=? AND course_id=? AND (sprint_id IS NULL OR sprint_id=?)
         ORDER BY sprint_id IS NULL DESC, created_at DESC`,
        [req.user.id, course_id, sprint_id]
      );
    } else {
      // Return only course-level materials
      [rows] = await db.query(
        `SELECT id, course_id, sprint_id, file_name, file_type, file_size, created_at
         FROM study_materials
         WHERE user_id=? AND course_id=? AND sprint_id IS NULL
         ORDER BY created_at DESC`,
        [req.user.id, course_id]
      );
    }

    return res.status(200).json({ success: true, materials: rows });
  } catch (err) {
    console.error('Get materials error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/materials/:id/download
// Streams the file as binary — avoids 502 on large files from JSON encoding overhead
// NOTE: This handler resolves auth itself so it can be registered WITHOUT the
// authenticateToken middleware (allowing browser window.open() with ?token=).
const jwt = require('jsonwebtoken');
const downloadMaterial = async (req, res) => {
  try {
    // 1. Resolve the caller's identity from either source:
    //    a) Standard Authorization header  (fetch / XHR callers)
    //    b) ?token= query param            (window.open / direct browser tab)
    let userId = null;

    const headerToken = (req.headers.authorization || '').replace('Bearer ', '').trim();
    const queryToken  = (req.query.token || '').trim();
    const rawToken    = headerToken || queryToken;

    if (!rawToken) {
      return res.status(401).json({ success: false, message: 'No token provided. Please log in.' });
    }

    try {
      const decoded = jwt.verify(rawToken, process.env.JWT_SECRET);
      // jwt payload may use `id` or `userId` depending on how the token was signed
      userId = decoded.id ?? decoded.userId ?? decoded.sub ?? null;
    } catch (_) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Token payload missing user id.' });
    }

    const [rows] = await db.query(
      'SELECT file_name, file_type, file_size, file_data FROM study_materials WHERE id=? AND user_id=?',
      [req.params.id, userId]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Material not found.' });
    }

    const { file_name, file_type, file_size, file_data } = rows[0];

    // Convert base64 stored in DB back to binary buffer
    const buffer = Buffer.from(file_data, 'base64');

    res.setHeader('Content-Type', file_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file_name)}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.end(buffer);
  } catch (err) {
    console.error('Download material error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// DELETE /api/materials/:id
const deleteMaterial = async (req, res) => {
  try {
    const [result] = await db.query(
      'DELETE FROM study_materials WHERE id=? AND user_id=?',
      [req.params.id, req.user.id]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ success: false, message: 'Material not found.' });
    }
    return res.status(200).json({ success: true, message: 'Material deleted.' });
  } catch (err) {
    console.error('Delete material error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { uploadMaterial, getMaterials, downloadMaterial, deleteMaterial };
