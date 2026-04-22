const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const { env } = require('../config/env');
const {
  createUser,
  findUserByEmail,
  findUserByUsername,
} = require('../models/userModel');
const { AppError } = require('../utils/AppError');

// Cadastro com validacao de unicidade e hash de senha.
async function register({ username, email, password }) {
  const existingEmail = await findUserByEmail(email);
  if (existingEmail) {
    throw new AppError('Email ja cadastrado.', 409);
  }

  const existingUsername = await findUserByUsername(username);
  if (existingUsername) {
    throw new AppError('Nome de usuario ja cadastrado.', 409);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await createUser({ username, email, passwordHash });

  return buildAuthResponse(user);
}

// Login com comparacao de senha hash.
async function login({ email, password }) {
  const user = await findUserByEmail(email);

  if (!user) {
    throw new AppError('Credenciais invalidas.', 401);
  }

  const passwordOk = await bcrypt.compare(password, user.password_hash);
  if (!passwordOk) {
    throw new AppError('Credenciais invalidas.', 401);
  }

  return buildAuthResponse(user);
}

// Gera JWT e devolve payload publico do usuario.
function buildAuthResponse(user) {
  const payload = {
    sub: String(user.id),
    username: user.username,
    email: user.email,
  };

  const token = jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
    },
  };
}

module.exports = {
  register,
  login,
};
