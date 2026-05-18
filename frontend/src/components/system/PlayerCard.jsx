import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';

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
  selectedCharacter = null,
}) {
  const selectedCharacters = Array.isArray(player?.selected_characters)
    ? player.selected_characters
    : selectedCharacter
      ? [selectedCharacter]
      : [];
  const isMaster = Boolean(player?.is_master);

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
              {isMaster ? <Badge tone="accent">Mestre</Badge> : null}
              {isActiveTurn ? <Badge tone="accent">Turno ativo</Badge> : null}
            </div>
            <span className="muted-text compact">
              {isMaster ? 'Controla criaturas e a ordem da rodada' : 'Aguardando a abertura da partida'}
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
            <span>{player.is_ready ? 'Pronto' : 'Não pronto'}</span>
          </div>
        </div>

        <div className="player-card__deck">
          <span className="status-label">{isMaster ? 'Criaturas selecionadas' : 'Personagem selecionado'}</span>
          {isMaster ? (
            selectedCharacters.length ? (
              <div className="stack-gap" style={{ gap: '4px' }}>
                {selectedCharacters.map((character) => (
                  <strong key={`master-character-${character.id}`}>{character.name}</strong>
                ))}
                <span className="muted-text compact">
                  {selectedCharacters.length} criatura{selectedCharacters.length === 1 ? '' : 's'} selecionada
                  {selectedCharacters.length === 1 ? '' : 's'}.
                </span>
              </div>
            ) : (
              <span className="muted-text compact">Selecione ao menos um personagem para liberar o pronto.</span>
            )
          ) : (
            <>
              <strong>{selectedCharacter?.name || 'Personagem não selecionado'}</strong>
              <span className="muted-text compact">
                {selectedCharacter ? 'Pronto para entrar no combate.' : 'Selecione um personagem para liberar o pronto.'}
              </span>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
