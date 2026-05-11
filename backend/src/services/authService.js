const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const { env } = require('../config/env');
const {
  createUser,
  findUserByEmail,
  findUserByUsername,
} = require('../models/userModel');
const { AppError } = require('../utils/AppError');
const { buildUserCapabilityFlags } = require('./masterOverride');

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

// Desenvolvimento: habilita/desabilita um modo mestre temporario na propria sessao.
async function setMasterOverrideForDevelopment({ requesterUser, enabled }) {
  if (!env.isDevelopment) {
    throw new AppError('Atalho de desenvolvimento indisponivel fora do ambiente local.', 404);
  }

  const requesterEmail = String(requesterUser?.email || '').trim().toLowerCase();
  if (!requesterEmail || !env.devAllowMasterOverrideAs.includes(requesterEmail)) {
    throw new AppError('Seu usuario nao esta liberado para ativar o mestre temporario em desenvolvimento.', 403);
  }

  return buildAuthResponse(requesterUser, {
    devMasterOverride: Boolean(enabled),
  });
}

// Gera JWT e devolve payload publico do usuario.
function buildAuthResponse(user, options = {}) {
  const capabilityFlags = buildUserCapabilityFlags({
    ...user,
    ...(options.devMasterOverride
      ? {
          devMasterOverride: true,
          isDevMasterOverride: true,
        }
      : {}),
  });
  const payload = {
    sub: String(user.id),
    username: user.username,
    email: user.email,
  };

  if (capabilityFlags.devMasterOverride) {
    payload.devMasterOverride = true;
  }

  const token = jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      ...capabilityFlags,
    },
  };
}

module.exports = {
  register,
  login,
  setMasterOverrideForDevelopment,
};
