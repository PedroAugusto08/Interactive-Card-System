export function TurnBanner({ isCurrentUser = false, playerName = '' }) {
  const title = isCurrentUser ? 'SUA VEZ' : `Turno de ${playerName || 'Jogador'}`;
  const toneClassName = isCurrentUser ? 'turn-banner--current' : 'turn-banner--other';

  return (
    <div className={['turn-banner', toneClassName].join(' ')}>
      <span className="turn-banner__eyebrow">Turno</span>
      <strong className="turn-banner__title">{title}</strong>
    </div>
  );
}
