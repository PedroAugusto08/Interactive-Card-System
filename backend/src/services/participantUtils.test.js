const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDefaultTurnOrderDraft,
  buildLobbyParticipantEntries,
  buildViewerMetadata,
  getNextActiveParticipant,
  shouldRevealParticipantPrivateState,
  validateTurnOrderDraft,
} = require('./participantUtils');

test('buildLobbyParticipantEntries expands master multi-character into independent creatures', () => {
  const players = [
    {
      user_id: 10,
      username: 'Mestre',
      selected_character_ids: [101, 102],
    },
    {
      user_id: 11,
      username: 'Jogador',
      selected_character_ids: [201],
      selected_character_id: 201,
    },
  ];
  const characterMap = new Map([
    [101, { id: 101, name: 'Lobo' }],
    [102, { id: 102, name: 'Corvo' }],
    [201, { id: 201, name: 'Caçador' }],
  ]);

  const entries = buildLobbyParticipantEntries({ players, characterMap, masterUserId: 10 });

  assert.deepEqual(
    entries.map((entry) => ({
      entryId: entry.entryId,
      participantType: entry.participantType,
      displayName: entry.displayName,
      controllerUserId: entry.controllerUserId,
    })),
    [
      {
        entryId: 'master-character:101',
        participantType: 'master-creature',
        displayName: 'Lobo',
        controllerUserId: 10,
      },
      {
        entryId: 'master-character:102',
        participantType: 'master-creature',
        displayName: 'Corvo',
        controllerUserId: 10,
      },
      {
        entryId: 'player:11',
        participantType: 'player',
        displayName: 'Jogador',
        controllerUserId: 11,
      },
    ]
  );
});

test('validateTurnOrderDraft requires every lobby participant exactly once', () => {
  const lobbyEntries = [
    { entryId: 'master-character:101' },
    { entryId: 'master-character:102' },
    { entryId: 'player:11' },
  ];

  assert.equal(
    validateTurnOrderDraft({
      lobbyEntries,
      draftEntryIds: ['master-character:101', 'player:11', 'master-character:102'],
    }).ok,
    true
  );

  assert.equal(
    validateTurnOrderDraft({
      lobbyEntries,
      draftEntryIds: ['master-character:101', 'player:11'],
    }).ok,
    false
  );
});

test('buildDefaultTurnOrderDraft seeds the lobby using current participant expansion order', () => {
  const draft = buildDefaultTurnOrderDraft({
    players: [
      { user_id: 10, username: 'Mestre', selected_character_ids: [101, 102] },
      { user_id: 11, username: 'Jogador', selected_character_ids: [201], selected_character_id: 201 },
    ],
    characterMap: new Map([
      [101, { id: 101, name: 'Lobo' }],
      [102, { id: 102, name: 'Corvo' }],
      [201, { id: 201, name: 'Caçador' }],
    ]),
    masterUserId: 10,
  });

  assert.deepEqual(draft, ['master-character:101', 'master-character:102', 'player:11']);
});

test('getNextActiveParticipant rotates by participant id and wraps around', () => {
  const activeParticipants = [{ id: 41 }, { id: 42 }, { id: 43 }];

  assert.deepEqual(getNextActiveParticipant(activeParticipants, 42), { id: 43 });
  assert.deepEqual(getNextActiveParticipant(activeParticipants, 43), { id: 41 });
});

test('viewer metadata exposes master control and prefers opening-hand pending participant', () => {
  const participantStates = [
    { participantId: 1, controllerUserId: 50 },
    { participantId: 2, controllerUserId: 50 },
    { participantId: 3, controllerUserId: 60 },
  ];

  assert.deepEqual(
    buildViewerMetadata({
      requesterUserId: 50,
      participantStates,
      currentTurnParticipantId: 2,
      openingParticipantId: 1,
    }),
    {
      userId: 50,
      role: 'master',
      controlledParticipantIds: [1, 2],
      focusedParticipantId: 1,
    }
  );
});

test('shouldRevealParticipantPrivateState reveals only controlled participants', () => {
  assert.equal(
    shouldRevealParticipantPrivateState({
      requesterUserId: 70,
      participant: { controllerUserId: 70 },
    }),
    true
  );

  assert.equal(
    shouldRevealParticipantPrivateState({
      requesterUserId: 70,
      participant: { controllerUserId: 71 },
    }),
    false
  );
});
