// routes/authRoutes.js
const express     = require('express');
const router      = express.Router();
const { protect } = require('../middleware/auth');
const {
  register,
  login,
  verifyEmail,
  resendVerification,
  getMe,
  updateProfile,
  changePassword,
} = require('../controllers/authController');

router.post('/register',             register);
router.post('/login',                login);
router.get ('/verify',               verifyEmail);           // GET /api/auth/verify?token=xxx
router.post('/resend-verification',  resendVerification);    // POST /api/auth/resend-verification
router.get ('/me',                   protect, getMe);
router.put ('/profile',              protect, updateProfile);
router.put ('/change-password',      protect, changePassword);

module.exports = router;
