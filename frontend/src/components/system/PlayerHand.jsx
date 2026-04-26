import { Button } from '../ui/Button';
import { CardItem } from './CardItem';
import { resolveCardImageUrl } from '../../utils/cardImages';

export function PlayerHand({
  cards = [],
  selectedCardId = null,
  isSubmitting = false,
  canPlay = false,
  onSelectCard,
  onPlayCard,
}) {
  if (!cards.length) {
    return <div className="empty-state">Sem cartas na mão no momento.</div>;
  }

  return (
    <div className="player-hand">
      {cards.map((card, index) => {
        const isSelected = selectedCardId === card.instanceId;

        return (
          <div
            className="player-hand__slot"
            key={card.instanceId}
            style={{
              '--hand-rotate': `${(index - (cards.length - 1) / 2) * 2.4}deg`,
              '--hand-lift': `${Math.abs(index - (cards.length - 1) / 2) * 4}px`,
            }}
          >
            <CardItem
              category={card.category}
              className="player-hand__card"
              cost={card.category === 'imo' ? card.imoCost || 0 : undefined}
              costLabel="Custo Imo"
              description={card.effect}
              footer={
                <div className="row-wrap">
                  <Button
                    disabled={!canPlay || isSubmitting}
                    onClick={() => onPlayCard?.(card.instanceId)}
                    size="sm"
                  >
                    Jogar
                  </Button>
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
  );
}
