import { resolveCardImageUrl } from '../../utils/cardImages';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { CardItem } from './CardItem';

function getCardStateLabel({ canCardPlay, canCardDiscard }) {
  if (canCardPlay) {
    return {
      text: 'Jogável agora',
      tone: 'success',
    };
  }

  if (canCardDiscard) {
    return {
      text: 'Pode descartar',
      tone: 'secondary',
    };
  }

  return null;
}

export function PlayerHand({
  cards = [],
  selectedCardId = null,
  isSubmitting = false,
  canPlay = false,
  canDiscard = false,
  onSelectCard,
  onPlayCard,
  onDiscardCard,
  helperText = '',
  helperTone = 'secondary',
  helperBadgeText = '',
  playDisabledReason = '',
  discardDisabledReason = '',
}) {
  if (!cards.length) {
    return <div className="empty-state">Sem cartas na mão no momento.</div>;
  }

  return (
    <div className="player-hand-panel">
      {helperText ? (
        <div className="player-hand-panel__status">
          {helperBadgeText ? <Badge tone={helperTone}>{helperBadgeText}</Badge> : null}
          <span className="muted-text compact">{helperText}</span>
        </div>
      ) : null}

      <div className="player-hand">
        {cards.map((card) => {
          const isSelected = selectedCardId === card.instanceId;
          const canCardPlay = canPlay && !isSubmitting;
          const canCardDiscard = canDiscard && !isSubmitting && card.canDiscard !== false;
          const cardState = getCardStateLabel({ canCardPlay, canCardDiscard });

          return (
            <div
              className={[
                'player-hand__slot',
                canCardPlay ? 'player-hand__slot--playable' : '',
                !canCardPlay && canCardDiscard ? 'player-hand__slot--discardable' : '',
                !canCardPlay && !canCardDiscard ? 'player-hand__slot--inactive' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              key={card.instanceId}
            >
              <CardItem
                category={card.category}
                className="player-hand__card"
                cost={card.category === 'imo' ? card.imoCost || 0 : undefined}
                costLabel="Custo Imo"
                description={card.effect}
                footer={
                  <div className="player-hand__footer">
                    {cardState ? (
                      <div className="player-hand__footer-top">
                        <Badge tone={cardState.tone}>{cardState.text}</Badge>
                      </div>
                    ) : null}

                    <div className="row-wrap">
                      <Button
                        disabled={!canPlay || isSubmitting}
                        onClick={() => onPlayCard?.(card.instanceId)}
                        size="sm"
                        title={!canCardPlay ? playDisabledReason || 'Essa ação não está disponível agora.' : 'Jogar carta'}
                      >
                        Jogar
                      </Button>

                      <Button
                        disabled={!canDiscard || isSubmitting || card.canDiscard === false}
                        onClick={() => onDiscardCard?.(card.instanceId)}
                        size="sm"
                        title={
                          !canCardDiscard
                            ? discardDisabledReason ||
                              (card.canDiscard === false
                                ? 'Essa carta não pode ser descartada agora.'
                                : 'Essa ação não está disponível agora.')
                            : 'Descartar carta'
                        }
                        variant="secondary"
                      >
                        Descartar
                      </Button>
                    </div>
                  </div>
                }
                imageSrc={resolveCardImageUrl(card.imagePath)}
                name={card.name}
                onClick={() => onSelectCard?.(card.instanceId)}
                selected={isSelected}
                showDescription={false}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
