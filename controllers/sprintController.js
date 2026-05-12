// controllers/sprintController.js
const db = require('../config/db');

const generateSprintsForCourse = async (userId, courseId, doneSprints = []) => {
  const [assessments] = await db.query(
    'SELECT * FROM assessments WHERE course_id=? AND user_id=? ORDER BY due_date ASC',
    [courseId, userId]
  );
  const [userRows] = await db.query('SELECT sprint_duration, preferred_study_time FROM users WHERE id=?', [userId]);
  const sprintDuration      = userRows[0]?.sprint_duration || 45;
  const preferredStudyTime  = userRows[0]?.preferred_study_time || 'morning';

  // Always assign sprints to preferred slot only
  const VALID_SLOTS = ['morning', 'afternoon', 'evening'];
  const preferred   = VALID_SLOTS.includes(preferredStudyTime) ? preferredStudyTime : 'morning';

  const scheduled   = [];
  const unscheduled = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // ── Daily load balancer: track sprints per date+slot ─────────────
  const MAX_PER_DAY = 3;    // max sprints per day total
  const dayLoad     = {}; // { 'YYYY-MM-DD': count }

  const dateStr = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // Pre-load completed sprints so the balancer respects already-done days
  for (const done of doneSprints) {
    const key = done.scheduled_date instanceof Date
      ? dateStr(done.scheduled_date)
      : String(done.scheduled_date).slice(0, 10);
    dayLoad[key] = (dayLoad[key] || 0) + 1;
  }

  const nextAvailableDate = (fromDate, dueDate) => {
    // Find the next date that hasn't hit MAX_PER_DAY, starting from fromDate
    // and not exceeding dueDate
    const limit = new Date(dueDate);
    limit.setHours(0, 0, 0, 0);
    const d = new Date(fromDate);
    d.setHours(0, 0, 0, 0);
    for (let tries = 0; tries < 60; tries++) {
      const key = dateStr(d);
      if ((dayLoad[key] || 0) < MAX_PER_DAY && d <= limit) return new Date(d);
      d.setDate(d.getDate() + 1);
      if (d > limit) {
        // All days full — return due date as fallback
        return new Date(limit);
      }
    }
    return new Date(fromDate);
  };

  const assignSlot = (dateKey) => {
    // Always use preferred slot — never fall back to other slots
    dayLoad[dateKey] = (dayLoad[dateKey] || 0) + 1;
    return preferred;
  };

  // ── Sprint window rules per assessment type ─────────────────────
  // exam  → sprints only within 7 days of due date (scope announced late)
  // quiz  → sprints only within 5 days of due date (short prep window)
  // all others → full window (projects, labs, assignments need early planning)
  const SPRINT_WINDOW = { exam: 7, quiz: 5 };
  const EXAM_SPRINT_COUNT = 3; // fixed 3 sprints for exam/quiz in intensive window

  for (const assessment of assessments) {
    const aType = (assessment.type || 'other').toLowerCase();

    // ── NO DATE SET YET ────────────────────────────────────────────
    if (!assessment.due_date) {
      const placeholderDate = new Date(today);
      placeholderDate.setDate(today.getDate() + 3);
      const pKey = dateStr(placeholderDate);
      unscheduled.push([
        userId, courseId, assessment.id,
        `⚠ ${assessment.name} — Date not set yet`,
        30, 'high',
        pKey,
        assignSlot(pKey), null,
        `No date was found in the syllabus for "${assessment.name}". ` +
        `This is a reminder to confirm the date with your professor. ` +
        `Once you add the date, regenerate your sprints to get a full study plan.`,
        1,
      ]);
      continue;
    }

    // ── DATE IS SET ────────────────────────────────────────────────
    const dueDate  = new Date(assessment.due_date);
    dueDate.setHours(0, 0, 0, 0);
    const daysLeft = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
    if (daysLeft < 0) continue; // past due — skip

    const windowDays = SPRINT_WINDOW[aType]; // undefined for non-exam/quiz

    // ── EXAM / QUIZ: restricted window ────────────────────────────
    if (windowDays !== undefined) {
      if (daysLeft > windowDays) {
        // Too early — add a "coming soon" locked reminder
        // Place it 3 days from today so it's visible on the schedule
        const reminderDate = new Date(today);
        reminderDate.setDate(today.getDate() + 3);
        const rKey = dateStr(reminderDate);
        const daysUntilWindow = daysLeft - windowDays;
        const windowStartDate = new Date(dueDate);
        windowStartDate.setDate(dueDate.getDate() - windowDays);
        unscheduled.push([
          userId, courseId, assessment.id,
          `📅 ${assessment.name} — Sprints coming in ${daysUntilWindow} day${daysUntilWindow !== 1 ? 's' : ''}`,
          30, 'medium',
          rKey,
          preferred, null,
          `Sprints for ${aType === 'exam' ? 'exams' : 'quizzes'} are generated ${windowDays} days before the deadline ` +
          `to match when scope is typically announced. ` +
          `Recalibrate on or after ${windowStartDate.toDateString()} to get your study sprints.`,
          1,
        ]);
        continue;
      }

      // Within window — generate fixed intensive sprints
      const examSprintCount = Math.min(EXAM_SPRINT_COUNT, daysLeft);
      const duration        = Math.min(sprintDuration + 15, 90); // slightly longer for exams
      const priority        = daysLeft <= 3 ? 'high' : 'high';   // always high for exams

      for (let i = 0; i < examSprintCount; i++) {
        const daysBeforeDue = Math.floor((daysLeft / examSprintCount) * (i + 1));
        const idealDate = new Date(today);
        idealDate.setDate(today.getDate() + (daysLeft - daysBeforeDue));
        idealDate.setHours(0, 0, 0, 0);

        const scheduledDate = nextAvailableDate(idealDate, dueDate);
        const key  = dateStr(scheduledDate);
        const slot = assignSlot(key);

        const sprintLabels = ['Review Scope', 'Practice & Drill', 'Final Review'];
        scheduled.push([
          userId, courseId, assessment.id,
          `${assessment.name} — ${sprintLabels[i] || `Sprint ${i + 1}`}`,
          duration, 'high',
          key,
          slot,
          assessment.due_date,
          `${aType === 'exam' ? 'Exam' : 'Quiz'} sprint ${i + 1} of ${examSprintCount}. ` +
          `${daysLeft} days until ${aType}. Weighted at ${assessment.weight_percent || '?'}%.`,
          0,
        ]);
      }
      continue;
    }

    // ── STANDARD ASSESSMENTS: full window (project, lab, assignment, other) ──
    // Duration scaled by weight
    let duration = sprintDuration;
    if (assessment.weight_percent >= 25) duration = Math.min(sprintDuration + 45, 120);
    else if (assessment.weight_percent >= 15) duration = Math.min(sprintDuration + 15, 90);
    else if ((assessment.weight_percent || 0) < 10) duration = Math.max(sprintDuration - 15, 30);

    const sprintCount = Math.min(Math.max(1, Math.floor(daysLeft / 2)), 5);

    for (let i = 0; i < sprintCount; i++) {
      const daysBeforeDue = Math.floor((daysLeft / sprintCount) * (i + 1));
      const idealDate = new Date(today);
      idealDate.setDate(today.getDate() + (daysLeft - daysBeforeDue));
      idealDate.setHours(0, 0, 0, 0);

      const scheduledDate = nextAvailableDate(idealDate, dueDate);
      const key  = dateStr(scheduledDate);
      const slot = assignSlot(key);

      // ── Deadline-driven priority escalation ──────────────────────────
      // Priority is determined by how many days remain at the time of EACH sprint,
      // not the assessment as a whole. Sprints near the deadline escalate to high.
      const daysAtSprint = Math.ceil((dueDate - scheduledDate) / (1000 * 60 * 60 * 24));
      let sprintPriority;
      if (daysAtSprint <= 3) {
        sprintPriority = 'high';   // ≤ 3 days to deadline: HIGH — final push
      } else if (daysAtSprint <= 7) {
        sprintPriority = 'high';   // ≤ 7 days: HIGH — imminent
      } else if (daysAtSprint <= 14) {
        sprintPriority = 'medium'; // 1–2 weeks: MEDIUM — steady prep
      } else {
        sprintPriority = 'low';    // > 2 weeks: LOW — early groundwork
      }
      // High-weight assessments (≥ 20%) always get at least medium priority
      if ((assessment.weight_percent || 0) >= 20 && sprintPriority === 'low') {
        sprintPriority = 'medium';
      }

      const priorityLabel = i < sprintCount - 1
        ? `Sprint ${i + 1}`
        : 'Final Review';

      scheduled.push([
        userId, courseId, assessment.id,
        `${assessment.name} — ${priorityLabel}`,
        duration, sprintPriority,
        key,
        slot,
        assessment.due_date,
        `Sprint ${i + 1} of ${sprintCount}. ${daysAtSprint} days until deadline. ` +
        `Weighted at ${assessment.weight_percent || '?'}%. ` +
        `Priority escalates as deadline approaches.`,
        0,
      ]);
    }
  }
  return { scheduled, unscheduled };
};

// POST /api/assessments — manual assessment entry
const createAssessment = async (req, res) => {
  try {
    const { course_id, name, type, due_date, weight_percent } = req.body;
    if (!course_id || !name || !type)
      return res.status(400).json({ success: false, message: 'course_id, name, and type are required.' });

    const [courseRows] = await db.query('SELECT id FROM courses WHERE id=? AND user_id=?', [course_id, req.user.id]);
    if (!courseRows.length) return res.status(404).json({ success: false, message: 'Course not found.' });

    const ALLOWED_TYPES = ['quiz','exam','assignment','project','lab','other'];
    const safeType = ALLOWED_TYPES.includes((type||'').toLowerCase()) ? type.toLowerCase() : 'other';

    const [result] = await db.query(
      'INSERT INTO assessments (course_id, user_id, name, type, due_date, weight_percent) VALUES (?,?,?,?,?,?)',
      [course_id, req.user.id, name, safeType, due_date || null, weight_percent || null]
    );

    return res.status(201).json({ success: true, message: 'Assessment added.', assessment_id: result.insertId });
  } catch (err) {
    console.error('Create assessment error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/sprints/generate
const generateSprints = async (req, res) => {
  try {
    const { course_id } = req.body;
    if (!course_id) return res.status(400).json({ success: false, message: 'course_id is required.' });

    const [courseRows] = await db.query('SELECT id FROM courses WHERE id=? AND user_id=?', [course_id, req.user.id]);
    if (!courseRows.length) return res.status(404).json({ success: false, message: 'Course not found.' });

    await db.query('DELETE FROM sprints WHERE course_id=? AND user_id=? AND is_done=0', [course_id, req.user.id]);

    // Fetch completed sprints so the load balancer skips those days correctly
    const [doneSprints] = await db.query(
      'SELECT scheduled_date FROM sprints WHERE course_id=? AND user_id=? AND is_done=1',
      [course_id, req.user.id]
    );
    const { scheduled, unscheduled } = await generateSprintsForCourse(req.user.id, course_id, doneSprints);
    const allSprints = [...scheduled, ...unscheduled];

    if (!allSprints.length) {
      return res.status(200).json({ success: true, message: 'No assessments found.', count: 0, unscheduled_count: 0 });
    }

    await db.query(
      `INSERT INTO sprints (user_id,course_id,assessment_id,title,duration_min,priority,
       scheduled_date,scheduled_slot,linked_deadline,ai_reason,is_unscheduled) VALUES ?`,
      [allSprints]
    );

    return res.status(201).json({
      success: true,
      message: `${scheduled.length} sprint(s) generated.${unscheduled.length > 0 ? ` ⚠ ${unscheduled.length} assessment(s) have no date yet — placeholder reminders created.` : ''}`,
      count: scheduled.length,
      unscheduled_count: unscheduled.length,
      has_unscheduled: unscheduled.length > 0,
    });
  } catch (err) {
    console.error('Generate sprints error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/sprints
const getSprints = async (req, res) => {
  try {
    const { week, course_id } = req.query;
    let query = `SELECT s.*,c.course_name,c.course_code,c.color FROM sprints s
      JOIN courses c ON c.id=s.course_id WHERE s.user_id=?`;
    const params = [req.user.id];

    if (week) { query += ' AND s.scheduled_date>=? AND s.scheduled_date<DATE_ADD(?,INTERVAL 7 DAY)'; params.push(week, week); }
    if (course_id) { query += ' AND s.course_id=?'; params.push(course_id); }
    query += ' ORDER BY s.is_unscheduled ASC, s.scheduled_date ASC, FIELD(s.scheduled_slot,"morning","afternoon","evening"), FIELD(s.priority,"high","medium","low")';

    const [sprints] = await db.query(query, params);
    return res.status(200).json({ success: true, sprints });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/sprints/today
const getTodaySprints = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [sprints] = await db.query(
      `SELECT s.*,c.course_name,c.color FROM sprints s JOIN courses c ON c.id=s.course_id
       WHERE s.user_id=? AND s.scheduled_date=?
       ORDER BY s.is_unscheduled DESC, FIELD(s.scheduled_slot,'morning','afternoon','evening')`,
      [req.user.id, today]
    );
    return res.status(200).json({ success: true, sprints });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/sprints/unscheduled
const getUnscheduled = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT a.*,c.course_name,c.color FROM assessments a JOIN courses c ON c.id=a.course_id
       WHERE a.user_id=? AND a.due_date IS NULL`,
      [req.user.id]
    );
    return res.status(200).json({ success: true, unscheduled: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PATCH /api/sprints/assessments/:id/date
const setAssessmentDate = async (req, res) => {
  try {
    const { due_date } = req.body;
    if (!due_date) return res.status(400).json({ success: false, message: 'due_date is required.' });
    const [result] = await db.query(
      'UPDATE assessments SET due_date=?, is_confirmed=1 WHERE id=? AND user_id=?',
      [due_date, req.params.id, req.user.id]
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Assessment not found.' });
    return res.status(200).json({ success: true, message: 'Date saved! Regenerate your sprints to get an updated study plan.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PATCH /api/sprints/:id/complete
const completeSprint = async (req, res) => {
  try {
    const [result] = await db.query(
      'UPDATE sprints SET is_done=1, done_at=NOW() WHERE id=? AND user_id=?',
      [req.params.id, req.user.id]
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Sprint not found.' });
    const [sprintRows] = await db.query('SELECT title FROM sprints WHERE id=?', [req.params.id]);
    await db.query('INSERT INTO activity_log (user_id,type,title,subtitle) VALUES (?,?,?,?)',
      [req.user.id, 'sprint_done', 'Completed sprint', sprintRows[0]?.title || '']);
    return res.status(200).json({ success: true, message: 'Sprint marked as complete!' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PATCH /api/sprints/:id/postpone
const postponeSprint = async (req, res) => {
  try {
    const { days = 1 } = req.body;
    const [result] = await db.query(
      'UPDATE sprints SET scheduled_date=DATE_ADD(scheduled_date,INTERVAL ? DAY), is_postponed=1 WHERE id=? AND user_id=? AND is_done=0',
      [days, req.params.id, req.user.id]
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Sprint not found or already completed.' });
    return res.status(200).json({ success: true, message: `Sprint postponed by ${days} day(s).` });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PATCH /api/sprints/:id/reschedule
const rescheduleSprint = async (req, res) => {
  try {
    const { scheduled_date, scheduled_slot } = req.body;
    if (!scheduled_date || !scheduled_slot)
      return res.status(400).json({ success: false, message: 'scheduled_date and scheduled_slot are required.' });
    const validSlots = ['morning', 'afternoon', 'evening'];
    if (!validSlots.includes(scheduled_slot))
      return res.status(400).json({ success: false, message: 'Invalid slot.' });
    const [result] = await db.query(
      'UPDATE sprints SET scheduled_date=?, scheduled_slot=?, is_postponed=1 WHERE id=? AND user_id=? AND is_done=0',
      [scheduled_date, scheduled_slot, req.params.id, req.user.id]
    );
    if (!result.affectedRows)
      return res.status(404).json({ success: false, message: 'Sprint not found or already completed.' });
    return res.status(200).json({ success: true, message: 'Sprint rescheduled.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PATCH /api/sprints/:id/duration
const updateDuration = async (req, res) => {
  try {
    const { duration_min } = req.body;
    if (!duration_min || isNaN(duration_min))
      return res.status(400).json({ success: false, message: 'duration_min is required.' });
    const mins = Math.min(180, Math.max(5, parseInt(duration_min)));
    const [result] = await db.query(
      'UPDATE sprints SET duration_min=? WHERE id=? AND user_id=? AND is_done=0',
      [mins, req.params.id, req.user.id]
    );
    if (!result.affectedRows)
      return res.status(404).json({ success: false, message: 'Sprint not found or already completed.' });
    return res.status(200).json({ success: true, message: `Duration updated to ${mins} min.`, duration_min: mins });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// DELETE /api/sprints/:id
const deleteSprint = async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM sprints WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Sprint not found.' });
    return res.status(200).json({ success: true, message: 'Sprint deleted.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = {
  generateSprints, getSprints, getTodaySprints,
  getUnscheduled, setAssessmentDate, createAssessment,
  completeSprint, postponeSprint, deleteSprint, updateDuration, rescheduleSprint,
};
