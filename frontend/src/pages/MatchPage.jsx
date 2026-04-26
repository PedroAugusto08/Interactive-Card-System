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
          setSyncMessage(`${response.log.message}${import.meta.env.DEV ? formatPerfLabel(response.metrics) : ''}`);
          appendMatchLog(response.log);
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
          });
        } else if (action === 'match:discardCard') {
          snapshot = await matchApi.discardCard({
            roomId: currentRoom.id,
            token,
            cardId: payload.cardId,
          });
        } else if (action === 'match:endTurn') {
          snapshot = await matchApi.endTurn({ roomId: currentRoom.id, token });
        }

        if (snapshot) {
          setMatchData({
            ...snapshot,
            matchPlayers: snapshot.playerStates || [],
          });
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
    discardCount: 0,
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
              onDiscardCard={(cardId) => handleAction('match:discardCard', { cardId })}
              onPlayCard={(cardId) => handleAction('match:playCard', { cardId })}
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
        cancelLabel="Fechar"
        confirmLabel="Fechar"
        description="Todas as cartas atualmente exiladas pelo seu jogador."
        onClose={() => setIsExileModalOpen(false)}
        onConfirm={() => setIsExileModalOpen(false)}
        open={isExileModalOpen}
        title="Exilio"
      >
        {exileCards.length ? (
          <div className="exile-modal-grid">
            {exileCards.map((card) => (
              <CardItem
                category={card.category}
                cost={card.category === 'imo' ? card.imoCost || 0 : undefined}
                costLabel="Custo Imo"
                description={card.effect}
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
