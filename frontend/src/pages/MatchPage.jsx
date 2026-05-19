import { useEffect, useState } from 'react';

import { ActionLogItem } from '../components/system/ActionLogItem';
import { CardItem } from '../components/system/CardItem';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { matchApi } from '../api/matchApi';
import { roomApi } from '../api/roomApi';
import { useSocket } from '../hooks/useSocket';
import { useAuthStore } from '../stores/authStore';
import { useRoomStore } from '../stores/roomStore';
import { resolveCardImageUrl } from '../utils/cardImages';
import { formatErrorMessage } from '../utils/formatError';

function emitSocketAction(socket, action, payload) {
  return new Promise((resolve, reject) => {
    socket.emit(action, payload, (response) => {
      if (!response?.ok) {
        reject(new Error(response?.error || 'Falha ao sincronizar a partida.'));
        return;
      }

      resolve(response);
    });
  });
}

function areParticipantsAllies(leftParticipant, rightParticipant) {
  const leftType = String(leftParticipant?.participantType || '');
  const rightType = String(rightParticipant?.participantType || '');

  if (!leftType || !rightType) {
    return false;
  }

  if (leftType === 'player') {
    return rightType === 'player';
  }

  return rightType === 'master-creature';
}

function isParticipantRemoved(participant) {
  return participant?.combatStatus === 'removed';
}

function formatCombatStatusLabel(status) {
  if (status === 'down') {
    return 'Caido';
  }

  if (status === 'removed') {
    return 'Removido';
  }

  return 'Ativo';
}

function formatFragmentSummary(fragments) {
  const labels = [
    ['combate', 'Comb'],
    ['pontaria', 'Pont'],
    ['resistencia', 'Res'],
    ['furor', 'Fur'],
    ['percepcao', 'Perc'],
    ['conhecimento', 'Conh'],
    ['medicina', 'Med'],
    ['furtividade', 'Furt'],
    ['improviso', 'Imp'],
    ['mobilidade', 'Mob'],
  ];

  return labels
    .map(([key, shortLabel]) => `${shortLabel} ${Number(fragments?.[key] || 0)}`)
    .filter((entry) => !entry.endsWith(' 0'))
    .join(' • ');
}

function getTargetOptions(participants, actingParticipantId, targetScope) {
  if (!Array.isArray(participants)) {
    return [];
  }

  if (targetScope === 'other-player') {
    return participants.filter((participant) => participant.participantId !== actingParticipantId && !isParticipantRemoved(participant));
  }

  if (targetScope === 'selected-player') {
    return participants.filter((participant) => !isParticipantRemoved(participant));
  }

  if (targetScope === 'selected-enemy') {
    const actingParticipant = participants.find((participant) => participant.participantId === actingParticipantId);
    if (!actingParticipant) {
      return [];
    }

    return participants.filter(
      (participant) =>
        !isParticipantRemoved(participant) &&
        participant.participantId !== actingParticipantId &&
        !areParticipantsAllies(actingParticipant, participant)
    );
  }

  if (targetScope === 'selected-ally') {
    const actingParticipant = participants.find((participant) => participant.participantId === actingParticipantId);
    if (!actingParticipant) {
      return [];
    }

    return participants.filter(
      (participant) =>
        !isParticipantRemoved(participant) &&
        participant.participantId !== actingParticipantId &&
        areParticipantsAllies(actingParticipant, participant)
    );
  }

  return [];
}

function getGeneratedImoSources(participant) {
  if (!participant) {
    return [];
  }

  const ownSource = (participant.availableImoCatalog || []).length
    ? [
        {
          sourceParticipantId: participant.participantId,
          displayName: `${participant.displayName} (próprio)`,
          cards: participant.availableImoCatalog || [],
        },
      ]
    : [];
  const allySources = (participant.availableAllyImoSources || []).map((source) => ({
    sourceParticipantId: source.participantId,
    displayName: source.displayName,
    cards: source.cards || [],
  }));

  return [...ownSource, ...allySources];
}

function openPendingActionConfig({
  kind,
  entity,
  actingParticipantId,
  participants,
  exiledImoCardIds,
  handCards,
}) {
  const automation =
    kind === 'useImoCard'
      ? entity.useAutomation
      : kind === 'exileImoCard'
        ? entity.exileAutomation
        : entity.useAutomation || {
            targetScope: entity.targetScope,
            selection: entity.selection,
            extraSelection: entity.extraSelection,
          };
  const targetOptions = getTargetOptions(participants, actingParticipantId, automation?.targetScope);
  const targetParticipantId = targetOptions[0]?.participantId || null;
  const targetHandCards = targetParticipantId
    ? participants.find((participant) => participant.participantId === targetParticipantId)?.handCards || []
    : [];

  return {
    kind,
    entity,
    actingParticipantId,
    automation,
    targetParticipantId,
    selectedExiledCardId: exiledImoCardIds[0] || null,
    selectedOwnHandCardId:
      handCards.find((card) => card.instanceId !== entity.instanceId)?.instanceId || handCards[0]?.instanceId || null,
    selectedTargetHandCardId: targetHandCards[0]?.instanceId || null,
    selectedCatalogCardId: '',
    selectedDivisionActionId: '',
    selectedCardIds: [],
    generatedSourceParticipantId: null,
    generatedCardId: '',
  };
}

export function MatchPage() {
  const token = useAuthStore((state) => state.token);
  const currentRoom = useRoomStore((state) => state.currentRoom);
  const currentMatch = useRoomStore((state) => state.currentMatch);
  const viewer = useRoomStore((state) => state.viewer);
  const participantStates = useRoomStore((state) => state.participantStates);
  const logs = useRoomStore((state) => state.logs);
  const setRoomData = useRoomStore((state) => state.setRoomData);
  const setMatchData = useRoomStore((state) => state.setMatchData);
  const appendMatchLog = useRoomStore((state) => state.appendMatchLog);
  const socket = useSocket(token);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [manualFocusedParticipantId, setManualFocusedParticipantId] = useState(null);
  const [openingSelectionState, setOpeningSelectionState] = useState({
    participantId: null,
    selectedCardIds: [],
  });
  const [pendingAction, setPendingAction] = useState(null);
  const [pendingPrivateViews, setPendingPrivateViews] = useState([]);

  const isSocketConnected = Boolean(socket?.connected);
  const controlledParticipantIds = viewer?.controlledParticipantIds || [];
  const controlledParticipants = participantStates.filter((participant) =>
    controlledParticipantIds.includes(participant.participantId)
  );

  useEffect(() => {
    let isMounted = true;

    async function hydrateFromApi() {
      try {
        const roomState = await roomApi.getCurrentRoom({ token });
        if (!isMounted || !roomState.room) {
          return;
        }

        setRoomData(roomState);
        if (roomState.match) {
          setMatchData(roomState.match);
        }
      } catch (error) {
        if (isMounted) {
          setLocalError(formatErrorMessage(error));
        }
      }
    }

    hydrateFromApi();
    return () => {
      isMounted = false;
    };
  }, [setMatchData, setRoomData, token]);

  useEffect(() => {
    if (!socket) {
      return undefined;
    }

    function handleRoomUpdate(payload) {
      setRoomData(payload);
    }

    function handleMatchSync(payload) {
      setMatchData(payload);
    }

    function handleLog(payload) {
      setSyncMessage(payload.message);
      appendMatchLog(payload);
    }

    function handlePrivateEffect(payload) {
      const privateEffects = Array.isArray(payload?.effects) ? payload.effects : [];
      if (!privateEffects.length) {
        return;
      }

      setPendingPrivateViews((current) => [...current, ...privateEffects]);
    }

    socket.on('room:update', handleRoomUpdate);
    socket.on('match:sync', handleMatchSync);
    socket.on('match:log', handleLog);
    socket.on('match:private-effect', handlePrivateEffect);

    return () => {
      socket.off('room:update', handleRoomUpdate);
      socket.off('match:sync', handleMatchSync);
      socket.off('match:log', handleLog);
      socket.off('match:private-effect', handlePrivateEffect);
    };
  }, [appendMatchLog, setMatchData, setRoomData, socket]);

  useEffect(() => {
    if (socket && currentRoom?.id && currentRoom?.code && isSocketConnected) {
      socket.emit('room:join', { code: currentRoom.code });
      socket.emit('match:sync', { roomId: currentRoom.id });
    }
  }, [currentRoom?.code, currentRoom?.id, isSocketConnected, socket]);

  useEffect(() => {
    if (!syncMessage) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setSyncMessage('');
    }, 3200);

    return () => window.clearTimeout(timeoutId);
  }, [syncMessage]);

  const focusedParticipantId =
    manualFocusedParticipantId && controlledParticipantIds.includes(manualFocusedParticipantId)
      ? manualFocusedParticipantId
      : controlledParticipantIds.includes(viewer?.focusedParticipantId)
        ? viewer.focusedParticipantId
        : controlledParticipantIds.includes(currentMatch?.currentTurnParticipantId)
          ? currentMatch.currentTurnParticipantId
          : controlledParticipantIds[0];

  const focusedParticipant = controlledParticipants.find(
    (participant) => participant.participantId === focusedParticipantId
  ) || controlledParticipants[0] || null;
  const handCards = focusedParticipant?.handCards || [];
  const exiledImoCardIds = focusedParticipant?.exiledImoCardIds || [];
  const divisionActions = focusedParticipant?.divisionActions || [];
  const passiveActions = focusedParticipant?.passiveActions || [];
  const availableImoCatalog = focusedParticipant?.availableImoCatalog || [];
  const generatedImoSources = getGeneratedImoSources(focusedParticipant);
  const pendingPrivateView = pendingPrivateViews[0] || null;
  const targetOptions = pendingAction
    ? getTargetOptions(participantStates, pendingAction.actingParticipantId, pendingAction.automation?.targetScope)
    : [];
  const targetHandCards = pendingAction?.targetParticipantId
    ? participantStates.find((participant) => participant.participantId === pendingAction.targetParticipantId)?.handCards || []
    : [];
  const selectedGeneratedImoSource = pendingAction?.generatedSourceParticipantId
    ? generatedImoSources.find((source) => source.sourceParticipantId === pendingAction.generatedSourceParticipantId) || null
    : null;
  const selectedGeneratedImoCards = selectedGeneratedImoSource?.cards || [];
  const selectedPassiveCatalogOptions =
    pendingAction?.kind === 'usePassiveAction' && pendingAction?.entity?.ownCatalogByCost && pendingAction?.selectedOwnHandCardId
      ? pendingAction.entity.ownCatalogByCost[
          String(
            handCards.find((card) => card.instanceId === pendingAction.selectedOwnHandCardId)?.imoCost || ''
          )
        ] || []
      : [];
  const passiveDivisionCatalogOptions =
    pendingAction?.kind === 'usePassiveAction' ? pendingAction?.entity?.divisionCatalogOptions || [] : [];
  const openingSelection =
    focusedParticipant?.openingHandPending && openingSelectionState.participantId === focusedParticipant.participantId
      ? openingSelectionState.selectedCardIds
      : [];

  async function executeAction(action, payload = {}) {
    if (!currentRoom?.id) {
      return;
    }

    setIsSubmitting(true);
    setLocalError('');

    try {
      let response = null;

      if (socket && isSocketConnected) {
        response = await emitSocketAction(socket, action, {
          roomId: currentRoom.id,
          ...payload,
        });
      } else {
        if (action === 'match:completeOpeningHand') {
          response = await matchApi.completeOpeningHand({
            roomId: currentRoom.id,
            actingParticipantId: payload.actingParticipantId,
            selectedCardIds: payload.selectedCardIds,
            token,
          });
        } else if (action === 'match:generateImo') {
          response = await matchApi.generateImo({
            roomId: currentRoom.id,
            actingParticipantId: payload.actingParticipantId,
            cardId: payload.cardId,
            selectedCardIds: payload.selectedCardIds,
            token,
          });
        } else if (action === 'match:useImoCard') {
          response = await matchApi.useImoCard({
            roomId: currentRoom.id,
            token,
            ...payload,
          });
        } else if (action === 'match:exileImoCard') {
          response = await matchApi.exileImoCard({
            roomId: currentRoom.id,
            token,
            ...payload,
          });
        } else if (action === 'match:useDivisionAction') {
          response = await matchApi.useDivisionAction({
            roomId: currentRoom.id,
            token,
            ...payload,
          });
        } else if (action === 'match:usePassiveAction') {
          response = await matchApi.usePassiveAction({
            roomId: currentRoom.id,
            token,
            ...payload,
          });
        } else if (action === 'match:attack') {
          response = await matchApi.attack({
            roomId: currentRoom.id,
            token,
            ...payload,
          });
        } else if (action === 'match:endTurn') {
          response = await matchApi.endTurn({
            roomId: currentRoom.id,
            actingParticipantId: payload.actingParticipantId,
            token,
          });
        }
      }

      if (response?.snapshot) {
        setMatchData(response.snapshot);
      } else if (response?.match || response?.participantStates) {
        setMatchData(response);
      }

      if (response?.log) {
        appendMatchLog(response.log);
      }

      if (response?.notice) {
        setSyncMessage(response.notice);
      } else if (response?.actionNotice) {
        setSyncMessage(response.actionNotice);
      }

      const effectView = response?.effectResults?.find((effect) => effect.type === 'viewRandomHandCard');
      if (effectView) {
        setPendingPrivateViews((current) => [...current, effectView]);
      }

      const privateEffects = Object.values(response?.privateEffectsByUserId || {})
        .flat()
        .filter((effect) => effect?.type === 'viewRandomHandCard');
      if (privateEffects.length) {
        setPendingPrivateViews((current) => [...current, ...privateEffects]);
      }
    } catch (error) {
      setLocalError(formatErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleOpenAction(kind, entity) {
    const automation =
      kind === 'useImoCard'
        ? entity.useAutomation
        : kind === 'exileImoCard'
          ? entity.exileAutomation
          : entity.useAutomation || {
              targetScope: entity.targetScope,
              selection: entity.selection,
              extraSelection: entity.extraSelection,
            };
    const needsTarget = Boolean(automation?.targetScope);
    const needsExile = automation?.selection === 'own-exiled-card-id' && exiledImoCardIds.length > 0;
    const needsOwnHand = automation?.selection === 'own-hand-card';
    const needsTargetHand = automation?.selection === 'target-hand-card';
    const needsCatalogCard = automation?.extraSelection === 'own-catalog-card';
    const needsDivisionCatalog = automation?.selection === 'division-action-id';
    const needsGeneratedCards = kind === 'generateImo' && Number(focusedParticipant?.passiveState?.generateImoLimit || 1) > 1;

    if (kind === 'exileImoCard' || kind === 'usePassiveAction' || kind === 'attack' || kind === 'generateImo') {
      setPendingAction(
        openPendingActionConfig({
          kind,
          entity,
          actingParticipantId: focusedParticipant.participantId,
          participants: participantStates,
          exiledImoCardIds,
          handCards,
        })
      );
      return;
    }

    if (!needsTarget && !needsExile && !needsOwnHand && !needsTargetHand && !needsCatalogCard && !needsDivisionCatalog && !needsGeneratedCards) {
      executeAction(`match:${kind}`, {
        actingParticipantId: focusedParticipant.participantId,
        cardId: entity.instanceId,
        divisionId: entity.id,
        divisionInstanceId: entity.instanceId,
      });
      return;
    }

    setPendingAction(
      openPendingActionConfig({
        kind,
        entity,
        actingParticipantId: focusedParticipant.participantId,
        participants: participantStates,
        exiledImoCardIds,
        handCards,
      })
    );
  }

  function handleConfirmPendingAction() {
    if (!pendingAction) {
      return;
    }

    executeAction(`match:${pendingAction.kind}`, {
      actingParticipantId: pendingAction.actingParticipantId,
      cardId: pendingAction.entity.instanceId,
      divisionId: pendingAction.entity.id,
      divisionInstanceId: pendingAction.entity.instanceId,
      passiveActionId: pendingAction.entity.id,
      attackKind: pendingAction.entity.attackKind,
      generatedSourceParticipantId: pendingAction.generatedSourceParticipantId,
      generatedCardId: pendingAction.generatedCardId,
      targetParticipantId: pendingAction.targetParticipantId,
      selectedExiledCardId: pendingAction.selectedExiledCardId,
      selectedOwnHandCardId: pendingAction.selectedOwnHandCardId,
      selectedTargetHandCardId: pendingAction.selectedTargetHandCardId,
      selectedCatalogCardId: pendingAction.selectedCatalogCardId,
      selectedDivisionActionId: pendingAction.selectedDivisionActionId,
      selectedCardIds: pendingAction.selectedCardIds,
    });
    setPendingAction(null);
  }

  function handleAddOpeningCard(cardId) {
    setOpeningSelectionState((current) => {
      const participantId = focusedParticipant?.participantId || null;
      const selectedCardIds =
        current.participantId === participantId ? current.selectedCardIds : [];
      if (selectedCardIds.length >= 2) {
        return current;
      }

      return {
        participantId,
        selectedCardIds: [...selectedCardIds, cardId],
      };
    });
  }

  function handleRemoveOpeningCard(index) {
    setOpeningSelectionState((current) => ({
      participantId: current.participantId,
      selectedCardIds: current.selectedCardIds.filter((_, currentIndex) => currentIndex !== index),
    }));
  }

  if (!currentRoom || !currentMatch) {
    return (
      <section className="stack-gap-lg">
        <div className="empty-state">Nenhuma partida carregada no momento.</div>
      </section>
    );
  }

  return (
    <section className="stack-gap-lg">
      <div className="section-header">
        <div className="stack-gap" style={{ gap: '8px' }}>
          <h1 className="page-title">Partida</h1>
          <p className="muted-text">
            Abertura inicial de Imo, geração com ação complementar, exílio tático, passivas de Divisão e arsenal aberto.
          </p>
        </div>
        <div className="row-wrap">
          <Badge tone="accent">{currentMatch.status === 'opening' ? 'Abertura inicial' : `Rodada ${currentMatch.round}`}</Badge>
          <Badge tone="secondary">{isSocketConnected ? 'Tempo real ativo' : 'Reconectando'}</Badge>
        </div>
      </div>

      {syncMessage ? <p className="success-text">{syncMessage}</p> : null}
      {localError ? <p className="error-text">{localError}</p> : null}

      <Card title="Criaturas sob seu controle">
        <div className="row-wrap">
          {controlledParticipants.map((participant) => (
            <Button
              key={`focus-${participant.participantId}`}
              onClick={() => setManualFocusedParticipantId(participant.participantId)}
              type="button"
              variant={participant.participantId === focusedParticipant?.participantId ? 'primary' : 'secondary'}
            >
              {participant.displayName}
            </Button>
          ))}
        </div>
      </Card>

      <div className="grid-2">
        <div className="stack-gap">
          <Card
            actions={
              <div className="row-wrap">
                <Badge tone="secondary">
                  Carne {focusedParticipant?.currentCarne ?? 0}/{focusedParticipant?.baseCarne ?? 0}
                </Badge>
                <Badge tone="secondary">
                  Imo {focusedParticipant?.currentImo ?? 0}/{focusedParticipant?.baseImo ?? 0}
                </Badge>
                <Badge tone="primary">Carne Temp. {focusedParticipant?.temporaryCarne ?? 0}</Badge>
                <Badge tone="primary">Imo Temp. {focusedParticipant?.temporaryImo ?? 0}</Badge>
                <Badge
                  tone={
                    focusedParticipant?.combatStatus === 'active'
                      ? 'success'
                      : focusedParticipant?.combatStatus === 'down'
                        ? 'accent'
                        : 'secondary'
                  }
                >
                  {formatCombatStatusLabel(focusedParticipant?.combatStatus)}
                </Badge>
                <Badge tone={focusedParticipant?.isCurrentTurn ? 'accent' : 'secondary'}>
                  {focusedParticipant?.isCurrentTurn ? 'Turno ativo' : 'Aguardando'}
                </Badge>
              </div>
            }
            title={focusedParticipant?.displayName || 'Criatura em foco'}
          >
            {focusedParticipant ? (
              <div className="stack-gap" style={{ gap: '12px' }}>
                <div className="row-wrap">
                  <Badge tone={focusedParticipant.turnActions?.standardAvailable ? 'success' : 'secondary'}>
                    Padrão {focusedParticipant.turnActions?.standardAvailable ? 'livre' : 'usada'}
                  </Badge>
                  <Badge tone={focusedParticipant.turnActions?.complementaryAvailable ? 'success' : 'secondary'}>
                    Complementar {focusedParticipant.turnActions?.complementaryAvailable ? 'livre' : 'usada'}
                  </Badge>
                  <Badge tone={focusedParticipant.hasExiledImoThisTurn ? 'accent' : 'secondary'}>
                    Exilou Imo {focusedParticipant.hasExiledImoThisTurn ? 'neste turno' : 'ainda nao'}
                  </Badge>
                  <Badge tone={focusedParticipant.turnActions?.canGenerateImo ? 'accent' : 'secondary'}>
                    Gerar Imo {focusedParticipant.turnActions?.canGenerateImo ? 'disponível' : 'fechado'}
                  </Badge>
                </div>

                {focusedParticipant.division ? (
                  <div className="stack-gap" style={{ gap: '4px' }}>
                    <strong>{focusedParticipant.division.name}</strong>
                    <span className="muted-text compact">
                      Passiva: {focusedParticipant.division.passive}
                    </span>
                    <span className="muted-text compact">
                      Fragmentos: {formatFragmentSummary(focusedParticipant.fragments) || 'sem fragmentos acima de zero'}
                    </span>
                  </div>
                ) : null}

                <div className="row-wrap">
                  <Button
                    disabled={!focusedParticipant.turnActions?.canAttack || isSubmitting}
                    onClick={() =>
                      handleOpenAction('attack', {
                        id: 'attack:standard',
                        name: 'Ataque',
                        targetScope: 'selected-enemy',
                        attackKind: 'standard',
                      })
                    }
                    type="button"
                    variant="secondary"
                  >
                    Atacar
                  </Button>
                  <Button
                    disabled={!focusedParticipant.turnActions?.canEndTurn || isSubmitting}
                    onClick={() =>
                      executeAction('match:endTurn', {
                        actingParticipantId: focusedParticipant.participantId,
                      })
                    }
                    type="button"
                  >
                    Encerrar turno
                  </Button>
                </div>
              </div>
            ) : (
              <div className="empty-state">Nenhuma criatura controlada no momento.</div>
            )}
          </Card>

          <Card
            title="Gerar Imo"
            description={
              Number(focusedParticipant?.passiveState?.generateImoLimit || 1) > 1
                ? 'Gasta a ação complementar. Rato de Ruína pode escolher gerar 1 ou 2 cartas, iguais ou distintas.'
                : 'Gasta a ação complementar, paga o custo de Imo e respeita o limite de 3 cartas na mão.'
            }
          >
            {focusedParticipant?.turnActions?.canGenerateImo ? (
              <div className="player-hand">
                <div className="player-hand__slot">
                  <CardItem
                    category="Imo"
                    description={
                      Number(focusedParticipant?.passiveState?.generateImoLimit || 1) > 1
                        ? 'Escolha até 2 cartas do seu catálogo para gerar nesta ação complementar.'
                        : 'Escolha 1 carta do seu catálogo para gerar nesta ação complementar.'
                    }
                    footer={
                      <div className="row-wrap">
                        <Button
                          disabled={isSubmitting}
                          onClick={() =>
                            handleOpenAction('generateImo', {
                              id: 'generate-imo',
                              name: 'Gerar Imo',
                              selectedCardIds: [],
                            })
                          }
                          size="sm"
                          type="button"
                        >
                          Escolher cartas
                        </Button>
                      </div>
                    }
                    name="Gerar Imo"
                  />
                </div>
              </div>
            ) : (
              <div className="empty-state">Essa criatura não pode gerar Imo agora.</div>
            )}
          </Card>

          <Card title="Mão de Imo">
            {handCards.length ? (
              <div className="player-hand">
                {handCards.map((card) => (
                  <div className="player-hand__slot" key={`hand-${card.instanceId}`}>
                    <CardItem
                      category={card.category === 'imo' ? 'Imo' : card.category}
                      cost={card.category === 'imo' ? card.imoCost || 0 : undefined}
                      costLabel="Imo"
                      description={card.effect}
                      footer={
                        <div className="row-wrap">
                          <Button
                            disabled={isSubmitting || !focusedParticipant?.isCurrentTurn}
                            onClick={() => handleOpenAction('useImoCard', card)}
                            size="sm"
                            type="button"
                          >
                            Usar
                          </Button>
                          <Button
                            disabled={isSubmitting || !focusedParticipant?.isCurrentTurn || card.canExile === false}
                            onClick={() => handleOpenAction('exileImoCard', card)}
                            size="sm"
                            type="button"
                            variant="secondary"
                          >
                            Exilar
                          </Button>
                        </div>
                      }
                      imageSrc={resolveCardImageUrl(card.imagePath)}
                      name={card.name}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">Sem cartas de Imo na mão.</div>
            )}
          </Card>
        </div>

        <div className="stack-gap">
          <Card title="Passiva de Divisão" description="Estados e ativações especiais da divisão em foco.">
            {focusedParticipant?.division ? (
              <div className="stack-gap" style={{ gap: '12px' }}>
                <div className="stack-gap" style={{ gap: '4px' }}>
                  <strong>{focusedParticipant.division.name}</strong>
                  <span className="muted-text compact">{focusedParticipant.division.passive}</span>
                </div>

                {focusedParticipant.passiveState ? (
                  <div className="row-wrap">
                    <Badge tone="secondary">
                      Gerar até {focusedParticipant.passiveState.generateImoLimit || 1}
                    </Badge>
                    <Badge tone="secondary">
                      Temp. arsenal {focusedParticipant.passiveState.temporaryDivisionActionsCount || 0}
                    </Badge>
                    <Badge tone={focusedParticipant.passiveState.executorExtraAttackReady ? 'accent' : 'secondary'}>
                      Executor extra {focusedParticipant.passiveState.executorExtraAttackReady ? 'pronto' : `recarga ${focusedParticipant.passiveState.executorCooldownTurns || 0}`}
                    </Badge>
                  </div>
                ) : null}

                {passiveActions.length ? (
                  <div className="player-hand">
                    {passiveActions.map((action) => (
                      <div className="player-hand__slot" key={`passive-${action.id}`}>
                        <CardItem
                          category="Passiva"
                          cost={action.imoCost || 0}
                          costLabel="Imo"
                          description={action.description}
                          footer={
                            <div className="row-wrap">
                              <Button
                                disabled={
                                  isSubmitting ||
                                  !focusedParticipant?.isCurrentTurn ||
                                  (action.id === 'executor-extra-attack' && !focusedParticipant?.passiveState?.executorExtraAttackReady)
                                }
                                onClick={() => handleOpenAction('usePassiveAction', action)}
                                size="sm"
                                type="button"
                              >
                                Usar
                              </Button>
                            </div>
                          }
                          name={action.name}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">Essa passiva é automática ou não possui ativação manual agora.</div>
                )}
              </div>
            ) : (
              <div className="empty-state">Nenhuma divisão em foco.</div>
            )}
          </Card>

          <Card title="Arsenal de Divisão" description="Ações abertas do personagem, fora da mão e do exílio.">
            {divisionActions.length ? (
              <div className="player-hand">
                {divisionActions.map((action) => (
                  <div className="player-hand__slot" key={`division-${action.instanceId || action.id}`}>
                    <CardItem
                      category="Divisão"
                      cost={action.imoCost || 0}
                      costLabel="Imo"
                      description={`${action.effect}${action.isTemporary ? '\n\nAção temporária de uso único.' : ''}`}
                      footer={
                        <div className="row-wrap">
                          <Button
                            disabled={
                              isSubmitting ||
                              !focusedParticipant?.isCurrentTurn ||
                              (action.id === 'loucura' && !focusedParticipant?.turnActions?.canUseLoucura)
                            }
                            onClick={() => handleOpenAction('useDivisionAction', action)}
                            size="sm"
                            title={
                              action.id === 'loucura' && !focusedParticipant?.turnActions?.canUseLoucura
                                ? 'Loucura exige que voce tenha exilado uma carta de Imo neste turno.'
                                : undefined
                            }
                            type="button"
                          >
                            Usar
                          </Button>
                          {action.isTemporary ? <Badge tone="primary">Temporária</Badge> : null}
                        </div>
                      }
                      imageSrc={resolveCardImageUrl(action.imagePath)}
                      name={action.name}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">Esse personagem não possui ações de Divisão configuradas.</div>
            )}
          </Card>

          <Card title="Participantes">
            <div className="stack-gap" style={{ gap: '10px' }}>
              {participantStates.map((participant) => (
                <article className="ui-card ui-card--compact" key={`participant-state-${participant.participantId}`}>
                  <div className="ui-card__content">
                    <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
                      <div className="stack-gap" style={{ gap: '2px' }}>
                        <strong>{participant.displayName}</strong>
                        <span className="muted-text compact">
                          Mão {participant.zones.handCount} | Exílio {participant.zones.exileCount}
                        </span>
                      </div>
                      <div className="row-wrap">
                        {participant.isCurrentTurn ? <Badge tone="accent">Turno</Badge> : null}
                        {participant.openingHandPending ? <Badge tone="primary">Abertura pendente</Badge> : null}
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </Card>

          <Card title="Registro da partida">
            {logs.length ? (
              <div className="stack-gap" style={{ gap: '10px' }}>
                {logs.map((item) => (
                  <ActionLogItem item={item} key={`${item.id || item.timestamp}-${item.type}`} />
                ))}
              </div>
            ) : (
              <div className="empty-state">Sem registros até agora.</div>
            )}
          </Card>
        </div>
      </div>

      <Modal
        cancelLabel={null}
        confirmLabel="Confirmar mão inicial"
        description="Escolha gratuitamente 2 cartas de Imo para começar a partida."
        isLoading={isSubmitting}
        onClose={() => {}}
        onConfirm={() =>
          executeAction('match:completeOpeningHand', {
            actingParticipantId: focusedParticipant?.participantId,
            selectedCardIds: openingSelection,
          })
        }
        open={Boolean(focusedParticipant?.openingHandPending)}
        title="Abertura de Imo"
      >
        {focusedParticipant ? (
          <div className="stack-gap" style={{ gap: '14px' }}>
            <div className="row-wrap">
              {openingSelection.map((cardId, index) => {
                const selectedCard = availableImoCatalog.find((card) => card.id === cardId);
                return (
                  <Button key={`opening-picked-${index}`} onClick={() => handleRemoveOpeningCard(index)} type="button" variant="secondary">
                    {selectedCard?.name || 'Carta'} × remover
                  </Button>
                );
              })}
            </div>

            <div className="player-hand">
              {availableImoCatalog.map((card) => (
                <div className="player-hand__slot" key={`opening-card-${card.id}`}>
                  <CardItem
                    category="Imo"
                    cost={card.imoCost || 0}
                    costLabel="Imo"
                    description={card.effect}
                    footer={
                      <div className="row-wrap">
                        <Button
                          disabled={isSubmitting || openingSelection.length >= 2}
                          onClick={() => handleAddOpeningCard(card.id)}
                          size="sm"
                          type="button"
                        >
                          Escolher
                        </Button>
                      </div>
                    }
                    imageSrc={resolveCardImageUrl(card.imagePath)}
                    name={card.name}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        cancelLabel="Cancelar"
        confirmLabel="Confirmar ação"
        description={
          pendingAction
            ? pendingAction.kind === 'exileImoCard'
              ? `Conclua os detalhes para exilar ${pendingAction.entity.name}.`
              : pendingAction.kind === 'generateImo'
                ? 'Escolha as cartas de Imo que serão geradas agora.'
                : pendingAction.kind === 'attack'
                  ? `Escolha o alvo para ${pendingAction.entity.name}.`
                  : `Conclua os detalhes para usar ${pendingAction.entity.name}.`
            : ''
        }
        isLoading={isSubmitting}
        onClose={() => setPendingAction(null)}
        onConfirm={handleConfirmPendingAction}
        open={Boolean(pendingAction)}
        title={pendingAction?.entity?.name || 'Detalhes da ação'}
      >
        {pendingAction ? (
          <div className="stack-gap" style={{ gap: '14px' }}>
            {targetOptions.length ? (
              <section className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">Escolha o alvo</span>
                <div className="row-wrap">
                  {targetOptions.map((participant) => (
                    <Button
                      key={`target-option-${participant.participantId}`}
                      onClick={() =>
                        setPendingAction((current) =>
                          current
                            ? {
                                ...current,
                                targetParticipantId: participant.participantId,
                                selectedTargetHandCardId:
                                  participantStates.find((item) => item.participantId === participant.participantId)?.handCards?.[0]?.instanceId || null,
                              }
                            : current
                        )
                      }
                      type="button"
                      variant={pendingAction.targetParticipantId === participant.participantId ? 'primary' : 'secondary'}
                    >
                      {participant.displayName}
                    </Button>
                  ))}
                </div>
              </section>
            ) : null}

            {pendingAction.kind === 'exileImoCard' ? (
              <section className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">Gerar nova carta após o exílio (opcional)</span>
                <div className="row-wrap">
                  <Button
                    onClick={() =>
                      setPendingAction((current) =>
                        current
                          ? {
                              ...current,
                              generatedSourceParticipantId: null,
                              generatedCardId: '',
                            }
                          : current
                      )
                    }
                    type="button"
                    variant={!pendingAction.generatedCardId ? 'primary' : 'secondary'}
                  >
                    Somente exilar
                  </Button>
                  {generatedImoSources.map((source) => (
                    <Button
                      key={`generated-source-${source.sourceParticipantId}`}
                      onClick={() =>
                        setPendingAction((current) =>
                          current
                            ? {
                                ...current,
                                generatedSourceParticipantId: source.sourceParticipantId,
                                generatedCardId: '',
                              }
                            : current
                        )
                      }
                      type="button"
                      variant={
                        pendingAction.generatedSourceParticipantId === source.sourceParticipantId ? 'primary' : 'secondary'
                      }
                    >
                      {source.displayName}
                    </Button>
                  ))}
                </div>

                {selectedGeneratedImoSource ? (
                  <div className="row-wrap">
                    {selectedGeneratedImoCards.map((card) => (
                      <Button
                        key={`generated-card-${selectedGeneratedImoSource.sourceParticipantId}-${card.id}`}
                        onClick={() =>
                          setPendingAction((current) =>
                            current
                              ? {
                                  ...current,
                                  generatedCardId: card.id,
                                }
                              : current
                          )
                        }
                        type="button"
                        variant={pendingAction.generatedCardId === card.id ? 'primary' : 'secondary'}
                      >
                        {card.name}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            {pendingAction.kind === 'generateImo' ? (
              <section className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">
                  Escolha {Number(focusedParticipant?.passiveState?.generateImoLimit || 1) > 1 ? 'até 2 cartas' : '1 carta'}
                </span>
                <div className="row-wrap">
                  {pendingAction.selectedCardIds.map((selectedCardId, index) => {
                    const selectedCard = availableImoCatalog.find((card) => card.id === selectedCardId);
                    return (
                      <Button
                        key={`selected-generate-card-${selectedCardId}-${index}`}
                        onClick={() =>
                          setPendingAction((current) =>
                            current
                              ? {
                                  ...current,
                                  selectedCardIds: current.selectedCardIds.filter((_, currentIndex) => currentIndex !== index),
                                }
                              : current
                          )
                        }
                        type="button"
                        variant="secondary"
                      >
                        {selectedCard?.name || 'Carta'} × remover
                      </Button>
                    );
                  })}
                </div>
                <div className="row-wrap">
                  {availableImoCatalog.map((card) => {
                    const selectedCopies = pendingAction.selectedCardIds.filter((item) => item === card.id).length;
                    const maxCards = Math.min(
                      Number(focusedParticipant?.passiveState?.generateImoLimit || 1),
                      Math.max(1, 3 - handCards.length)
                    );
                    return (
                      <Button
                        key={`generate-option-${card.id}`}
                        onClick={() =>
                          setPendingAction((current) => {
                            if (!current) {
                              return current;
                            }

                            if (current.selectedCardIds.length >= maxCards) {
                              return current;
                            }

                            return {
                              ...current,
                              selectedCardIds: [...current.selectedCardIds, card.id],
                            };
                          })
                        }
                        type="button"
                        variant={selectedCopies ? 'primary' : 'secondary'}
                      >
                        {card.name}{selectedCopies ? ` ×${selectedCopies}` : ''}
                      </Button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {pendingAction.automation?.selection === 'own-exiled-card-id' ? (
              <section className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">Escolha a carta do exílio</span>
                <div className="row-wrap">
                  {exiledImoCardIds.map((cardId) => (
                    <Button
                      key={`exiled-card-option-${cardId}`}
                      onClick={() => setPendingAction((current) => (current ? { ...current, selectedExiledCardId: cardId } : current))}
                      type="button"
                      variant={pendingAction.selectedExiledCardId === cardId ? 'primary' : 'secondary'}
                    >
                      {cardId}
                    </Button>
                  ))}
                </div>
              </section>
            ) : null}

            {pendingAction.automation?.selection === 'own-hand-card' ? (
              <section className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">Escolha a carta da própria mão</span>
                <div className="row-wrap">
                  {handCards
                    .filter((card) => card.instanceId !== pendingAction.entity.instanceId)
                    .map((card) => (
                      <Button
                        key={`own-hand-option-${card.instanceId}`}
                        onClick={() =>
                          setPendingAction((current) =>
                            current ? { ...current, selectedOwnHandCardId: card.instanceId } : current
                          )
                        }
                        type="button"
                        variant={pendingAction.selectedOwnHandCardId === card.instanceId ? 'primary' : 'secondary'}
                      >
                        {card.name}
                      </Button>
                    ))}
                </div>
              </section>
            ) : null}

            {pendingAction.automation?.selection === 'target-hand-card' ? (
              <section className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">Escolha a carta da mão do alvo</span>
                <div className="row-wrap">
                  {targetHandCards.map((card) => (
                    <Button
                      key={`target-hand-option-${card.instanceId}`}
                      onClick={() =>
                        setPendingAction((current) =>
                          current ? { ...current, selectedTargetHandCardId: card.instanceId } : current
                        )
                      }
                      type="button"
                      variant={pendingAction.selectedTargetHandCardId === card.instanceId ? 'primary' : 'secondary'}
                    >
                      {card.name}
                    </Button>
                  ))}
                </div>
              </section>
            ) : null}

            {pendingAction.automation?.extraSelection === 'own-catalog-card' ? (
              <section className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">Escolha a carta do catálogo do Condutor</span>
                <div className="row-wrap">
                  {selectedPassiveCatalogOptions.map((card) => (
                    <Button
                      key={`passive-catalog-option-${card.id}`}
                      onClick={() =>
                        setPendingAction((current) =>
                          current ? { ...current, selectedCatalogCardId: card.id } : current
                        )
                      }
                      type="button"
                      variant={pendingAction.selectedCatalogCardId === card.id ? 'primary' : 'secondary'}
                    >
                      {card.name}
                    </Button>
                  ))}
                </div>
              </section>
            ) : null}

            {pendingAction.automation?.selection === 'division-action-id' ? (
              <section className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">Escolha a ação de Divisão temporária</span>
                <div className="row-wrap">
                  {passiveDivisionCatalogOptions.map((card) => (
                    <Button
                      key={`division-catalog-option-${card.id}`}
                      onClick={() =>
                        setPendingAction((current) =>
                          current ? { ...current, selectedDivisionActionId: card.id } : current
                        )
                      }
                      type="button"
                      variant={pendingAction.selectedDivisionActionId === card.id ? 'primary' : 'secondary'}
                    >
                      {card.name}
                    </Button>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        cancelLabel={null}
        confirmLabel="Fechar"
        description={
          pendingPrivateView
            ? `Você visualizou uma carta aleatória da mão de ${pendingPrivateView.targetDisplayName}.`
            : ''
        }
        onClose={() => setPendingPrivateViews((current) => current.slice(1))}
        onConfirm={() => setPendingPrivateViews((current) => current.slice(1))}
        open={Boolean(pendingPrivateView)}
        title="Informação privada"
      >
        {pendingPrivateView?.card ? (
          <div className="top-deck-modal__card">
            <CardItem
              category={pendingPrivateView.card.category}
              cost={pendingPrivateView.card.category === 'imo' ? pendingPrivateView.card.imoCost || 0 : undefined}
              costLabel="Imo"
              description={pendingPrivateView.card.effect}
              imageSrc={resolveCardImageUrl(pendingPrivateView.card.imagePath)}
              name={pendingPrivateView.card.name}
              selected
            />
          </div>
        ) : (
          <div className="empty-state">Nenhuma carta privada para mostrar.</div>
        )}
      </Modal>
    </section>
  );
}
