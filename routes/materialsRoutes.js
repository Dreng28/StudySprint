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

router.use(protect);
router.post  ('/',             uploadMaterial);
router.get   ('/',             getMaterials);
router.get   ('/:id/download', downloadMaterial);
router.delete('/:id',          deleteMaterial);

module.exports = router;
