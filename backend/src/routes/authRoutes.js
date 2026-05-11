const { Router } = require('express');

const authController = require('../controllers/authController');
const { requireAuth } = require('../middlewares/authMiddleware');
const { asyncHandler } = require('../middlewares/asyncHandler');

const router = Router();

// Rotas publicas de autenticacao.
router.post('/register', asyncHandler(authController.register));
router.post('/login', asyncHandler(authController.login));
router.post('/dev/master-override', requireAuth, asyncHandler(authController.setMasterOverrideDev));

module.exports = { authRoutes: router };
