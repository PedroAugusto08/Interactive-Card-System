const { Router } = require('express');

const deckController = require('../controllers/deckController');
const { requireAuth } = require('../middlewares/authMiddleware');
const { asyncHandler } = require('../middlewares/asyncHandler');

const router = Router();

// Todas as rotas de deck exigem login.
router.use(requireAuth);

// CRUD de decks do usuario autenticado.
router.get('/rules', asyncHandler(deckController.getDeckRules));
router.get('/catalog', asyncHandler(deckController.getDeckCatalog));
router.post('/', asyncHandler(deckController.createDeck));
router.get('/', asyncHandler(deckController.listDecks));
router.get('/:deckId', asyncHandler(deckController.getDeckById));
router.put('/:deckId', asyncHandler(deckController.updateDeck));
router.delete('/:deckId', asyncHandler(deckController.deleteDeck));

module.exports = { deckRoutes: router };
