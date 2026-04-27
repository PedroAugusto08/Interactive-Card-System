import { useEffect, useState } from 'react';

import { ActionLogItem } from '../components/system/ActionLogItem';
import { CardItem } from '../components/system/CardItem';
import { PlayerCard } from '../components/system/PlayerCard';
import { PlayerHand } from '../components/system/PlayerHand';
import { TurnBanner } from '../components/system/TurnBanner';
import { ZoneContainer } from '../components/system/ZoneContainer';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
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

function formatPerfLabel(metrics) {
  if (!metrics?.totalMs) {
    return '';
  }

  return ` (${Math.round(metrics.totalMs)}ms)`;
}

function getCardActionAutomation(card, action) {
  if (!card) {
    return null;
  }

  return action === 'match:playCard' ? card.playAutomation || null : card.discardAutomation || null;
}

function getTargetOptions(players, currentUserId, targetScope) {
  if (!Array.isArray(players)) {
    return [];
  }

  if (targetScope === 'other-player') {
    return players.filter((player) => player.user_id !== currentUserId);
  }

  if (targetScope === 'selected-player') {
    return players;
  }

  return [];
}

function getPlayableTogetherCandidates(cards, primaryCardId) {
  return (cards || []).filter((card) => card.instanceId !== primaryCardId);
}

function buildActionFeedback(logMessage, notice, metrics) {
  const text = [logMessage, notice].filter(Boolean).join(' ');
  if (!text) {
    return '';
  }

  return `${text}${import.meta.env.DEV ? formatPerfLabel(metrics) : ''}`;
}

export function MatchPage() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);

  const currentRoom = useRoomStore((state) => state.currentRoom);
  const players = useRoomStore((state) => state.players);
  const currentMatch = useRoomStore((state) => state.currentMatch);
  const currentUserState = useRoomStore((state) => state.currentUserState);
  const logs = useRoomStore((state) => state.logs);
  const setRoomData = useRoomStore((state) => state.setRoomData);
  const setMatchData = useRoomStore((state) => state.setMatchData);
  const appendMatchLog = useRoomStore((state) => state.appendMatchLog);
  const clearRoom = useRoomStore((state) => state.clearRoom);

  const socket = useSocket(token);

  const [roomCode, setRoomCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [selectedHandCardId, setSelectedHandCardId] = useState(null);
  const [isEndTurnConfirmOpen, setIsEndTurnConfirmOpen] = useState(false);
  const [isExileModalOpen, setIsExileModalOpen] = useState(false);
  const [pendingCardAction, setPendingCardAction] = useState(null);

  const isSocketConnected = Boolean(socket?.connected);
  const activeTurnPlayerId = currentMatch?.currentTurnPlayerId;

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
      setMatchData({
        ...payload,
        matchPlayers: payload.playerStates || [],
      });
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
    if (socket && currentRoom?.id && isSocketConnected) {
      socket.emit('room:join', { code: currentRoom.code });
      socket.emit('match:sync', { roomId: currentRoom.id });
    }
  }, [currentRoom?.code, currentRoom?.id, isSocketConnected, socket]);

  async function handleJoinRoom(event) {
    event.preventDefault();
    const code = roomCode.trim().toUpperCase();
    if (!code) {
      return;
    }

    setIsSubmitting(true);
    setLocalError('');

    try {
      const roomData = await roomApi.joinRoom({ code, token });
      setRoomData(roomData);

      if (isSocketConnected) {
        socket.emit('room:join', { code });
      } else {
        const snapshot = await matchApi.getSnapshot({ roomId: roomData.room.id, token });
        setMatchData({
          ...snapshot,
          matchPlayers: snapshot.playerStates || [],
        });
      }
    } catch (error) {
      setLocalError(formatErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLeaveRoom() {
    if (!currentRoom?.id) {
      return;
    }

    setIsSubmitting(true);
    setLocalError('');

    try {
      await roomApi.leaveRoom({ roomId: currentRoom.id, token });
      clearRoom();
    } catch (error) {
      setLocalError(formatErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAction(action, payload = {}) {
    if (!currentRoom?.id) {
      return;
    }

    setIsSubmitting(true);
    setLocalError('');

    try {
      if (isSocketConnected) {
        const response = await emitSocketAction(socket, action, {
          roomId: currentRoom.id,
          ...payload,
        });
        if (response?.snapshot) {
          setMatchData(response.snapshot);
        }
        if (response?.log) {
          setSyncMessage(buildActionFeedback(response.log.message, response.notice, response.metrics));
          appendMatchLog(response.log);
        } else if (response?.notice) {
          setSyncMessage(buildActionFeedback('', response.notice, response.metrics));
        }
        if (import.meta.env.DEV && response?.metrics) {
          console.info('[match perf][client]', action, response.metrics);
        }
      } else {
        let snapshot = null;

        if (action === 'match:draw') {
          snapshot = await matchApi.draw({ roomId: currentRoom.id, token });
        } else if (action === 'match:playCard') {
          snapshot = await matchApi.playCard({
            roomId: currentRoom.id,
            token,
            cardId: payload.cardId,
            targetUserId: payload.targetUserId,
            selectedExileCardId: payload.selectedExileCardId,
          });
        } else if (action === 'match:discardCard') {
          snapshot = await matchApi.discardCard({
            roomId: currentRoom.id,
            token,
            cardId: payload.cardId,
            targetUserId: payload.targetUserId,
            selectedExileCardId: payload.selectedExileCardId,
          });
        } else if (action === 'match:endTurn') {
          snapshot = await matchApi.endTurn({ roomId: currentRoom.id, token });
        }

        if (snapshot) {
          setMatchData({
            ...snapshot,
            matchPlayers: snapshot.playerStates || [],
          });
          setSyncMessage(snapshot.actionNotice || '');
        }
      }
    } catch (error) {
      setLocalError(formatErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  const currentTurnPlayer = players.find((player) => player.user_id === activeTurnPlayerId);
  const isCurrentUserTurn = Boolean(user?.id && activeTurnPlayerId === user.id);
  const currentZones = currentUserState?.zones || {
    deckCount: 0,
    handCount: 0,
    exileCount: 0,
  };
  const handCards = currentUserState?.handCards || [];
  const exileCards = currentUserState?.exileCards || [];
  const availableActions = currentUserState?.availableActions || [];
  const hasDrawnThisTurn = Boolean(currentUserState?.hasDrawnThisTurn);
  const connectionState = !socket ? 'offline' : isSocketConnected ? 'connected' : 'reconnecting';
  const connectionLabel =
    connectionState === 'connected'
      ? 'Conectado'
      : connectionState === 'reconnecting'
        ? 'Reconectando...'
        : 'Desconectado';

  function handleEndTurnClick() {
    if (!hasDrawnThisTurn) {
      setIsEndTurnConfirmOpen(true);
      return;
    }

    handleAction('match:endTurn');
  }

  function handleConfirmEndTurn() {
    setIsEndTurnConfirmOpen(false);
    handleAction('match:endTurn');
  }

  function openCardAction(action, cardId) {
    const targetCard = handCards.find((card) => card.instanceId === cardId);
    if (!targetCard) {
      return;
    }

    const automation = getCardActionAutomation(targetCard, action);
    const targetOptions = getTargetOptions(players, user?.id, automation?.targetScope);
    const pairedCandidates =
      action === 'match:playCard' && targetCard.canPlayTogether
        ? getPlayableTogetherCandidates(handCards, cardId)
        : [];
    const requiresTarget = Boolean(automation?.targetScope);
    const requiresExileSelection = automation?.selection === 'own-exile-card' && exileCards.length > 0;
    const allowsPairedCard = action === 'match:playCard' && pairedCandidates.length > 0;

    if (!requiresTarget && !requiresExileSelection && !allowsPairedCard) {
      handleAction(action, { cardId });
      return;
    }

    setLocalError('');
    setPendingCardAction({
      action,
      cardId,
      cardName: targetCard.name,
      automation,
      targetUserId: targetOptions[0]?.user_id || null,
      selectedExileCardId: requiresExileSelection ? exileCards[0]?.instanceId || null : null,
      pairedCardId: null,
      pairedCardName: '',
      pairedAutomation: null,
      pairedTargetUserId: null,
      pairedSelectedExileCardId: null,
    });
  }

  function closePendingCardAction() {
    setPendingCardAction(null);
  }

  async function handleConfirmPendingCardAction() {
    if (!pendingCardAction) {
      return;
    }

    const requiresTarget = Boolean(pendingCardAction.automation?.targetScope);
    const requiresExileSelection =
      pendingCardAction.automation?.selection === 'own-exile-card' && exileCards.length > 0;
    const requiresPairedTarget =
      Boolean(pendingCardAction.pairedCardId) &&
      Boolean(pendingCardAction.pairedAutomation?.targetScope);
    const requiresPairedExileSelection =
      Boolean(pendingCardAction.pairedCardId) &&
      pendingCardAction.pairedAutomation?.selection === 'own-exile-card' &&
      exileCards.length > 0;

    if (requiresTarget && !pendingCardAction.targetUserId) {
      setLocalError('Selecione um alvo para essa carta.');
      return;
    }

    if (requiresExileSelection && !pendingCardAction.selectedExileCardId) {
      setLocalError('Selecione uma carta do seu exilio.');
      return;
    }

    if (requiresPairedTarget && !pendingCardAction.pairedTargetUserId) {
      setLocalError('Selecione um alvo para a carta jogada junto.');
      return;
    }

    if (requiresPairedExileSelection && !pendingCardAction.pairedSelectedExileCardId) {
      setLocalError('Selecione uma carta do seu exilio para a carta jogada junto.');
      return;
    }

    const payload = {
      cardId: pendingCardAction.cardId,
      targetUserId: pendingCardAction.targetUserId || undefined,
      selectedExileCardId: pendingCardAction.selectedExileCardId || undefined,
      pairedCardId: pendingCardAction.pairedCardId || undefined,
      pairedTargetUserId: pendingCardAction.pairedTargetUserId || undefined,
      pairedSelectedExileCardId: pendingCardAction.pairedSelectedExileCardId || undefined,
    };

    closePendingCardAction();
    await handleAction(pendingCardAction.action, payload);
  }

  const pendingTargetOptions = getTargetOptions(players, user?.id, pendingCardAction?.automation?.targetScope);
  const pendingPairedTargetOptions = getTargetOptions(players, user?.id, pendingCardAction?.pairedAutomation?.targetScope);
  const pendingPairedCandidates = getPlayableTogetherCandidates(handCards, pendingCardAction?.cardId);
  const pendingPrimaryCard = handCards.find((card) => card.instanceId === pendingCardAction?.cardId) || null;
  const pendingSecondaryCard = handCards.find((card) => card.instanceId === pendingCardAction?.pairedCardId) || null;

  return (
    <section className="match-shell">
      <div className="match-header">
        <div className="match-header__meta">
          <div className="match-header__room">
            <span className="status-label">Sala</span>
            <strong>{currentRoom?.code || 'Sem sala'}</strong>
          </div>

          <Badge tone={connectionState === 'connected' ? 'success' : connectionState === 'reconnecting' ? 'accent' : 'danger'}>
            <span className={['status-dot', `status-dot--${connectionState}`].join(' ')} aria-hidden="true" />
            {connectionLabel}
          </Badge>
        </div>

        <TurnBanner isCurrentUser={isCurrentUserTurn} playerName={currentTurnPlayer?.username} />

        <div className="match-header__utility">
          <div className="match-header__stats">
            <div className="status-item">
              <span className="status-label">Round</span>
              <span className="status-value">{currentMatch?.round ?? '-'}</span>
            </div>
          </div>

          <form className="match-join-form" onSubmit={handleJoinRoom}>
            <Input onChange={(event) => setRoomCode(event.target.value)} placeholder="Codigo da sala" required value={roomCode} />

            <div className="row-wrap">
              <Button loading={isSubmitting} type="submit" variant="secondary">
                Entrar na sala
              </Button>

              <Button disabled={isSubmitting || !currentRoom} onClick={handleLeaveRoom} type="button" variant="secondary">
                Sair da sala
              </Button>
            </div>
          </form>
        </div>
      </div>

      {(syncMessage || localError) ? (
        <div className="match-feedback">
          {syncMessage ? <p className="success-text">{syncMessage}</p> : null}
          {localError ? <p className="error-text">{localError}</p> : null}
        </div>
      ) : null}

      <div className="match-grid">
        <aside className="match-left-column">
          <Card className="match-side-panel" description="Jogadores ativos na mesa." title="Jogadores">
            <div className="match-player-list">
              {players.length ? (
                players.map((player) => (
                  <PlayerCard
                    isActiveTurn={player.user_id === activeTurnPlayerId}
                    isCurrentUser={player.user_id === user?.id}
                    key={`${player.room_id}-${player.user_id}`}
                    player={{
                      ...player,
                      is_ready: player.is_ready,
                    }}
                  />
                ))
              ) : (
                <div className="empty-state">Sem jogadores sincronizados.</div>
              )}
            </div>
          </Card>
        </aside>

        <main className="match-main-column">
          <Card className="match-board-card" description="Zonas do jogador organizadas como tabuleiro." title="Seu campo">
            <div className="match-board">
              <div className="match-board__summary">
                <div className="status-item">
                  <span className="status-label">Vida</span>
                  <span className="status-value">{currentUserState?.health ?? '-'}</span>
                </div>

                <div className="status-item">
                  <span className="status-label">Imo</span>
                  <span className="status-value">
                    {currentUserState ? `${currentUserState.imo}/${currentUserState.maxImo}` : '-'}
                  </span>
                </div>

                <div className="status-item">
                  <span className="status-label">Cartas na mao</span>
                  <span className="status-value">{currentZones.handCount}</span>
                </div>
              </div>

              <div className="zones-grid">
                <ZoneContainer count={currentZones.deckCount} description="Fonte principal de compra." title="Deck" tone="primary" />
                <ZoneContainer
                  count={currentZones.exileCount}
                  description="Cartas exiladas."
                  onClick={() => setIsExileModalOpen(true)}
                  previewCards={exileCards}
                  title="Exilio"
                  tone="accent"
                />
              </div>
            </div>
          </Card>

          <Card
            className="player-hand-panel"
            description="Sua mao e o foco da mesa: selecione e jogue suas cartas daqui."
            title="Sua mao"
            actions={
              <div className="match-action-bar">
                <Button
                  disabled={isSubmitting || !currentRoom || !availableActions.includes('drawCard')}
                  onClick={() => handleAction('match:draw')}
                  variant="secondary"
                >
                  Comprar carta
                </Button>

                <Button
                  disabled={isSubmitting || !currentRoom || !availableActions.includes('endTurn')}
                  onClick={handleEndTurnClick}
                  variant="primary"
                >
                  Encerrar turno
                </Button>
              </div>
            }
          >
            <PlayerHand
              cards={handCards}
              canDiscard={availableActions.includes('discardCard')}
              canPlay={availableActions.includes('playCard')}
              isSubmitting={isSubmitting}
              onDiscardCard={(cardId) => openCardAction('match:discardCard', cardId)}
              onPlayCard={(cardId) => openCardAction('match:playCard', cardId)}
              onSelectCard={setSelectedHandCardId}
              selectedCardId={selectedHandCardId}
            />
          </Card>
        </main>

        <aside className="match-right-column">
          <Card className="match-side-panel" description="Feed dos eventos mais recentes." title="Log de acoes">
            <div className="log-list">
              {logs.length ? (
                logs.map((item, index) => <ActionLogItem item={item} key={`${item.id || 'log'}-${index}`} />)
              ) : (
                <div className="empty-state">Sem eventos por enquanto.</div>
              )}
            </div>
          </Card>
        </aside>
      </div>

      <Modal
        cancelLabel="Continuar turno"
        confirmLabel="Encerrar assim mesmo"
        description="Voce ainda nao comprou nenhuma carta neste turno. Tem certeza que quer encerrar?"
        isLoading={isSubmitting}
        onClose={() => setIsEndTurnConfirmOpen(false)}
        onConfirm={handleConfirmEndTurn}
        open={isEndTurnConfirmOpen}
        title="Confirmar encerramento"
      >
        <p className="muted-text">Se quiser seguir a sequencia completa do turno, jogue ou descarte uma carta e depois compre.</p>
      </Modal>

      <Modal
        cancelLabel="Cancelar"
        confirmLabel={pendingCardAction?.action === 'match:discardCard' ? 'Descartar carta' : 'Jogar carta'}
        description="Organize a jogada, escolha a carta extra se quiser e resolva os parametros automaticos em uma ordem mais clara."
        isLoading={isSubmitting}
        onClose={closePendingCardAction}
        onConfirm={handleConfirmPendingCardAction}
        open={Boolean(pendingCardAction)}
        title={pendingCardAction ? `${pendingCardAction.cardName}: resolver efeito` : 'Resolver efeito'}
      >
        <div className="combo-modal">
          <section className="combo-modal__hero">
            <div className="combo-modal__hero-card">
              {pendingPrimaryCard ? (
                <CardItem
                  category={pendingPrimaryCard.category}
                  cost={pendingPrimaryCard.category === 'imo' ? pendingPrimaryCard.imoCost || 0 : undefined}
                  costLabel="Custo Imo"
                  description={pendingPrimaryCard.effect}
                  imageSrc={resolveCardImageUrl(pendingPrimaryCard.imagePath)}
                  name={pendingPrimaryCard.name}
                  selected
                />
              ) : null}
            </div>

            <div className="combo-modal__hero-copy">
              <Badge tone="primary">Carta principal</Badge>
              <h3>{pendingCardAction?.cardName}</h3>
              <p className="muted-text">
                {pendingPrimaryCard?.canPlayTogether
                  ? 'Esta carta permite montar um combo. Escolha uma segunda carta se quiser ampliar a jogada.'
                  : 'Resolva os parametros automaticos desta jogada antes de confirmar.'}
              </p>

              <div className="combo-modal__summary">
                <div className="combo-modal__summary-item">
                  <span className="status-label">Carta extra</span>
                  <strong>{pendingSecondaryCard?.name || 'Nenhuma selecionada'}</strong>
                </div>

                <div className="combo-modal__summary-item">
                  <span className="status-label">Alvos</span>
                  <strong>
                    {pendingCardAction?.targetUserId || pendingCardAction?.pairedTargetUserId
                      ? 'Configurados'
                      : 'Nao exigidos'}
                  </strong>
                </div>
              </div>
            </div>
          </section>

          {pendingCardAction?.action === 'match:playCard' && pendingPrimaryCard?.canPlayTogether ? (
            <section className="combo-modal__section">
              <div className="combo-modal__section-head">
                <div>
                  <Badge tone="accent">Etapa 1</Badge>
                  <h4>Escolha a carta jogada junto</h4>
                </div>
                <p className="muted-text">A permissão vem da carta principal, então aqui você pode anexar qualquer outra carta da mão.</p>
              </div>

              <div className="combo-modal__choice-grid">
                <button
                  className={['combo-modal__choice-card', !pendingCardAction.pairedCardId ? 'is-selected' : ''].filter(Boolean).join(' ')}
                  onClick={() =>
                    setPendingCardAction((current) =>
                      current
                        ? {
                            ...current,
                            pairedCardId: null,
                            pairedCardName: '',
                            pairedAutomation: null,
                            pairedTargetUserId: null,
                            pairedSelectedExileCardId: null,
                          }
                        : current
                    )
                  }
                  type="button"
                >
                  <Badge tone={!pendingCardAction.pairedCardId ? 'primary' : 'secondary'}>Sem combo</Badge>
                  <strong>Jogar so a carta principal</strong>
                  <span className="muted-text">Use esta opcao se quiser uma jogada simples.</span>
                </button>

                {pendingPairedCandidates.map((card) => (
                  <button
                    className={['combo-modal__choice-card', pendingCardAction.pairedCardId === card.instanceId ? 'is-selected' : '']
                      .filter(Boolean)
                      .join(' ')}
                    key={card.instanceId}
                    onClick={() => {
                      const pairedAutomation = getCardActionAutomation(card, 'match:playCard');
                      const pairedTargetOptions = getTargetOptions(players, user?.id, pairedAutomation?.targetScope);
                      const pairedNeedsExile =
                        pairedAutomation?.selection === 'own-exile-card' && exileCards.length > 0;

                      setPendingCardAction((current) =>
                        current
                          ? {
                              ...current,
                              pairedCardId: card.instanceId,
                              pairedCardName: card.name,
                              pairedAutomation: pairedAutomation,
                              pairedTargetUserId: pairedTargetOptions[0]?.user_id || null,
                              pairedSelectedExileCardId: pairedNeedsExile ? exileCards[0]?.instanceId || null : null,
                            }
                          : current
                      );
                    }}
                    type="button"
                  >
                    <div className="combo-modal__choice-card-top">
                      <Badge tone={pendingCardAction.pairedCardId === card.instanceId ? 'primary' : 'secondary'}>
                        {card.category}
                      </Badge>
                      {card.category === 'imo' ? <Badge tone="accent">Imo {card.imoCost || 0}</Badge> : null}
                    </div>
                    <strong>{card.name}</strong>
                    <span className="muted-text">{card.effect}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {pendingCardAction?.automation?.targetScope || pendingCardAction?.automation?.selection === 'own-exile-card' ? (
            <section className="combo-modal__section">
              <div className="combo-modal__section-head">
                <div>
                  <Badge tone="secondary">Etapa 2</Badge>
                  <h4>Resolva a carta principal</h4>
                </div>
                <p className="muted-text">Defina os parametros automaticos exigidos pela carta que iniciou a jogada.</p>
              </div>

              {pendingCardAction?.automation?.targetScope ? (
                <div className="combo-modal__subsection">
                  <span className="status-label">Escolha o alvo</span>
                  {pendingTargetOptions.length ? (
                    <div className="combo-modal__chip-row">
                      {pendingTargetOptions.map((player) => (
                        <Button
                          key={player.user_id}
                          onClick={() =>
                            setPendingCardAction((current) =>
                              current
                                ? {
                                    ...current,
                                    targetUserId: player.user_id,
                                  }
                                : current
                            )
                          }
                          type="button"
                          variant={pendingCardAction.targetUserId === player.user_id ? 'primary' : 'secondary'}
                        >
                          {player.username}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <p className="muted-text">Nenhum alvo disponivel para essa carta.</p>
                  )}
                </div>
              ) : null}

              {pendingCardAction?.automation?.selection === 'own-exile-card' ? (
                <div className="combo-modal__subsection">
                  <span className="status-label">Escolha a carta do exilio</span>
                  {exileCards.length ? (
                    <div className="exile-modal-grid combo-modal__card-grid">
                      {exileCards.map((card) => (
                        <CardItem
                          category={card.category}
                          cost={card.category === 'imo' ? card.imoCost || 0 : undefined}
                          costLabel="Custo Imo"
                          description={card.effect}
                          footer={
                            <div className="row-wrap">
                              <Button
                                onClick={() =>
                                  setPendingCardAction((current) =>
                                    current
                                      ? {
                                          ...current,
                                          selectedExileCardId: card.instanceId,
                                        }
                                      : current
                                  )
                                }
                                size="sm"
                                type="button"
                                variant={pendingCardAction.selectedExileCardId === card.instanceId ? 'primary' : 'secondary'}
                              >
                                {pendingCardAction.selectedExileCardId === card.instanceId ? 'Selecionada' : 'Selecionar'}
                              </Button>
                            </div>
                          }
                          imageSrc={resolveCardImageUrl(card.imagePath)}
                          key={card.instanceId}
                          name={card.name}
                          selected={pendingCardAction.selectedExileCardId === card.instanceId}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="muted-text">Seu exilio esta vazio; o efeito sera resolvido sem recuperar carta.</p>
                  )}
                </div>
              ) : null}
            </section>
          ) : null}

          {pendingCardAction?.pairedCardId ? (
            <section className="combo-modal__section">
              <div className="combo-modal__section-head">
                <div>
                  <Badge tone="primary">Carta extra</Badge>
                  <h4>{pendingCardAction.pairedCardName}</h4>
                </div>
                <p className="muted-text">Se a carta jogada junto exigir parametros automaticos, resolva-os aqui.</p>
              </div>

              <div className="combo-modal__secondary-preview">
                {pendingSecondaryCard ? (
                  <CardItem
                    category={pendingSecondaryCard.category}
                    cost={pendingSecondaryCard.category === 'imo' ? pendingSecondaryCard.imoCost || 0 : undefined}
                    costLabel="Custo Imo"
                    description={pendingSecondaryCard.effect}
                    imageSrc={resolveCardImageUrl(pendingSecondaryCard.imagePath)}
                    name={pendingSecondaryCard.name}
                    selected
                  />
                ) : null}
              </div>

              {pendingCardAction?.pairedAutomation?.targetScope ? (
                <div className="combo-modal__subsection">
                  <span className="status-label">Escolha o alvo da carta extra</span>
                  {pendingPairedTargetOptions.length ? (
                    <div className="combo-modal__chip-row">
                      {pendingPairedTargetOptions.map((player) => (
                        <Button
                          key={`paired-target-${player.user_id}`}
                          onClick={() =>
                            setPendingCardAction((current) =>
                              current
                                ? {
                                    ...current,
                                    pairedTargetUserId: player.user_id,
                                  }
                                : current
                            )
                          }
                          type="button"
                          variant={pendingCardAction.pairedTargetUserId === player.user_id ? 'primary' : 'secondary'}
                        >
                          {player.username}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <p className="muted-text">Nenhum alvo disponivel para a carta jogada junto.</p>
                  )}
                </div>
              ) : null}

              {pendingCardAction?.pairedAutomation?.selection === 'own-exile-card' ? (
                <div className="combo-modal__subsection">
                  <span className="status-label">Escolha a carta do exilio para a carta extra</span>
                  {exileCards.length ? (
                    <div className="exile-modal-grid combo-modal__card-grid">
                      {exileCards.map((card) => (
                        <CardItem
                          category={card.category}
                          cost={card.category === 'imo' ? card.imoCost || 0 : undefined}
                          costLabel="Custo Imo"
                          description={card.effect}
                          footer={
                            <div className="row-wrap">
                              <Button
                                onClick={() =>
                                  setPendingCardAction((current) =>
                                    current
                                      ? {
                                          ...current,
                                          pairedSelectedExileCardId: card.instanceId,
                                        }
                                      : current
                                  )
                                }
                                size="sm"
                                type="button"
                                variant={pendingCardAction.pairedSelectedExileCardId === card.instanceId ? 'primary' : 'secondary'}
                              >
                                {pendingCardAction.pairedSelectedExileCardId === card.instanceId ? 'Selecionada' : 'Selecionar'}
                              </Button>
                            </div>
                          }
                          imageSrc={resolveCardImageUrl(card.imagePath)}
                          key={`paired-exile-${card.instanceId}`}
                          name={card.name}
                          selected={pendingCardAction.pairedSelectedExileCardId === card.instanceId}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="muted-text">Seu exilio esta vazio; a carta jogada junto nao podera recuperar carta.</p>
                  )}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </Modal>

      <Modal
        cancelLabel={null}
        confirmLabel="Fechar"
        description="As cartas aparecem em ordem no exilio: do topo para o fundo."
        onClose={() => setIsExileModalOpen(false)}
        onConfirm={() => setIsExileModalOpen(false)}
        open={isExileModalOpen}
        title="Exilio"
      >
        {exileCards.length ? (
          <div className="exile-modal-grid">
            {exileCards.map((card, index) => (
              <CardItem
                category={card.category}
                cost={card.category === 'imo' ? card.imoCost || 0 : undefined}
                costLabel="Custo Imo"
                description={card.effect}
                footer={
                  <div className="exile-card-order">
                    <span>{index === 0 ? 'Topo do exilio' : `Posicao ${index + 1}`}</span>
                    <span>{index === exileCards.length - 1 ? 'Fundo' : null}</span>
                  </div>
                }
                imageSrc={resolveCardImageUrl(card.imagePath)}
                key={card.instanceId}
                name={card.name}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">Nenhuma carta exilada no momento.</div>
        )}
      </Modal>
    </section>
  );
}
