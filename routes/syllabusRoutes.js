// routes/syllabusRoutes.js
const express     = require('express');
const router      = express.Router();
const { protect } = require('../middleware/auth');
const { parseSyllabus, getSyllabi, getSyllabus } = require('../controllers/syllabusController');

router.use(protect);
router.post('/',    parseSyllabus);
router.get ('/',    getSyllabi);
router.get ('/:id', getSyllabus);

module.exports = router;
