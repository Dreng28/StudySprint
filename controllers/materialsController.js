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
// Returns the file_data (base64) + metadata for a single material
const downloadMaterial = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM study_materials WHERE id=? AND user_id=?',
      [req.params.id, req.user.id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Material not found.' });
    }
    return res.status(200).json({
      success: true,
      material: {
        id:        rows[0].id,
        file_name: rows[0].file_name,
        file_type: rows[0].file_type,
        file_size: rows[0].file_size,
        file_data: rows[0].file_data,
      }
    });
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
