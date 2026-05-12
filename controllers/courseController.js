// controllers/courseController.js
const db = require('../config/db');

const getCourses = async (req, res) => {
  try {
    const [courses] = await db.query(
      `SELECT c.*,
        (SELECT COUNT(*) FROM sprints s WHERE s.course_id=c.id) AS sprint_count,
        (SELECT COUNT(*) FROM assessments a WHERE a.course_id=c.id) AS assessment_count,
        (SELECT MIN(a2.due_date) FROM assessments a2 WHERE a2.course_id=c.id AND a2.due_date>=CURDATE()) AS next_deadline
       FROM courses c WHERE c.user_id=? ORDER BY c.created_at DESC`,
      [req.user.id]
    );
    return res.status(200).json({ success: true, courses });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const getCourse = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM courses WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Course not found.' });
    return res.status(200).json({ success: true, course: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const createCourse = async (req, res) => {
  try {
    const { course_name, course_code, instructor, semester, summary, color } = req.body;
    if (!course_name) return res.status(400).json({ success: false, message: 'Course name is required.' });
    const [result] = await db.query(
      'INSERT INTO courses (user_id,course_name,course_code,instructor,semester,summary,color) VALUES (?,?,?,?,?,?,?)',
      [req.user.id, course_name, course_code||null, instructor||null, semester||null, summary||null, color||'#6C2BD9']
    );
    return res.status(201).json({ success: true, message: 'Course created.', id: result.insertId });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const updateCourse = async (req, res) => {
  try {
    const { course_name, course_code, instructor, semester, summary, color } = req.body;
    await db.query(
      `UPDATE courses SET course_name=COALESCE(?,course_name), course_code=COALESCE(?,course_code),
       instructor=COALESCE(?,instructor), semester=COALESCE(?,semester),
       summary=COALESCE(?,summary), color=COALESCE(?,color) WHERE id=? AND user_id=?`,
      [course_name, course_code, instructor, semester, summary, color, req.params.id, req.user.id]
    );
    return res.status(200).json({ success: true, message: 'Course updated.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const deleteCourse = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id FROM courses WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Course not found.' });

    const courseId = req.params.id;

    // ── Bank XP from completed sprints before deleting them ──
    const [donesprints] = await db.query(
      'SELECT duration_min, priority FROM sprints WHERE course_id=? AND user_id=? AND is_done=1',
      [courseId, req.user.id]
    );
    const priorityMult = { high: 1.5, medium: 1.0, low: 0.8 };
    const xpToBank = donesprints.reduce((sum, s) => {
      const mult = priorityMult[s.priority] || 1.0;
      return sum + Math.round((s.duration_min || 45) * mult);
    }, 0);
    if (xpToBank > 0) {
      await db.query(
        'UPDATE users SET xp_banked = COALESCE(xp_banked, 0) + ? WHERE id=?',
        [xpToBank, req.user.id]
      );
    }

    // Wipe all child records then the course itself
    await db.query('DELETE FROM sprints     WHERE course_id=? AND user_id=?', [courseId, req.user.id]);
    await db.query('DELETE FROM assessments WHERE course_id=? AND user_id=?', [courseId, req.user.id]);
    await db.query('DELETE FROM syllabi     WHERE course_id=? AND user_id=?', [courseId, req.user.id]);
    await db.query('DELETE FROM courses     WHERE id=?        AND user_id=?', [courseId, req.user.id]);

    return res.status(200).json({ success: true, message: 'Course and all related data deleted.' });
  } catch (err) {
    console.error('Delete course error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getCourses, getCourse, createCourse, updateCourse, deleteCourse };
