const { Router } = require('express');

const matchController = require('../controllers/matchController');
const { requireAuth } = require('../middlewares/authMiddleware');
const { asyncHandler } = require('../middlewares/asyncHandler');

const router = Router();

router.use(requireAuth);

router.get('/:roomId', asyncHandler(matchController.getMatchSnapshot));
router.post('/:roomId/start', asyncHandler(matchController.startMatch));
router.post('/:roomId/draw', asyncHandler(matchController.drawCard));
router.post('/:roomId/play-card', asyncHandler(matchController.playCard));
router.post('/:roomId/end-turn', asyncHandler(matchController.endTurn));

module.exports = { matchRoutes: router };
