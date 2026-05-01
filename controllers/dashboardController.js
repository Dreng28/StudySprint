// controllers/dashboardController.js
const db = require('../config/db');

const getDashboard = async (req, res) => {
  try {
    const userId = req.user.id;
    const today  = new Date().toISOString().split('T')[0];

    // ── Basic stats ───────────────────────────────
    const [[{ active_courses }]] = await db.query(
      'SELECT COUNT(*) AS active_courses FROM courses WHERE user_id=?', [userId]);

    const [[{ upcoming_tasks }]] = await db.query(
      'SELECT COUNT(*) AS upcoming_tasks FROM sprints WHERE user_id=? AND is_done=0 AND scheduled_date>=?',
      [userId, today]);

    const [[{ due_this_week }]] = await db.query(
      `SELECT COUNT(*) AS due_this_week FROM assessments
       WHERE user_id=? AND due_date BETWEEN ? AND DATE_ADD(?,INTERVAL 7 DAY)`,
      [userId, today, today]);

    // ── Today's sprints ───────────────────────────
    const [todaySprints] = await db.query(
      `SELECT s.*, c.course_name, c.course_code, c.color
       FROM sprints s JOIN courses c ON c.id = s.course_id
       WHERE s.user_id=? AND s.scheduled_date=?
       ORDER BY FIELD(s.scheduled_slot,'morning','afternoon','evening')`,
      [userId, today]);

    // ── This week progress ────────────────────────
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekStartStr = weekStart.toISOString().split('T')[0];

    const [[{ week_done }]]  = await db.query(
      'SELECT COUNT(*) AS week_done FROM sprints WHERE user_id=? AND is_done=1 AND done_at>=?',
      [userId, weekStartStr]);

    const [[{ week_total }]] = await db.query(
      'SELECT COUNT(*) AS week_total FROM sprints WHERE user_id=? AND scheduled_date>=?',
      [userId, weekStartStr]);

    // ── Academic Performance stats ─────────────────
    // Total sprints ever completed
    const [[{ total_sprints }]] = await db.query(
      'SELECT COUNT(*) AS total_sprints FROM sprints WHERE user_id=? AND is_done=1',
      [userId]);

    // Total sprints ever (for completion rate)
    const [[{ total_all }]] = await db.query(
      'SELECT COUNT(*) AS total_all FROM sprints WHERE user_id=?',
      [userId]);

    const completion_rate = total_all > 0
      ? Math.round((total_sprints / total_all) * 100)
      : 0;

    // Total study minutes (sum of duration for completed sprints)
    const [[{ total_study_min }]] = await db.query(
      'SELECT COALESCE(SUM(duration_min),0) AS total_study_min FROM sprints WHERE user_id=? AND is_done=1',
      [userId]);

    // Average sprint duration (all sprints)
    const [[{ avg_duration_min }]] = await db.query(
      'SELECT COALESCE(AVG(duration_min),0) AS avg_duration_min FROM sprints WHERE user_id=?',
      [userId]);

    // ── Upcoming deadlines ────────────────────────
    const [deadlines] = await db.query(
      `SELECT a.*, c.course_name, c.color FROM assessments a
       JOIN courses c ON c.id = a.course_id
       WHERE a.user_id=? AND a.due_date BETWEEN ? AND DATE_ADD(?,INTERVAL 14 DAY)
       ORDER BY a.due_date ASC LIMIT 5`,
      [userId, today, today]);

    const [unscheduled] = await db.query(
      `SELECT a.*, c.course_name, c.color FROM assessments a
       JOIN courses c ON c.id = a.course_id
       WHERE a.user_id=? AND a.due_date IS NULL`,
      [userId]);

    // ── Recent activity ───────────────────────────
    const [activity] = await db.query(
      'SELECT * FROM activity_log WHERE user_id=? ORDER BY created_at DESC LIMIT 10',
      [userId]);

    // ── Streak calculation ────────────────────────
    const [streakRows] = await db.query(
      `SELECT DATE(done_at) AS day FROM sprints
       WHERE user_id=? AND is_done=1
       GROUP BY DATE(done_at) ORDER BY day DESC LIMIT 30`,
      [userId]);

    let streak = 0;
    const checkDate = new Date(); checkDate.setHours(0, 0, 0, 0);
    for (const row of streakRows) {
      const rowDate = new Date(row.day); rowDate.setHours(0, 0, 0, 0);
      if (Math.round((checkDate - rowDate) / (1000 * 60 * 60 * 24)) === streak) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else break;
    }

    return res.status(200).json({
      success: true,
      stats: {
        active_courses,
        upcoming_tasks,
        due_this_week,
        week_done,
        week_total,
        week_progress_pct: week_total > 0 ? Math.round((week_done / week_total) * 100) : 0,
        streak,
        // Academic Performance
        total_sprints,
        completion_rate,
        total_study_min:  Math.round(total_study_min),
        avg_duration_min: Math.round(avg_duration_min),
      },
      today_sprints:           todaySprints,
      upcoming_deadlines:      deadlines,
      unscheduled_assessments: unscheduled,
      recent_activity:         activity,
    });

  } catch (err) {
    console.error('Dashboard error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getDashboard };
