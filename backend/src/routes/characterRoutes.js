const { Router } = require('express');

const characterController = require('../controllers/characterController');
const { requireAuth } = require('../middlewares/authMiddleware');
const { asyncHandler } = require('../middlewares/asyncHandler');

const router = Router();

router.use(requireAuth);

router.get('/catalog', asyncHandler(characterController.getCatalog));
router.get('/imo-cards', asyncHandler(characterController.listImoCards));
router.post('/imo-cards', asyncHandler(characterController.createImoCard));
router.post('/', asyncHandler(characterController.createCharacter));
router.get('/', asyncHandler(characterController.listCharacters));
router.get('/:characterId', asyncHandler(characterController.getCharacterById));
router.put('/:characterId', asyncHandler(characterController.updateCharacter));
router.delete('/:characterId', asyncHandler(characterController.deleteCharacter));

module.exports = { characterRoutes: router };
