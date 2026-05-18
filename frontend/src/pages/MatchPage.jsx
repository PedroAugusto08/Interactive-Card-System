import { useEffect, useMemo, useState } from 'react';

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

function getTargetOptions(participants, actingParticipantId, targetScope) {
  if (!Array.isArray(participants)) {
    return [];
  }

  if (targetScope === 'other-player') {
    return participants.filter((participant) => participant.participantId !== actingParticipantId && !participant.isDefeated);
  }

  if (targetScope === 'selected-player') {
    return participants.filter((participant) => !participant.isDefeated);
  }

  return [];
}

function openPendingActionConfig({ kind, entity, actingParticipantId, participants, exiledImoCardIds, handCards }) {
  const automation = kind === 'useImoCard'
    ? entity.useAutomation
    : kind === 'exileImoCard'
      ? entity.exileAutomation
      : entity.useAutomation;
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
  const [openingSelection, setOpeningSelection] = useState([]);
  const [pendingAction, setPendingAction] = useState(null);
  const [pendingPrivateView, setPendingPrivateView] = useState(null);

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

    socket.on('room:update', handleRoomUpdate);
    socket.on('match:sync', handleMatchSync);
    socket.on('match:log', handleLog);

    return () => {
      socket.off('room:update', handleRoomUpdate);
      socket.off('match:sync', handleMatchSync);
      socket.off('match:log', handleLog);
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
  const availableImoCatalog = focusedParticipant?.availableImoCatalog || [];
  const targetOptions = pendingAction
    ? getTargetOptions(participantStates, pendingAction.actingParticipantId, pendingAction.automation?.targetScope)
    : [];
  const targetHandCards = pendingAction?.targetParticipantId
    ? participantStates.find((participant) => participant.participantId === pendingAction.targetParticipantId)?.handCards || []
    : [];

  useEffect(() => {
    if (!focusedParticipant?.openingHandPending) {
      setOpeningSelection([]);
    }
  }, [focusedParticipant?.openingHandPending, focusedParticipant?.participantId]);

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
        setPendingPrivateView(effectView);
      }
    } catch (error) {
      setLocalError(formatErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleOpenAction(kind, entity) {
    const automation = kind === 'useImoCard'
      ? entity.useAutomation
      : kind === 'exileImoCard'
        ? entity.exileAutomation
        : entity.useAutomation;
    const needsTarget = Boolean(automation?.targetScope);
    const needsExile = automation?.selection === 'own-exiled-card-id' && exiledImoCardIds.length > 0;
    const needsOwnHand = automation?.selection === 'own-hand-card';
    const needsTargetHand = automation?.selection === 'target-hand-card';

    if (!needsTarget && !needsExile && !needsOwnHand && !needsTargetHand) {
      executeAction(`match:${kind}`, {
        actingParticipantId: focusedParticipant.participantId,
        cardId: entity.instanceId,
        divisionId: entity.id,
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
      targetParticipantId: pendingAction.targetParticipantId,
      selectedExiledCardId: pendingAction.selectedExiledCardId,
      selectedOwnHandCardId: pendingAction.selectedOwnHandCardId,
      selectedTargetHandCardId: pendingAction.selectedTargetHandCardId,
    });
    setPendingAction(null);
  }

  function handleAddOpeningCard(cardId) {
    setOpeningSelection((current) => (current.length >= 2 ? current : [...current, cardId]));
  }

  function handleRemoveOpeningCard(index) {
    setOpeningSelection((current) => current.filter((_, currentIndex) => currentIndex !== index));
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
            Abertura inicial de Imo, geração tática, mão limitada a 3 e arsenal aberto de Divisão.
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
                <Badge tone="secondary">Imo {focusedParticipant?.imo ?? 0}/{focusedParticipant?.maxImo ?? 0}</Badge>
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
                  <Badge tone={focusedParticipant.turnActions?.canGenerateImo ? 'accent' : 'secondary'}>
                    Geração {focusedParticipant.turnActions?.canGenerateImo ? 'disponível' : 'fechada'}
                  </Badge>
                </div>

                <div className="row-wrap">
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

          <Card title="Gerar Imo" description="Uma geração por turno, sem consumir ação, respeitando custo e mão máxima.">
            {focusedParticipant?.turnActions?.canGenerateImo ? (
              <div className="player-hand">
                {availableImoCatalog.map((card) => (
                  <div className="player-hand__slot" key={`generate-${card.id}`}>
                    <CardItem
                      category="Imo"
                      cost={card.imoCost || 0}
                      costLabel="Imo"
                      description={card.effect}
                      footer={
                        <div className="row-wrap">
                          <Button
                            disabled={isSubmitting}
                            onClick={() =>
                              executeAction('match:generateImo', {
                                actingParticipantId: focusedParticipant.participantId,
                                cardId: card.id,
                              })
                            }
                            size="sm"
                            type="button"
                          >
                            Gerar
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
              <div className="empty-state">A geração de Imo não está disponível para essa criatura agora.</div>
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
          <Card title="Arsenal de Divisão" description="Ações abertas do personagem, fora da mão e do exílio.">
            {divisionActions.length ? (
              <div className="player-hand">
                {divisionActions.map((action) => (
                  <div className="player-hand__slot" key={`division-${action.id}`}>
                    <CardItem
                      category="Divisão"
                      cost={action.imoCost || 0}
                      costLabel="Imo"
                      description={action.effect}
                      footer={
                        <div className="row-wrap">
                          <Button
                            disabled={isSubmitting || !focusedParticipant?.isCurrentTurn}
                            onClick={() => handleOpenAction('useDivisionAction', action)}
                            size="sm"
                            type="button"
                          >
                            Usar
                          </Button>
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
        description={pendingAction ? `Conclua os detalhes para usar ${pendingAction.entity.name}.` : ''}
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
        onClose={() => setPendingPrivateView(null)}
        onConfirm={() => setPendingPrivateView(null)}
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
