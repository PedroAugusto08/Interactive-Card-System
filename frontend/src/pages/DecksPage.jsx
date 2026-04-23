import { useEffect, useMemo, useState } from 'react';

import { deckApi } from '../api/deckApi';
import { useAuthStore } from '../stores/authStore';
import { formatErrorMessage } from '../utils/formatError';

const CATEGORY_LABEL = {
  fixed: 'Fixa',
  division: 'Divisao',
  imo: 'Imo',
};

const CATEGORY_ORDER = ['fixed', 'division', 'imo'];
const CARDS_BASE_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

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

// Tela de construcao e CRUD de baralho usando o catalogo oficial do backend.
export function DecksPage() {
  const token = useAuthStore((state) => state.token);

  const [rules, setRules] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [decks, setDecks] = useState([]);

  const [selectedDeckId, setSelectedDeckId] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [draftQuantities, setDraftQuantities] = useState({});

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const catalogMap = useMemo(() => {
    return new Map(catalog.map((card) => [card.id, card]));
  }, [catalog]);

  const draftSummary = useMemo(() => {
    return buildSummary(draftQuantities, catalogMap);
  }, [draftQuantities, catalogMap]);

  const selectedDeck = useMemo(() => {
    return decks.find((deck) => deck.id === selectedDeckId) || null;
  }, [decks, selectedDeckId]);

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

  async function loadDeckModuleData() {
    setIsLoading(true);
    setErrorMessage('');

    try {
      const [rulesResponse, catalogResponse, decksResponse] = await Promise.all([
        deckApi.getRules({ token }),
        deckApi.getCatalog({ token }),
        deckApi.listDecks({ token }),
      ]);

      setRules(rulesResponse.rules);
      setCatalog(catalogResponse.catalog);
      setDecks(decksResponse.decks);
      setDraftQuantities(buildEmptyDraft(catalogResponse.catalog));
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadDeckModuleData();
  }, []);

  function handleQuantityChange(cardId, rawValue) {
    const card = catalogMap.get(cardId);
    if (!card) {
      return;
    }

    const parsedValue = Number(rawValue);
    const safeValue = Number.isInteger(parsedValue)
      ? Math.max(0, Math.min(parsedValue, card.maxCopies))
      : 0;

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

      const payload = {
        name,
        description,
        cards,
      };

      let savedDeck;
      if (selectedDeckId) {
        const response = await deckApi.updateDeck({
          token,
          deckId: selectedDeckId,
          payload,
        });
        savedDeck = response.deck;
      } else {
        const response = await deckApi.createDeck({ token, payload });
        savedDeck = response.deck;
      }

      const listResponse = await deckApi.listDecks({ token });
      setDecks(listResponse.decks);

      const persistedDeck = listResponse.decks.find((deck) => deck.id === savedDeck.id) || savedDeck;
      applyDeckToForm(persistedDeck);

      setStatusMessage(
        selectedDeckId ? 'Deck atualizado com sucesso.' : 'Deck criado com sucesso.'
      );
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
      const listResponse = await deckApi.listDecks({ token });
      setDecks(listResponse.decks);

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
    <section className="stack-gap">
      <article className="card stack-gap">
        <h1>Deck Builder</h1>
        <p className="muted-text">
          Monte seu baralho com o catalogo oficial. O backend valida tamanho total, limites por
          categoria e maximo por carta.
        </p>

        {isLoading ? <p className="muted-text">Carregando regras e cartas...</p> : null}
        {statusMessage ? <p className="success-text">{statusMessage}</p> : null}
        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

        {!isLoading && rules ? (
          <div className="deck-rules-grid">
            <p>
              Total de cartas: <strong>{draftSummary.totalCards}</strong> (limite {rules.minCards}-
              {rules.maxCards})
            </p>
            {CATEGORY_ORDER.map((category) => (
              <p key={category}>
                {CATEGORY_LABEL[category]}: <strong>{draftSummary.categoryTotals[category] || 0}</strong>{' '}
                (regra {getCategoryRuleLabel(category, rules)})
              </p>
            ))}
          </div>
        ) : null}
      </article>

      <article className="card stack-gap">
        <h2>{selectedDeck ? `Editando: ${selectedDeck.name}` : 'Novo deck'}</h2>

        <form className="stack-gap" onSubmit={handleSaveDeck}>
          <div className="grid-2">
            <div className="stack-gap">
              <label htmlFor="deck-name">Nome do deck</label>
              <input
                id="deck-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex.: Divisao Ofensiva"
                required
              />
            </div>

            <div className="stack-gap">
              <label htmlFor="deck-description">Descricao</label>
              <textarea
                id="deck-description"
                className="deck-description-input"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Resumo do estilo do deck"
                rows={3}
              />
            </div>
          </div>

          <div className="deck-catalog-grid">
            {catalog.map((card) => (
              <div className="deck-card-item" key={card.id}>
                <img
                  className="deck-card-image"
                  src={`${CARDS_BASE_URL}${card.imagePath}`}
                  alt={`Carta ${card.name}`}
                  loading="lazy"
                />

                <div className="stack-gap">
                  <p className="deck-card-title">{card.name}</p>
                  <p className="compact muted-text">Categoria: {CATEGORY_LABEL[card.category]}</p>
                  <p className="compact muted-text">Maximo: {card.maxCopies}</p>
                  <p className="compact muted-text">{card.effect}</p>

                  <label htmlFor={`card-${card.id}`}>Quantidade</label>
                  <input
                    id={`card-${card.id}`}
                    type="number"
                    min="0"
                    max={card.maxCopies}
                    value={draftQuantities[card.id] ?? 0}
                    onChange={(event) => handleQuantityChange(card.id, event.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="row-wrap">
            <button className="solid-btn" type="submit" disabled={isSubmitting || isLoading}>
              {selectedDeck ? 'Salvar alteracoes' : 'Criar deck'}
            </button>

            <button
              className="ghost-btn"
              type="button"
              onClick={resetForm}
              disabled={isSubmitting || isLoading}
            >
              Limpar formulario
            </button>
          </div>
        </form>
      </article>

      <article className="card stack-gap">
        <h2>Meus decks</h2>

        {decks.length ? (
          <div className="stack-gap">
            {decks.map((deck) => (
              <div className="deck-row" key={deck.id}>
                <div>
                  <p className="deck-card-title">{deck.name}</p>
                  <p className="compact muted-text">{deck.description || 'Sem descricao'}</p>
                  <p className="compact muted-text">
                    Total: {deck.summary?.totalCards ?? 0} | Fixa:{' '}
                    {deck.summary?.categoryTotals?.fixed ?? 0} | Divisao:{' '}
                    {deck.summary?.categoryTotals?.division ?? 0} | Imo:{' '}
                    {deck.summary?.categoryTotals?.imo ?? 0}
                  </p>
                </div>

                <div className="row-wrap">
                  <button className="ghost-btn" type="button" onClick={() => handleSelectDeck(deck)}>
                    Editar
                  </button>

                  <button
                    className="ghost-btn"
                    type="button"
                    onClick={() => handleDeleteDeck(deck)}
                    disabled={isSubmitting}
                  >
                    Excluir
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted-text">Nenhum deck salvo ainda.</p>
        )}
      </article>
    </section>
  );
}
