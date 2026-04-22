const jwt = require('jsonwebtoken');

const { env } = require('../config/env');
const { findUserById } = require('../models/userModel');

// Middleware para proteger rotas com JWT.
async function requireAuth(req, res, next) {
  try {
    // Espera header no formato: Bearer <token>.
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ message: 'Token ausente ou invalido.' });
    }

    const payload = jwt.verify(token, env.jwtSecret);
    const userId = Number(payload.sub);

    if (!Number.isInteger(userId)) {
      return res.status(401).json({ message: 'Token invalido.' });
    }

    // Confirma se o usuario ainda existe no banco.
    const user = await findUserById(userId);
    if (!user) {
      return res.status(401).json({ message: 'Usuario nao encontrado.' });
    }

    // Salva o usuario no request para uso nas proximas camadas.
    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Token invalido ou expirado.' });
  }
}

module.exports = { requireAuth };
