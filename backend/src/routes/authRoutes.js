const { Router } = require('express');

const authController = require('../controllers/authController');
const { asyncHandler } = require('../middlewares/asyncHandler');

const router = Router();

// Rotas publicas de autenticacao.
router.post('/register', asyncHandler(authController.register));
router.post('/login', asyncHandler(authController.login));

module.exports = { authRoutes: router };
