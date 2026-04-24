import { useEffect, useState } from 'react';

import { ActionLogItem } from '../components/system/ActionLogItem';
import { CardItem } from '../components/system/CardItem';
import { PlayerCard } from '../components/system/PlayerCard';
import { ZoneContainer } from '../components/system/ZoneContainer';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { matchApi } from '../api/matchApi';
import { roomApi } from '../api/roomApi';
import { useSocket } from '../hooks/useSocket';
import { useAuthStore } from '../stores/authStore';
import { useRoomStore } from '../stores/roomStore';
import { formatErrorMessage } from '../utils/formatError';

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
  const clearRoom = useRoomStore((state) => state.clearRoom);

  const socket = useSocket(token);

  const [roomCode, setRoomCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  const [syncMessage, setSyncMessage] = useState('');

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
    }

    socket.on('room:update', handleRoomUpdate);
    socket.on('match:sync', handleMatchSync);
    socket.on('match:log', handleLog);

    return () => {
      socket.off('room:update', handleRoomUpdate);
      socket.off('match:sync', handleMatchSync);
      socket.off('match:log', handleLog);
    };
  }, [setMatchData, setRoomData, socket]);

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
        socket.emit(action, {
          roomId: currentRoom.id,
          ...payload,
        });
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
  const currentZones = currentUserState?.zones || {
    deckCount: 0,
    handCount: 0,
    discardCount: 0,
    exileCount: 0,
  };
  const handCards = currentUserState?.handCards || [];
  const availableActions = currentUserState?.availableActions || [];

  return (
    <section className="match-shell">
      <div className="match-topbar">
        <Card description="Sala, turno e conectividade em um topo consolidado." title="Match Control">
          <div className="status-grid">
            <div className="status-item">
              <span className="status-label">Sala</span>
              <span className="status-value">{currentRoom?.code || 'Sem sala'}</span>
            </div>
            <div className="status-item">
              <span className="status-label">Turno atual</span>
              <span className="status-value">{currentTurnPlayer?.username || '-'}</span>
            </div>
            <div className="status-item">
              <span className="status-label">Socket</span>
              <span className="status-value">{isSocketConnected ? 'conectado' : 'fallback HTTP'}</span>
            </div>
            <div className="status-item">
              <span className="status-label">Round</span>
              <span className="status-value">{currentMatch?.round ?? '-'}</span>
            </div>
          </div>
        </Card>

        <Card description="Conecte-se a uma sala ativa ou recupere o estado apos refresh." title="Acoes">
          <form className="stack-gap" onSubmit={handleJoinRoom}>
            <Input onChange={(event) => setRoomCode(event.target.value)} placeholder="Codigo da sala" required value={roomCode} />

            <div className="row-wrap">
              <Button loading={isSubmitting} type="submit">
                Entrar na sala
              </Button>

              <Button disabled={isSubmitting || !currentRoom} onClick={handleLeaveRoom} type="button" variant="secondary">
                Sair da sala
              </Button>
            </div>
          </form>

          <div className="row-wrap" style={{ marginTop: '16px' }}>
            <Button
              disabled={isSubmitting || !currentRoom || !availableActions.includes('drawCard')}
              onClick={() => handleAction('match:draw')}
              variant="secondary"
            >
              Comprar
            </Button>

            <Button
              disabled={isSubmitting || !currentRoom || !availableActions.includes('endTurn')}
              onClick={() => handleAction('match:endTurn')}
              variant="secondary"
            >
              Encerrar turno
            </Button>
          </div>

          {syncMessage ? <p className="success-text">{syncMessage}</p> : null}
          {localError ? <p className="error-text">{localError}</p> : null}
        </Card>
      </div>

      <div className="match-grid">
        <div className="match-side-column players-column">
          <Card description="Lista lateral com destaque visual para o turno ativo." title="Jogadores">
            <div className="stack-gap">
              <div className="row-wrap">
                <Badge tone="accent">{players.length} conectados</Badge>
                <Badge tone={isSocketConnected ? 'success' : 'secondary'}>
                  {isSocketConnected ? 'Tempo real' : 'Fallback HTTP'}
                </Badge>
              </div>

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
        </div>

        <div className="match-main-column">
          <Card description="Zonas e recursos reais da sua participacao na partida." title="Area principal">
            <div className="status-grid" style={{ marginBottom: '16px' }}>
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
            </div>

            <div className="zones-grid">
              <ZoneContainer count={currentZones.deckCount} description="Fonte principal de compra." title="Deck" tone="primary" />
              <ZoneContainer count={currentZones.discardCount} description="Cartas descartadas." title="Descarte" />
              <ZoneContainer count={currentZones.exileCount} description="Cartas exiladas." title="Exilio" />
              <ZoneContainer count={currentZones.handCount} description="Cartas atualmente na sua mao." title="Mao" tone="accent" />
            </div>
          </Card>

          <Card description="Jogue cartas reais da sua mao quando for seu turno." title="Sua mao">
            <div className="hand-grid">
              {handCards.length ? (
                handCards.map((card) => (
                  <CardItem
                    category={card.category}
                    description={card.effect}
                    footer={
                      <div className="row-wrap">
                        <Badge tone="accent">Custo {card.imoCost || 0}</Badge>
                        <Button
                          disabled={!availableActions.includes('playCard') || isSubmitting}
                          onClick={() => handleAction('match:playCard', { cardId: card.instanceId })}
                          size="sm"
                        >
                          Jogar
                        </Button>
                      </div>
                    }
                    imageSrc={card.imagePath}
                    key={card.instanceId}
                    name={card.name}
                    showDescription={false}
                  />
                ))
              ) : (
                <div className="empty-state">Sem cartas na mao no momento.</div>
              )}
            </div>
          </Card>
        </div>

        <div className="match-side-column">
          <Card description="Feed lateral para eventos e feedbacks da partida." title="Log de acoes">
            <div className="log-list">
              {logs.length ? (
                logs.map((item, index) => <ActionLogItem item={item} key={`${item.id || 'log'}-${index}`} />)
              ) : (
                <div className="empty-state">Sem eventos por enquanto.</div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
