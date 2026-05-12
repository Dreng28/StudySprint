// controllers/syllabusController.js
const db    = require('../config/db');
require('dotenv').config();

const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const callGemini = async (syllabusText) => {
  const result = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    config: { responseMimeType: "application/json" },
    contents: `You are an academic assistant. Extract structured syllabus data from this text and return ONLY valid JSON with no extra text or markdown.

Text:
${syllabusText.slice(0, 12000)}

Return this exact JSON structure:
{
  "course_name": "",
  "course_code": "",
  "instructor": "",
  "semester": "",
  "assessments": [
    {
      "name": "",
      "type": "other",
      "due_date": "",
      "weight_percent": null
    }
  ]
}

Rules:
- For type use ONLY one of: quiz, exam, project, lab, assignment, other
- For due_date use YYYY-MM-DD format or null if not found
- For weight_percent use a number like 10 or null if not found
- Return valid JSON only, no markdown, no backticks, no explanation`
  });

  // Robustly extract JSON from response
  let text = result.text || '';
  // Strip any markdown code fences
  text = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  // Extract first JSON object if there's surrounding text
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No valid JSON found in Gemini response');
  return JSON.parse(match[0]);
};

function toMysqlDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

const ALLOWED_TYPES = ['quiz', 'exam', 'project', 'lab', 'assignment', 'other'];
const sanitizeType = (t) => {
  const raw = (t || '').toLowerCase().trim();
  return ALLOWED_TYPES.includes(raw) ? raw : 'other';
};

const parseSyllabus = async (req, res) => {
  try {
    const { course_id, text, file_name, file_size } = req.body;
    if (!course_id || !text) return res.status(400).json({ success: false, message: 'course_id and text are required.' });

    const [courseRows] = await db.query('SELECT id FROM courses WHERE id=? AND user_id=?', [course_id, req.user.id]);
    if (!courseRows.length) return res.status(404).json({ success: false, message: 'Course not found.' });

    const [insertResult] = await db.query(
      'INSERT INTO syllabi (course_id,user_id,original_text,file_name,file_size,parse_status) VALUES (?,?,?,?,?,?)',
      [course_id, req.user.id, text, file_name||null, file_size||null, 'pending']
    );
    const syllabusId = insertResult.insertId;

    let parsed;
    try { parsed = await callGemini(text); }
    catch (geminiErr) {
      await db.query('UPDATE syllabi SET parse_status=? WHERE id=?', ['failed', syllabusId]);
      return res.status(502).json({ success: false, message: 'Gemini API error: ' + geminiErr.message });
    }

    await db.query('UPDATE syllabi SET parsed_json=?,flags=?,parse_status=? WHERE id=?',
      [JSON.stringify(parsed), JSON.stringify(parsed.flags||[]), 'parsed', syllabusId]);

    await db.query(
      `UPDATE courses SET course_name=COALESCE(?,course_name),course_code=COALESCE(?,course_code),
       instructor=COALESCE(?,instructor),semester=COALESCE(?,semester),summary=COALESCE(?,summary) WHERE id=?`,
      [parsed.course_name, parsed.course_code, parsed.instructor, parsed.semester, parsed.summary||null, course_id]
    );

    if (parsed.assessments?.length) {
      await db.query('DELETE FROM assessments WHERE course_id=? AND user_id=?', [course_id, req.user.id]);
      await db.query(
        'INSERT INTO assessments (course_id,user_id,name,type,due_date,weight_percent) VALUES ?',
        [parsed.assessments.map(a => [
          course_id, req.user.id,
          a.name,
          sanitizeType(a.type),
          toMysqlDate(a.due_date),
          a.weight_percent || null
        ])]
      );
    }

    await db.query('INSERT INTO activity_log (user_id,type,title,subtitle) VALUES (?,?,?,?)',
      [req.user.id, 'syllabus_uploaded', 'Uploaded syllabus', parsed.course_name||file_name||'New syllabus']);

    return res.status(200).json({ success: true, message: 'Syllabus parsed!', syllabus_id: syllabusId, parsed });
  } catch (err) {
    console.error('Parse syllabus error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

const getSyllabi = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT s.id, s.course_id, s.file_name, s.parse_status, s.created_at,
              c.course_name, c.course_code, c.color
       FROM syllabi s JOIN courses c ON c.id=s.course_id
       WHERE s.user_id=? ORDER BY s.created_at DESC`,
      [req.user.id]
    );
    return res.status(200).json({ success: true, syllabi: rows });
  } catch (err) { return res.status(500).json({ success: false, message: 'Server error.' }); }
};

const getSyllabus = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM syllabi WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Syllabus not found.' });
    return res.status(200).json({ success: true, syllabus: rows[0] });
  } catch (err) { return res.status(500).json({ success: false, message: 'Server error.' }); }
};

const deleteSyllabus = async (req, res) => {
  try {
    const [syllabusRows] = await db.query(
      'SELECT course_id FROM syllabi WHERE id=? AND user_id=?',
      [req.params.id, req.user.id]
    );
    if (!syllabusRows.length) return res.status(404).json({ success: false, message: 'Syllabus not found.' });

    const courseId = syllabusRows[0].course_id;

    // ── Bank XP from completed sprints before deleting them ──
    // This preserves the user's XP/Level even after the course is wiped.
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

    // Now safe to wipe everything
    await db.query('DELETE FROM sprints     WHERE course_id=? AND user_id=?', [courseId, req.user.id]);
    await db.query('DELETE FROM assessments WHERE course_id=? AND user_id=?', [courseId, req.user.id]);
    await db.query('DELETE FROM syllabi     WHERE id=?        AND user_id=?', [req.params.id, req.user.id]);
    await db.query('DELETE FROM courses     WHERE id=?        AND user_id=?', [courseId, req.user.id]);

    return res.status(200).json({ success: true, message: 'Syllabus and all related data deleted.' });
  } catch (err) {
    console.error('Delete syllabus error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { parseSyllabus, getSyllabi, getSyllabus, deleteSyllabus };
