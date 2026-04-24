import { useEffect, useMemo, useState } from 'react';

import { CardItem } from '../components/system/CardItem';
import { DeckCardRow } from '../components/system/DeckCardRow';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { deckApi } from '../api/deckApi';
import { useAuthStore } from '../stores/authStore';
import { formatErrorMessage } from '../utils/formatError';

const CATEGORY_LABEL = {
  fixed: 'Fixa',
  division: 'Divisao',
  imo: 'Imo',
};

const CATEGORY_ORDER = ['fixed', 'division', 'imo'];
const API_ORIGIN = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api').replace(/\/api\/?$/, '');
const CARDS_BASE_URL = (import.meta.env.VITE_SOCKET_URL || API_ORIGIN).replace(/\/$/, '');

function resolveCardImageUrl(imagePath) {
  if (!imagePath) {
    return '';
  }

  if (/^https?:\/\//i.test(imagePath)) {
    return imagePath;
  }

  const normalizedPath = imagePath.startsWith('/') ? imagePath : `/${imagePath}`;
  return `${CARDS_BASE_URL}${normalizedPath}`;
}

function buildEmptyDraft(catalog) {
  return catalog.reduce((accumulator, card) => {
    accumulator[card.id] = 0;
    return accumulator;
  }, {});
}

function buildDraftFromDeckCards(deckCards, catalog) {
  const draft = buildEmptyDraft(catalog);
  for (const entry of deckCards || []) {
    if (draft[entry.cardId] !== undefined) {
      draft[entry.cardId] = Number(entry.quantity) || 0;
    }
  }

  return draft;
}

function toCardsPayload(draftQuantities) {
  return Object.entries(draftQuantities)
    .filter(([, quantity]) => Number(quantity) > 0)
    .map(([cardId, quantity]) => ({
      cardId,
      quantity: Number(quantity),
    }));
}

function buildSummary(draftQuantities, catalogMap) {
  const categoryTotals = {
    fixed: 0,
    division: 0,
    imo: 0,
  };

  let totalCards = 0;

  for (const [cardId, rawQuantity] of Object.entries(draftQuantities)) {
    const quantity = Number(rawQuantity) || 0;
    if (quantity <= 0) {
      continue;
    }

    const card = catalogMap.get(cardId);
    if (!card) {
      continue;
    }

    totalCards += quantity;
    categoryTotals[card.category] += quantity;
  }

  return { totalCards, categoryTotals };
}

function getCategoryRuleLabel(category, rules) {
  if (!rules) {
    return '-';
  }

  if (category === 'fixed') {
    return `min ${rules.fixedMinCards}`;
  }

  if (category === 'division') {
    return `${rules.divisionMinCards} a ${rules.divisionMaxCards}`;
  }

  return `${rules.imoMinCards} a ${rules.imoMaxCards}`;
}

export function DecksPage() {
  const token = useAuthStore((state) => state.token);

  const [rules, setRules] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [decks, setDecks] = useState([]);

  const [selectedDeckId, setSelectedDeckId] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [draftQuantities, setDraftQuantities] = useState({});
  const [previewCard, setPreviewCard] = useState(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const catalogMap = useMemo(() => new Map(catalog.map((card) => [card.id, card])), [catalog]);
  const draftSummary = useMemo(() => buildSummary(draftQuantities, catalogMap), [draftQuantities, catalogMap]);
  const selectedDeck = useMemo(() => decks.find((deck) => deck.id === selectedDeckId) || null, [decks, selectedDeckId]);

  function applyDeckToForm(deck) {
    setSelectedDeckId(deck?.id || null);
    setName(deck?.name || '');
    setDescription(deck?.description || '');
    setDraftQuantities(buildDraftFromDeckCards(deck?.cards_json || [], catalog));
  }

  function resetForm() {
    setSelectedDeckId(null);
    setName('');
    setDescription('');
    setDraftQuantities(buildEmptyDraft(catalog));
  }

  async function refreshDecks() {
    const listResponse = await deckApi.listDecks({ token });
    setDecks(listResponse.decks);
    return listResponse.decks;
  }

  useEffect(() => {
    let isMounted = true;

    async function loadInitialData() {
      try {
        const [rulesResponse, catalogResponse, decksResponse] = await Promise.all([
          deckApi.getRules({ token }),
          deckApi.getCatalog({ token }),
          deckApi.listDecks({ token }),
        ]);

        if (!isMounted) {
          return;
        }

        setRules(rulesResponse.rules);
        setCatalog(catalogResponse.catalog);
        setDecks(decksResponse.decks);
        setDraftQuantities(buildEmptyDraft(catalogResponse.catalog));
      } catch (error) {
        if (isMounted) {
          setErrorMessage(formatErrorMessage(error));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadInitialData();

    return () => {
      isMounted = false;
    };
  }, [token]);

  function handleQuantityChange(cardId, rawValue) {
    const card = catalogMap.get(cardId);
    if (!card) {
      return;
    }

    const parsedValue = Number(rawValue);
    const safeValue = Number.isInteger(parsedValue) ? Math.max(0, Math.min(parsedValue, card.maxCopies)) : 0;

    setDraftQuantities((previous) => ({
      ...previous,
      [cardId]: safeValue,
    }));
  }

  function handleSelectDeck(deck) {
    applyDeckToForm(deck);
    setErrorMessage('');
    setStatusMessage(`Deck ${deck.name} carregado para edicao.`);
  }

  function handlePreviewCard(card) {
    setPreviewCard(card);
  }

  function handleClosePreview() {
    setPreviewCard(null);
  }

  async function handleSaveDeck(event) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const cards = toCardsPayload(draftQuantities);
      if (!cards.length) {
        throw new Error('Selecione ao menos uma carta para montar o deck.');
      }

      const payload = { name, description, cards };

      let savedDeck;
      if (selectedDeckId) {
        const response = await deckApi.updateDeck({ token, deckId: selectedDeckId, payload });
        savedDeck = response.deck;
      } else {
        const response = await deckApi.createDeck({ token, payload });
        savedDeck = response.deck;
      }

      const decksList = await refreshDecks();
      const persistedDeck = decksList.find((deck) => deck.id === savedDeck.id) || savedDeck;
      applyDeckToForm(persistedDeck);

      setStatusMessage(selectedDeckId ? 'Deck atualizado com sucesso.' : 'Deck criado com sucesso.');
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteDeck(deck) {
    const shouldDelete = window.confirm(`Deseja remover o deck ${deck.name}?`);
    if (!shouldDelete) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      await deckApi.deleteDeck({ token, deckId: deck.id });
      await refreshDecks();

      if (selectedDeckId === deck.id) {
        resetForm();
      }

      setStatusMessage('Deck removido com sucesso.');
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="stack-gap-lg">
      <div className="section-header">
        <div className="stack-gap" style={{ gap: '10px' }}>
          <Badge tone="primary">Deck Builder</Badge>
          <h1 className="page-title">Monte seu arsenal</h1>
          <p className="page-subtitle">
            O backend valida o baralho inteiro, enquanto a UI destaca composicao, categorias e selecao de cartas.
          </p>
        </div>
      </div>

      <div className="deck-builder-layout">
        <div className="deck-builder-left">
          <Card description="Acompanhe rapidamente a composicao antes de salvar." title="Resumo do deck">
            {isLoading ? <p className="muted-text">Carregando regras e cartas...</p> : null}
            {statusMessage ? <p className="success-text">{statusMessage}</p> : null}
            {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

            {!isLoading && rules ? (
              <div className="deck-summary-grid" style={{ marginTop: '16px' }}>
                <div className="deck-summary-box">
                  <span className="status-label">Total</span>
                  <strong>{draftSummary.totalCards}</strong>
                  <span className="muted-text compact">Limite {rules.minCards}-{rules.maxCards}</span>
                </div>
                {CATEGORY_ORDER.map((category) => (
                  <div className="deck-summary-box" key={category}>
                    <span className="status-label">{CATEGORY_LABEL[category]}</span>
                    <strong>{draftSummary.categoryTotals[category] || 0}</strong>
                    <span className="muted-text compact">Regra {getCategoryRuleLabel(category, rules)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </Card>

          <Card description="Configure nome, descricao e quantidades." title={selectedDeck ? `Editando: ${selectedDeck.name}` : 'Novo deck'}>
            <form className="stack-gap" onSubmit={handleSaveDeck}>
              <div className="deck-meta-grid">
                <Input
                  id="deck-name"
                  label="Nome do deck"
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ex.: Divisao Ofensiva"
                  required
                  value={name}
                />

                <Input
                  id="deck-description"
                  label="Descricao"
                  multiline
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Resumo do estilo do deck"
                  rows={3}
                  value={description}
                />
              </div>

              <div className="row-wrap">
                <Button disabled={isLoading} loading={isSubmitting} type="submit">
                  {selectedDeck ? 'Salvar alteracoes' : 'Criar deck'}
                </Button>

                <Button disabled={isSubmitting || isLoading} onClick={resetForm} type="button" variant="secondary">
                  Limpar formulario
                </Button>
              </div>
            </form>
          </Card>

          <Card description="Selecione as quantidades com feedback visual imediato." title="Catalogo de cartas">
            <div className="deck-catalog-grid">
              {catalog.map((card) => (
                <CardItem
                  category={CATEGORY_LABEL[card.category]}
                  description={card.effect}
                  footer={
                    <Input
                      inputClassName="compact"
                      label="Quantidade"
                      max={card.maxCopies}
                      min="0"
                      onChange={(event) => handleQuantityChange(card.id, event.target.value)}
                      type="number"
                      value={draftQuantities[card.id] ?? 0}
                    />
                  }
                  imageSrc={resolveCardImageUrl(card.imagePath)}
                  key={card.id}
                  maxCopies={card.maxCopies}
                  name={card.name}
                  onClick={() => handlePreviewCard(card)}
                  selected={Number(draftQuantities[card.id] ?? 0) > 0}
                  showDescription={false}
                />
              ))}
            </div>
          </Card>
        </div>

        <div className="deck-builder-right">
          <Card description="Baralhos salvos para edicao ou exclusao." title="Meus decks">
            <div className="stack-gap">
              {decks.length ? (
                decks.map((deck) => (
                  <DeckCardRow
                    deck={deck}
                    isSelected={selectedDeckId === deck.id}
                    key={deck.id}
                    onDelete={handleDeleteDeck}
                    onEdit={handleSelectDeck}
                  />
                ))
              ) : (
                <div className="empty-state">Nenhum deck salvo ainda.</div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Modal
        cancelLabel="Fechar"
        confirmLabel="Entendi"
        description={previewCard?.effect}
        onClose={handleClosePreview}
        onConfirm={handleClosePreview}
        open={Boolean(previewCard)}
        title={previewCard?.name || 'Detalhes da carta'}
      >
        {previewCard ? (
          <div className="stack-gap">
            <div className="game-card__image-wrap">
              <img
                alt={`Carta ${previewCard.name}`}
                className="game-card__image"
                src={resolveCardImageUrl(previewCard.imagePath)}
              />
            </div>

            <div className="row-wrap game-card__badges">
              <Badge tone="secondary">{CATEGORY_LABEL[previewCard.category]}</Badge>
              <Badge tone="accent">Max {previewCard.maxCopies}</Badge>
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
