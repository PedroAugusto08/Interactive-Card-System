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

test('buildLobbyParticipantEntries expands master multi-deck into independent creatures', () => {
  const room = {
    host_id: 10,
  };
  const players = [
    {
      user_id: 10,
      username: 'Mestre',
      selected_deck_ids: [101, 102],
    },
    {
      user_id: 11,
      username: 'Jogador',
      selected_deck_ids: [201],
      selected_deck_id: 201,
    },
  ];
  const deckMap = new Map([
    [101, { id: 101, name: 'Lobo' }],
    [102, { id: 102, name: 'Corvo' }],
    [201, { id: 201, name: 'Baralho do Jogador' }],
  ]);

  const entries = buildLobbyParticipantEntries({ room, players, deckMap });

  assert.deepEqual(
    entries.map((entry) => ({
      entryId: entry.entryId,
      participantType: entry.participantType,
      displayName: entry.displayName,
      controllerUserId: entry.controllerUserId,
    })),
    [
      {
        entryId: 'master-deck:101',
        participantType: 'master-creature',
        displayName: 'Lobo',
        controllerUserId: 10,
      },
      {
        entryId: 'master-deck:102',
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
    { entryId: 'master-deck:101' },
    { entryId: 'master-deck:102' },
    { entryId: 'player:11' },
  ];

  assert.equal(
    validateTurnOrderDraft({
      lobbyEntries,
      draftEntryIds: ['master-deck:101', 'player:11', 'master-deck:102'],
    }).ok,
    true
  );

  assert.equal(
    validateTurnOrderDraft({
      lobbyEntries,
      draftEntryIds: ['master-deck:101', 'player:11'],
    }).ok,
    false
  );

  assert.equal(
    validateTurnOrderDraft({
      lobbyEntries,
      draftEntryIds: ['master-deck:101', 'player:11', 'player:11'],
    }).ok,
    false
  );
});

test('buildDefaultTurnOrderDraft seeds the lobby using current participant expansion order', () => {
  const draft = buildDefaultTurnOrderDraft({
    room: { host_id: 10 },
    players: [
      { user_id: 10, username: 'Mestre', selected_deck_ids: [101, 102] },
      { user_id: 11, username: 'Jogador', selected_deck_ids: [201], selected_deck_id: 201 },
    ],
    deckMap: new Map([
      [101, { id: 101, name: 'Lobo' }],
      [102, { id: 102, name: 'Corvo' }],
      [201, { id: 201, name: 'Baralho do Jogador' }],
    ]),
  });

  assert.deepEqual(draft, ['master-deck:101', 'master-deck:102', 'player:11']);
});

test('getNextActiveParticipant rotates by participant id and wraps around', () => {
  const activeParticipants = [{ id: 41 }, { id: 42 }, { id: 43 }];

  assert.deepEqual(getNextActiveParticipant(activeParticipants, 42), { id: 43 });
  assert.deepEqual(getNextActiveParticipant(activeParticipants, 43), { id: 41 });
});

test('viewer metadata exposes master control and chooses focused participant from turn/combat context', () => {
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
      combatState: null,
    }),
    {
      userId: 50,
      role: 'master',
      controlledParticipantIds: [1, 2],
      focusedParticipantId: 2,
    }
  );

  assert.deepEqual(
    buildViewerMetadata({
      requesterUserId: 50,
      participantStates,
      currentTurnParticipantId: 3,
      combatState: { defenderParticipantId: 1 },
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
