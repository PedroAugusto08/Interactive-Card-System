const { Router } = require('express');

const deckController = require('../controllers/deckController');
const { requireAuth } = require('../middlewares/authMiddleware');
const { asyncHandler } = require('../middlewares/asyncHandler');

const router = Router();

router.use(requireAuth);

router.get('/rules', asyncHandler(deckController.getDeckRules));
router.get('/catalog', asyncHandler(deckController.getDeckCatalog));
router.get('/imo-cards', asyncHandler(deckController.listImoCards));
router.post('/imo-cards', asyncHandler(deckController.createImoCard));
router.post('/', asyncHandler(deckController.createDeck));
router.get('/', asyncHandler(deckController.listDecks));
router.get('/:deckId', asyncHandler(deckController.getDeckById));
router.put('/:deckId', asyncHandler(deckController.updateDeck));
router.delete('/:deckId', asyncHandler(deckController.deleteDeck));

module.exports = { deckRoutes: router };
