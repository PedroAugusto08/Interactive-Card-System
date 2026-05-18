const { Router } = require('express');

const matchController = require('../controllers/matchController');
const { requireAuth } = require('../middlewares/authMiddleware');
const { asyncHandler } = require('../middlewares/asyncHandler');

const router = Router();

router.use(requireAuth);

router.get('/:roomId', asyncHandler(matchController.getMatchSnapshot));
router.post('/:roomId/start', asyncHandler(matchController.startMatch));
router.post('/:roomId/complete-opening-hand', asyncHandler(matchController.completeOpeningHand));
router.post('/:roomId/generate-imo', asyncHandler(matchController.generateImo));
router.post('/:roomId/use-imo-card', asyncHandler(matchController.useImoCard));
router.post('/:roomId/exile-imo-card', asyncHandler(matchController.exileImoCard));
router.post('/:roomId/use-division-action', asyncHandler(matchController.useDivisionAction));
router.post('/:roomId/end-turn', asyncHandler(matchController.endTurn));

module.exports = { matchRoutes: router };
