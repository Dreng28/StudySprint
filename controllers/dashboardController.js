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
      `SELECT COUNT(DISTINCT a.id) AS due_this_week FROM assessments a
       WHERE a.user_id=? AND a.due_date BETWEEN ? AND DATE_ADD(?,INTERVAL 7 DAY)
       AND EXISTS (
         SELECT 1 FROM sprints s WHERE s.assessment_id=a.id AND s.user_id=? AND s.is_done=0
       )`,
      [userId, today, today, userId]);

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

    // ── Weekly sprints by day (for chart) ────────────
    const [weeklyRows] = await db.query(
      `SELECT DAYOFWEEK(DATE(done_at)) AS dow, COUNT(*) AS cnt
       FROM sprints WHERE user_id=? AND is_done=1 AND done_at>=?
       GROUP BY dow`,
      [userId, weekStartStr]);
    // DAYOFWEEK: 1=Sun,2=Mon,...,7=Sat → remap to Mon(0)..Sun(6)
    const weeklyByDay = [0,0,0,0,0,0,0];
    weeklyRows.forEach(r => {
      const idx = r.dow === 1 ? 6 : r.dow - 2; // Sun→6, Mon→0...Sat→5
      weeklyByDay[idx] = r.cnt;
    });

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

    // ── XP & Level system ────────────────────────
    // XP is accumulated in users.xp so it persists even after courses are deleted.
    // Each time the dashboard loads, we calculate XP only from CURRENT completed sprints
    // and add it on top of any previously banked XP (users.xp_banked).
    // When a course is deleted, sprintController banks its XP first before wiping sprints.
    const LEVELS = [
      { level: 1,  name: 'Freshman',          xp: 0     },
      { level: 2,  name: 'Studier',            xp: 500   },
      { level: 3,  name: 'Focused',            xp: 1500  },
      { level: 4,  name: 'Scholar',            xp: 3000  },
      { level: 5,  name: 'Achiever',           xp: 5000  },
      { level: 6,  name: 'Honor Student',      xp: 8000  },
      { level: 7,  name: "Dean's Lister",      xp: 12000 },
      { level: 8,  name: 'Academic',           xp: 17000 },
      { level: 9,  name: 'Valedictorian',      xp: 23000 },
      { level: 10, name: 'StudySprint Legend', xp: 30000 },
    ];

    // XP from currently-alive completed sprints
    const [xpRows] = await db.query(
      'SELECT duration_min, priority FROM sprints WHERE user_id=? AND is_done=1',
      [userId]
    );
    const priorityMult = { high: 1.5, medium: 1.0, low: 0.8 };
    const liveXp = xpRows.reduce((sum, s) => {
      const mult = priorityMult[s.priority] || 1.0;
      return sum + Math.round((s.duration_min || 45) * mult);
    }, 0);

    // Add streak bonus
    const liveXpWithStreak = liveXp + streak * 10;

    // Add any XP banked from previously deleted courses
    const [[userRow]] = await db.query(
      'SELECT COALESCE(xp_banked, 0) AS xp_banked FROM users WHERE id=?', [userId]
    );
    const xpBanked = userRow?.xp_banked || 0;
    let totalXp = liveXpWithStreak + xpBanked;

    let currentLevel = LEVELS[0];
    let nextLevel    = LEVELS[1];
    for (let i = LEVELS.length - 1; i >= 0; i--) {
      if (totalXp >= LEVELS[i].xp) {
        currentLevel = LEVELS[i];
        nextLevel    = LEVELS[i + 1] || null;
        break;
      }
    }
    const xpIntoLevel = totalXp - currentLevel.xp;
    const xpForNext   = nextLevel ? nextLevel.xp - currentLevel.xp : 0;
    const levelPct    = nextLevel ? Math.round((xpIntoLevel / xpForNext) * 100) : 100;

    // ── Badge system ──────────────────────────────
    const BADGE_DEFS = [
      { id: 'first_sprint',   emoji: '\uD83D\uDD25', name: 'First Sprint',    desc: 'Complete your first sprint',    check: () => total_sprints >= 1    },
      { id: 'streak_3',       emoji: '\uD83D\uDCC5', name: '3-Day Streak',    desc: '3 days in a row',               check: () => streak >= 3           },
      { id: 'streak_7',       emoji: '\uD83C\uDF1F', name: 'Week Warrior',    desc: '7-day streak',                  check: () => streak >= 7           },
      { id: 'sprints_10',     emoji: '\uD83D\uDCAA', name: '10 Sprints Done', desc: 'Complete 10 sprints',           check: () => total_sprints >= 10   },
      { id: 'sprints_50',     emoji: '\uD83C\uDFAF', name: 'Dedicated',       desc: 'Complete 50 sprints',           check: () => total_sprints >= 50   },
      { id: 'sprints_100',    emoji: '\uD83C\uDFC6', name: 'Century',         desc: 'Complete 100 sprints',          check: () => total_sprints >= 100  },
      { id: 'completion_80',  emoji: '\u2B50',        name: 'High Achiever',   desc: '80%+ completion rate',          check: () => completion_rate >= 80 },
      { id: 'subject_master', emoji: '\uD83D\uDCDA', name: 'Subject Master',  desc: 'Upload 3 or more subjects',    check: () => active_courses >= 3   },
    ];

    const earnedBadges = BADGE_DEFS
      .filter(b => b.check())
      .map(b => ({ id: b.id, emoji: b.emoji, name: b.name, desc: b.desc }));

    await db.query(
      'UPDATE users SET xp=?, level=?, badges=? WHERE id=?',
      [totalXp, currentLevel.level, JSON.stringify(earnedBadges), userId]
    );

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
        // Gamification
        xp:           totalXp,
        level:        currentLevel.level,
        level_name:   currentLevel.name,
        next_level:   nextLevel ? nextLevel.name : null,
        xp_into:      xpIntoLevel,
        xp_for_next:  xpForNext,
        level_pct:    levelPct,
        badges:       earnedBadges,
      },
      today_sprints:           todaySprints,
      upcoming_deadlines:      deadlines,
      unscheduled_assessments: unscheduled,
      recent_activity:         activity,
      weekly_by_day:           weeklyByDay,
    });

  } catch (err) {
    console.error('Dashboard error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getDashboard };
