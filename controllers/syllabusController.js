// controllers/syllabusController.js
const db    = require('../config/db');
const https = require('https');
require('dotenv').config();

const callClaude = (syllabusText) => new Promise((resolve, reject) => {
  const SYSTEM = `You are an expert academic assistant. Parse the university course syllabus and respond ONLY with a valid JSON object — no markdown, no backticks.
Schema: {"course_name":"string","course_code":"string|null","instructor":"string|null","semester":"string|null","assessments":[{"name":"string","due_date":"string|null","weight_percent":number|null,"type":"quiz|exam|project|lab|other"}],"weekly_topics":["string"],"key_dates":[{"date":"string","event":"string","type":"exam|quiz|submission|holiday|other"}],"flags":["string"],"summary":"string"}`;

  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514', max_tokens: 2048, system: SYSTEM,
    messages: [{ role: 'user', content: `Parse this syllabus:\n\n${syllabusText.slice(0, 12000)}` }],
  });

  const req = https.request({
    hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(body) },
  }, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => { data += chunk; });
    apiRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.error) return reject(new Error(parsed.error.message));
        const text  = parsed.content.map(b => b.text || '').join('').trim();
        resolve(JSON.parse(text.replace(/```json|```/gi, '').trim()));
      } catch (e) { reject(new Error('Claude response could not be parsed as JSON')); }
    });
  });
  req.on('error', reject);
  req.write(body); req.end();
});

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
    try { parsed = await callClaude(text); }
    catch (claudeErr) {
      await db.query('UPDATE syllabi SET parse_status=? WHERE id=?', ['failed', syllabusId]);
      return res.status(502).json({ success: false, message: 'Claude API error: ' + claudeErr.message });
    }

    await db.query('UPDATE syllabi SET parsed_json=?,flags=?,parse_status=? WHERE id=?',
      [JSON.stringify(parsed), JSON.stringify(parsed.flags||[]), 'parsed', syllabusId]);

    await db.query(
      `UPDATE courses SET course_name=COALESCE(?,course_name),course_code=COALESCE(?,course_code),
       instructor=COALESCE(?,instructor),semester=COALESCE(?,semester),summary=COALESCE(?,summary) WHERE id=?`,
      [parsed.course_name, parsed.course_code, parsed.instructor, parsed.semester, parsed.summary, course_id]
    );

    if (parsed.assessments?.length) {
      await db.query('DELETE FROM assessments WHERE course_id=? AND user_id=?', [course_id, req.user.id]);
      await db.query(
        'INSERT INTO assessments (course_id,user_id,name,type,due_date,weight_percent) VALUES ?',
        [parsed.assessments.map(a => [course_id, req.user.id, a.name, a.type||'other', a.due_date||null, a.weight_percent||null])]
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
      `SELECT s.id,s.file_name,s.parse_status,s.created_at,c.course_name,c.course_code,c.color
       FROM syllabi s JOIN courses c ON c.id=s.course_id WHERE s.user_id=? ORDER BY s.created_at DESC`,
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

module.exports = { parseSyllabus, getSyllabi, getSyllabus };
