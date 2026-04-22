const { z } = require('zod');

const authService = require('../services/authService');

// Regras de validacao para cadastro.
const registerSchema = z.object({
  username: z.string().trim().min(3).max(50),
  email: z.string().trim().email(),
  password: z.string().min(6).max(100),
});

// Regras de validacao para login.
const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

// Cria usuario e devolve token + dados basicos.
async function register(req, res) {
  const payload = registerSchema.parse(req.body);
  const authResult = await authService.register(payload);

  return res.status(201).json(authResult);
}

// Autentica usuario e devolve token + dados basicos.
async function login(req, res) {
  const payload = loginSchema.parse(req.body);
  const authResult = await authService.login(payload);

  return res.status(200).json(authResult);
}

module.exports = {
  register,
  login,
};
