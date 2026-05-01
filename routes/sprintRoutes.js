// routes/sprintRoutes.js
const express     = require('express');
const router      = express.Router();
const { protect } = require('../middleware/auth');
const {
  generateSprints, getSprints, getTodaySprints,
  getUnscheduled, setAssessmentDate,
  completeSprint, postponeSprint, deleteSprint,
} = require('../controllers/sprintController');

router.use(protect);
router.post  ('/',                      generateSprints);
router.get   ('/',                      getSprints);
router.get   ('/today',                 getTodaySprints);
router.get   ('/unscheduled',           getUnscheduled);
router.patch ('/assessments/:id/date',  setAssessmentDate);
router.patch ('/:id/complete',          completeSprint);
router.patch ('/:id/postpone',          postponeSprint);
router.delete('/:id',                   deleteSprint);

module.exports = router;
