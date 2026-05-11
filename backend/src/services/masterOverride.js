function isDevMasterOverrideEnabled(user) {
  return Boolean(user?.devMasterOverride || user?.isDevMasterOverride);
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
  isDevMasterOverrideEnabled,
  resolveRoomMasterUserId,
};
