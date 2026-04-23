const { Router } = require('express');

const roomController = require('../controllers/roomController');
const { requireAuth } = require('../middlewares/authMiddleware');
const { asyncHandler } = require('../middlewares/asyncHandler');

const router = Router();

// Todas as rotas de sala exigem usuario autenticado.
router.use(requireAuth);

// Cria sala, entra por codigo e lista jogadores.
router.post('/', asyncHandler(roomController.createRoom));
router.post('/join', asyncHandler(roomController.joinRoom));
router.post('/leave', asyncHandler(roomController.leaveRoom));
router.get('/:roomId/players', asyncHandler(roomController.listPlayers));

module.exports = { roomRoutes: router };
