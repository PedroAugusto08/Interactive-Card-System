const { Router } = require('express');

const roomController = require('../controllers/roomController');
const { requireAuth } = require('../middlewares/authMiddleware');
const { asyncHandler } = require('../middlewares/asyncHandler');

const router = Router();

router.use(requireAuth);

router.get('/me/current', asyncHandler(roomController.getCurrentRoom));
router.post('/', asyncHandler(roomController.createRoom));
router.post('/join', asyncHandler(roomController.joinRoom));
router.post('/leave', asyncHandler(roomController.leaveRoom));
router.get('/:roomId/players', asyncHandler(roomController.listPlayers));
router.post('/:roomId/select-deck', asyncHandler(roomController.selectDeck));
router.post('/:roomId/ready', asyncHandler(roomController.setReadyState));

module.exports = { roomRoutes: router };
