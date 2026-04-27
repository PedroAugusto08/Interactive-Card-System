import { Button } from '../ui/Button';
import { CardItem } from './CardItem';
import { resolveCardImageUrl } from '../../utils/cardImages';

export function PlayerHand({
  cards = [],
  selectedCardId = null,
  isSubmitting = false,
  canPlay = false,
  canDiscard = false,
  onSelectCard,
  onPlayCard,
  onDiscardCard,
}) {
  if (!cards.length) {
    return <div className="empty-state">Sem cartas na mão no momento.</div>;
  }

  return (
    <div className="player-hand">
      {cards.map((card) => {
        const isSelected = selectedCardId === card.instanceId;

        return (
          <div className="player-hand__slot" key={card.instanceId}>
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

                  <Button
                    disabled={!canDiscard || isSubmitting || card.canDiscard === false}
                    onClick={() => onDiscardCard?.(card.instanceId)}
                    size="sm"
                    variant="secondary"
                  >
                    Descartar
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
