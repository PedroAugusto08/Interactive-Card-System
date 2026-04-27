import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { getDeckCardCount } from '../../utils/lobbyUi';

function getInitials(name) {
  return String(name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}

export function PlayerCard({
  player,
  isActiveTurn = false,
  isCurrentUser = false,
  isHost = false,
  selectedDeck = null,
}) {
  const deckCardCount = getDeckCardCount(selectedDeck);

  return (
    <Card
      className={['player-card', isActiveTurn ? 'player-card--active-turn' : ''].filter(Boolean).join(' ')}
      compact
      glow={isActiveTurn}
      interactive
      selected={isActiveTurn}
    >
      <div className="player-card__main">
        <div className="player-card__identity">
          <div className="player-card__avatar">{getInitials(player.username)}</div>

          <div className="player-card__identity-copy">
            <div className="player-card__name-row">
              <strong className="player-card__name">{player.username}</strong>
              {isCurrentUser ? <Badge tone="primary">Você</Badge> : null}
              {isHost ? <Badge tone="accent">Host</Badge> : null}
              {isActiveTurn ? <Badge tone="accent">Turno ativo</Badge> : null}
            </div>
            <span className="muted-text compact">
              {isHost ? 'Controla o inicio da sala' : 'Aguardando a abertura da partida'}
            </span>
          </div>
        </div>

        <div className="player-card__status-row">
          <div
            className={[
              'player-card__status-pill',
              player.is_ready ? 'player-card__status-pill--ready' : 'player-card__status-pill--pending',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span
              aria-hidden="true"
              className={[
                'player-card__status-dot',
                player.is_ready ? 'player-card__status-dot--ready' : 'player-card__status-dot--pending',
              ]
                .filter(Boolean)
                .join(' ')}
            />
            <span>{player.is_ready ? 'Pronto' : 'Nao pronto'}</span>
          </div>
        </div>

        <div className="player-card__deck">
          <span className="status-label">Deck selecionado</span>
          <strong>{selectedDeck?.name || 'Deck nao selecionado'}</strong>
          <span className="muted-text compact">
            {deckCardCount ? `${deckCardCount} cartas` : 'Selecione um deck para liberar o pronto.'}
          </span>
        </div>
      </div>
    </Card>
  );
}
