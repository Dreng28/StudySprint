// controllers/authController.js
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const crypto       = require('crypto');
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const db           = require('../config/db');
require('dotenv').config();

// ── JWT helper ────────────────────────────────────────────────────
const signToken = (id, email) =>
  jwt.sign({ id, email }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

// ── Nodemailer transporter ────────────────────────────────────────


// ── Send verification email ───────────────────────────────────────
async function sendVerificationEmail(email, full_name, token) {
  const verifyUrl = `${process.env.FRONTEND_URL}/studysprint_login.html?verify=${token}`;
  await resend.emails.send({
    from: 'onboarding@resend.dev',
    to: email,
    subject: '✅ Verify your StudySprint account',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;">
        <h2>Hi ${full_name}! 👋</h2>
        <p>Please verify your email to activate your StudySprint account.</p>
        <a href="${verifyUrl}" style="display:inline-block;padding:14px 32px;background:#6C2BD9;color:white;text-decoration:none;border-radius:10px;font-weight:700;">
          ✅ Verify My Email
        </a>
        <p style="color:#9CA3AF;font-size:13px;margin-top:24px;">Link expires in 24 hours.</p>
      </div>
    `,
  });
}

// ── POST /api/auth/register ───────────────────────────────────────
const register = async (req, res) => {
  try {
    const { full_name, email, password, student_id, program, terms_accepted } = req.body;

    if (!full_name || !email || !password)
      return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
    if (password.length < 6)
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    if (!terms_accepted)
      return res.status(400).json({ success: false, message: 'You must accept the Terms & Conditions.' });

    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0)
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });

    const password_hash = await bcrypt.hash(password, 12);

    // Generate a secure 32-byte verification token
    const verify_token     = crypto.randomBytes(32).toString('hex');
    const verify_token_exp = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const [result] = await db.query(
      `INSERT INTO users
        (full_name, email, password_hash, student_id, program,
         terms_accepted, terms_accepted_at,
         is_verified, verify_token, verify_token_exp)
       VALUES (?, ?, ?, ?, ?, 1, NOW(), 1, ?, ?)`,
      [full_name, email, password_hash, student_id || null, program || null,
       verify_token, verify_token_exp]
    );

    // Send verification email (non-blocking — don't fail registration if email fails)
    try {
      await sendVerificationEmail(email, full_name, verify_token);
    } catch (mailErr) {
      console.error('Verification email failed to send:', mailErr.message);
      // Continue — user is registered, they can request a resend
    }

    return res.status(201).json({
      success:        true,
      message:        'Account created! Please check your email to verify your account before logging in.',
      requiresVerify: true,
    });

  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── GET /api/auth/verify?token=xxx ────────────────────────────────
const verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token)
      return res.status(400).json({ success: false, message: 'Verification token is missing.' });

    const [rows] = await db.query(
      'SELECT id, is_verified, verify_token_exp FROM users WHERE verify_token = ?',
      [token]
    );

    if (!rows.length)
      return res.status(400).json({ success: false, message: 'Invalid or already used verification link.' });

    const user = rows[0];

    if (user.is_verified)
      return res.status(200).json({ success: true, message: 'Email already verified. You can log in!' });

    if (new Date() > new Date(user.verify_token_exp))
      return res.status(400).json({ success: false, message: 'Verification link has expired. Please register again or request a new link.' });

    await db.query(
      'UPDATE users SET is_verified = 1, verify_token = NULL, verify_token_exp = NULL WHERE id = ?',
      [user.id]
    );

    return res.status(200).json({ success: true, message: 'Email verified successfully! You can now log in.' });

  } catch (err) {
    console.error('Verify email error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── POST /api/auth/resend-verification ───────────────────────────
const resendVerification = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email)
      return res.status(400).json({ success: false, message: 'Email is required.' });

    const [rows] = await db.query(
      'SELECT id, full_name, is_verified FROM users WHERE email = ?',
      [email]
    );

    // Always return success to prevent email enumeration
    if (!rows.length || rows[0].is_verified)
      return res.status(200).json({ success: true, message: 'If that email exists and is unverified, a new link has been sent.' });

    const user             = rows[0];
    const verify_token     = crypto.randomBytes(32).toString('hex');
    const verify_token_exp = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.query(
      'UPDATE users SET verify_token = ?, verify_token_exp = ? WHERE id = ?',
      [verify_token, verify_token_exp, user.id]
    );

    await sendVerificationEmail(email, user.full_name, verify_token);

    return res.status(200).json({ success: true, message: 'A new verification email has been sent.' });

  } catch (err) {
    console.error('Resend verification error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── POST /api/auth/login ──────────────────────────────────────────
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password are required.' });

    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (!rows.length)
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });

    const user  = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });

    // Block unverified users
    if (!user.is_verified) {
      return res.status(403).json({
        success:        false,
        requiresVerify: true,
        message:        'Please verify your email before logging in. Check your inbox or request a new verification link.',
      });
    }

    const token = signToken(user.id, user.email);
    return res.status(200).json({
      success: true,
      message: 'Logged in successfully!',
      token,
      user: {
        id:              user.id,
        full_name:       user.full_name,
        email:           user.email,
        student_id:      user.student_id,
        program:         user.program,
        sprint_duration: user.sprint_duration,
        study_mode:      user.study_mode,
      },
    });

  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── GET /api/auth/me ──────────────────────────────────────────────
const getMe = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, full_name, email, student_id, program, sprint_duration, study_mode,
              notif_email, notif_sprint, notif_deadline, notif_weekly, created_at
       FROM users WHERE id = ?`,
      [req.user.id]
    );
    if (!rows.length)
      return res.status(404).json({ success: false, message: 'User not found.' });
    return res.status(200).json({ success: true, user: rows[0] });
  } catch (err) {
    console.error('Get me error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── PUT /api/auth/profile ─────────────────────────────────────────
const updateProfile = async (req, res) => {
  try {
    const { full_name, student_id, program, sprint_duration, study_mode,
            notif_email, notif_sprint, notif_deadline, notif_weekly } = req.body;
    await db.query(
      `UPDATE users SET
        full_name=COALESCE(?,full_name), student_id=COALESCE(?,student_id),
        program=COALESCE(?,program), sprint_duration=COALESCE(?,sprint_duration),
        study_mode=COALESCE(?,study_mode), notif_email=COALESCE(?,notif_email),
        notif_sprint=COALESCE(?,notif_sprint), notif_deadline=COALESCE(?,notif_deadline),
        notif_weekly=COALESCE(?,notif_weekly) WHERE id=?`,
      [full_name, student_id, program, sprint_duration, study_mode,
       notif_email, notif_sprint, notif_deadline, notif_weekly, req.user.id]
    );
    return res.status(200).json({ success: true, message: 'Profile updated successfully.' });
  } catch (err) {
    console.error('Update profile error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── PUT /api/auth/change-password ─────────────────────────────────
const changePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password)
      return res.status(400).json({ success: false, message: 'Both passwords are required.' });
    if (new_password.length < 6)
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters.' });

    const [rows] = await db.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    const match  = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!match)
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });

    const newHash = await bcrypt.hash(new_password, 12);
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.user.id]);
    return res.status(200).json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { register, login, verifyEmail, resendVerification, getMe, updateProfile, changePassword };
