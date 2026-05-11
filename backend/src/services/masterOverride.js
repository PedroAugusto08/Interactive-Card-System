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

function buildUserCapabilityFlags(user) {
  const devMasterOverride = isDevMasterOverrideEnabled(user);
  const masterAccount = isMasterAccount(user);

  return {
    devMasterOverride,
    isDevMasterOverride: devMasterOverride,
    isMasterAccount: masterAccount,
    canManageMultipleDecks: masterAccount || devMasterOverride,
  };
}

function resolveRoomMasterUserId({ room, requesterUser = null }) {
  const overriddenUserId = Number(requesterUser?.id);
  if (isDevMasterOverrideEnabled(requesterUser) && Number.isInteger(overriddenUserId) && overriddenUserId > 0) {
    return overriddenUserId;
  }

  const hostUserId = Number(room?.host_id);
  return Number.isInteger(hostUserId) && hostUserId > 0 ? hostUserId : null;
}

module.exports = {
  buildUserCapabilityFlags,
  canUserManageMultipleDecks,
  isDevMasterOverrideEnabled,
  isMasterAccount,
  resolveRoomMasterUserId,
};
