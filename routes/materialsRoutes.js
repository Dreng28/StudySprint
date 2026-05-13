// routes/materialsRoutes.js
const express     = require('express');
const router      = express.Router();
const { protect } = require('../middleware/auth');
const {
  uploadMaterial,
  getMaterials,
  downloadMaterial,
  deleteMaterial,
} = require('../controllers/materialsController');

// /:id/download intentionally has NO protect middleware —
// it handles its own auth via ?token= query param (for window.open browser tab support).
// All other routes still require the protect middleware as normal.
router.post  ('/',             protect, uploadMaterial);
router.get   ('/',             protect, getMaterials);
router.get   ('/:id/download',          downloadMaterial);
router.delete('/:id',          protect, deleteMaterial);

module.exports = router;
