// routes/courseRoutes.js
const express     = require('express');
const router      = express.Router();
const { protect } = require('../middleware/auth');
const { getCourses, getCourse, createCourse, updateCourse, deleteCourse } = require('../controllers/courseController');

router.use(protect);
router.get   ('/',    getCourses);
router.get   ('/:id', getCourse);
router.post  ('/',    createCourse);
router.put   ('/:id', updateCourse);
router.delete('/:id', deleteCourse);

module.exports = router;
