const { env } = require('../config/env');

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isDevMasterOverrideEnabled(user) {
  return Boolean(user?.devMasterOverride || user?.isDevMasterOverride);
}

function isMasterAccount(user) {
  const masterEmail = normalizeEmail(env.masterAccountEmail);
  if (!masterEmail) {
    return false;
  }

  return normalizeEmail(user?.email) === masterEmail;
}

function canUserManageMultipleDecks(user) {
  return isMasterAccount(user) || isDevMasterOverrideEnabled(user);
}

function canUserManageMultipleCharacters(user) {
  return canUserManageMultipleDecks(user);
}

function canUserActAsMaster(user) {
  return isMasterAccount(user) || isDevMasterOverrideEnabled(user);
}

function buildUserCapabilityFlags(user) {
  const devMasterOverride = isDevMasterOverrideEnabled(user);
  const masterAccount = isMasterAccount(user);

  return {
    devMasterOverride,
    isDevMasterOverride: devMasterOverride,
    isMasterAccount: masterAccount,
    canManageMultipleCharacters: masterAccount || devMasterOverride,
    canManageMultipleDecks: masterAccount || devMasterOverride,
  };
}

function resolveRoomMasterUserId({ room, requesterUser = null, players = [] }) {
  const overriddenUserId = Number(requesterUser?.id);
  if (isDevMasterOverrideEnabled(requesterUser) && Number.isInteger(overriddenUserId) && overriddenUserId > 0) {
    return overriddenUserId;
  }

  const requesterUserId = Number(requesterUser?.id);
  if (isMasterAccount(requesterUser) && Number.isInteger(requesterUserId) && requesterUserId > 0) {
    return requesterUserId;
  }

  const masterPlayer = (players || []).find((player) => isMasterAccount(player));
  const masterPlayerUserId = Number(masterPlayer?.user_id ?? masterPlayer?.id);
  return Number.isInteger(masterPlayerUserId) && masterPlayerUserId > 0 ? masterPlayerUserId : null;
}

module.exports = {
  buildUserCapabilityFlags,
  canUserActAsMaster,
  canUserManageMultipleCharacters,
  canUserManageMultipleDecks,
  isDevMasterOverrideEnabled,
  isMasterAccount,
  resolveRoomMasterUserId,
};
