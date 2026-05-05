// routes/syllabusRoutes.js
const express     = require('express');
const router      = express.Router();
const { protect } = require('../middleware/auth');
const { parseSyllabus, getSyllabi, getSyllabus } = require('../controllers/syllabusController');
const { deleteSyllabus } = require('../controllers/syllabusController');

router.use(protect);
router.post('/',    parseSyllabus);
router.get ('/',    getSyllabi);
router.get ('/:id', getSyllabus);
router.delete('/:id', authenticate, deleteSyllabus);

module.exports = router;
