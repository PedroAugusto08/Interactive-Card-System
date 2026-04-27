import { useEffect, useMemo, useState } from 'react';

import { CardItem } from '../components/system/CardItem';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { deckApi } from '../api/deckApi';
import { useAuthStore } from '../stores/authStore';
import { useDeckStore } from '../stores/deckStore';
import { DEFAULT_IMO_IMAGE, resolveCardImageUrl } from '../utils/cardImages';
import { formatErrorMessage } from '../utils/formatError';

const CATEGORY_LABEL = {
  fixed: 'Fixas',
  division: 'Divisao',
  imo: 'Imo',
};

const CATEGORY_ORDER = ['fixed', 'division', 'imo'];
const SORT_OPTIONS = ['name', 'cost', 'rarity'];
const SORT_LABEL = {
  name: 'Nome',
  cost: 'Custo',
  rarity: 'Raridade',
};
const STATUS_BADGE_TONE = {
  valid: 'success',
  incomplete: 'accent',
  exceeded: 'danger',
};

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

function mergeDraftWithCatalog(draftQuantities, catalog) {
  return {
    ...buildEmptyDraft(catalog),
    ...(draftQuantities || {}),
  };
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

function getCardCost(card) {
  if (typeof card?.imoCost === 'number') {
    return card.imoCost;
  }

  if (typeof card?.cost === 'number') {
    return card.cost;
  }

  return null;
}

function getCardRarityWeight(card) {
  const rarity = String(card?.rarity || '').toLowerCase();
  const map = {
    common: 1,
    uncommon: 2,
    rare: 3,
    epic: 4,
    legendary: 5,
  };

  return map[rarity] || 0;
}

function buildMetric({ key, label, current, min, max, exact = false }) {
  let state = 'valid';
  let message = `${label} pronta`;

  if (exact) {
    if (current < max) {
      state = 'incomplete';
      message = `Faltam ${max - current} carta(s) de ${label}`;
    } else if (current > max) {
      state = 'exceeded';
      message = `${current - max} carta(s) excedentes em ${label}`;
    }
  } else if (current < min) {
    state = 'incomplete';
    message = `Faltam ${min - current} carta(s) de ${label}`;
  } else if (current > max) {
    state = 'exceeded';
    message = `${current - max} carta(s) excedentes em ${label}`;
  }

  return {
    key,
    label,
    current,
    min,
    max,
    exact,
    state,
    message,
    displayValue: `${current}/${max}`,
    progress: max > 0 ? Math.min(current / max, 1) : 0,
  };
}

function buildDeckEvaluation(summary, rules) {
  if (!rules) {
    return null;
  }

  const metrics = {
    total: buildMetric({
      key: 'total',
      label: 'Total',
      current: summary.totalCards,
      min: rules.minCards,
      max: rules.maxCards,
    }),
    fixed: buildMetric({
      key: 'fixed',
      label: CATEGORY_LABEL.fixed,
      current: summary.categoryTotals.fixed || 0,
      min: 10,
      max: 10,
      exact: true,
    }),
    division: buildMetric({
      key: 'division',
      label: CATEGORY_LABEL.division,
      current: summary.categoryTotals.division || 0,
      min: rules.divisionMinCards,
      max: rules.divisionMaxCards,
    }),
    imo: buildMetric({
      key: 'imo',
      label: CATEGORY_LABEL.imo,
      current: summary.categoryTotals.imo || 0,
      min: rules.imoMinCards,
      max: rules.imoMaxCards,
    }),
  };

  const allMetrics = [metrics.total, metrics.fixed, metrics.division, metrics.imo];
  const firstExceeded = allMetrics.find((metric) => metric.state === 'exceeded');
  const firstIncomplete = [metrics.fixed, metrics.division, metrics.imo, metrics.total].find(
    (metric) => metric.state === 'incomplete'
  );

  let status = 'valid';
  let title = 'Deck valido';
  let message = 'Seu deck esta pronto para partida.';

  if (firstExceeded) {
    status = 'exceeded';
    title = 'Deck invalido';
    message =
      firstExceeded.key === 'total'
        ? `Voce excedeu o limite total em ${firstExceeded.current - firstExceeded.max} carta(s).`
        : `Limite de cartas ${firstExceeded.label} excedido.`;
  } else if (firstIncomplete) {
    status = 'incomplete';
    title = 'Deck incompleto';
    message =
      firstIncomplete.key === 'total'
        ? `Faltam ${firstIncomplete.min - firstIncomplete.current} carta(s) para fechar o total do deck.`
        : `Faltam ${firstIncomplete.min - firstIncomplete.current} carta(s) de ${firstIncomplete.label}.`;
  }

  const completion =
    allMetrics.reduce((total, metric) => total + metric.progress, 0) / allMetrics.length;

  return {
    metrics,
    status,
    title,
    message,
    completion,
    persistenceLabel: summary.totalCards > 0 ? 'Pronto para salvar' : 'Rascunho vazio',
  };
}

function sortCatalogCards(cards, sortBy) {
  const sortedCards = [...cards];

  sortedCards.sort((left, right) => {
    if (sortBy === 'cost') {
      const costDiff = (getCardCost(left) ?? Number.POSITIVE_INFINITY) - (getCardCost(right) ?? Number.POSITIVE_INFINITY);
      if (costDiff !== 0) {
        return costDiff;
      }
    }

    if (sortBy === 'rarity') {
      const rarityDiff = getCardRarityWeight(right) - getCardRarityWeight(left);
      if (rarityDiff !== 0) {
        return rarityDiff;
      }
    }

    return left.name.localeCompare(right.name, 'pt-BR');
  });

  return sortedCards;
}

function getMetricRuleText(metric) {
  if (metric.exact) {
    return `${metric.max} obrigatorias`;
  }

  return `${metric.min} a ${metric.max}`;
}

function getStatusDotClassName(status) {
  return [
    'deck-status-dot',
    status === 'valid' ? 'deck-status-dot--valid' : '',
    status === 'incomplete' ? 'deck-status-dot--incomplete' : '',
    status === 'exceeded' ? 'deck-status-dot--exceeded' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function DeckMetricCard({ metric }) {
  return (
    <article className={['deck-metric-card', `is-${metric.state}`].join(' ')}>
      <div className="deck-metric-card__top">
        <span className="deck-metric-card__label">{metric.label}</span>
        <Badge tone={STATUS_BADGE_TONE[metric.state]}>{metric.displayValue}</Badge>
      </div>
      <strong className="deck-metric-card__value">{metric.displayValue}</strong>
      <span className="deck-metric-card__hint">{getMetricRuleText(metric)}</span>
      <div className="deck-progress">
        <span className="deck-progress__bar">
          <span className="deck-progress__fill" style={{ width: `${Math.max(metric.progress * 100, 8)}%` }} />
        </span>
      </div>
    </article>
  );
}

function DeckCardControl({ card, quantity, onDecrease, onIncrease, onPreview }) {
  const isSelected = quantity > 0;
  const cost = getCardCost(card);
  const imageDescription = card.effect || 'Sem descricao adicional.';

  return (
    <Card
      className={['deck-catalog-card', isSelected ? 'is-selected' : ''].filter(Boolean).join(' ')}
      compact
      glow={isSelected}
      interactive
      selected={isSelected}
    >
      <div className="deck-catalog-card__media">
        <button
          aria-label={`Abrir detalhes da carta ${card.name}`}
          className="deck-catalog-card__preview"
          onClick={onPreview}
          type="button"
        >
          <img
            alt={`Carta ${card.name}`}
            className="deck-catalog-card__image"
            loading="lazy"
            src={resolveCardImageUrl(card.imagePath)}
          />
        </button>

        {isSelected ? <span className="deck-catalog-card__count">x{quantity}</span> : null}
      </div>

      <div className="deck-catalog-card__body">
        {card.category === 'imo' && typeof cost === 'number' ? (
          <div className="deck-catalog-card__badges">
            <Badge tone="accent">Custo {cost}</Badge>
          </div>
        ) : null}

        <div className="deck-catalog-card__copy">
          <h3>{card.name}</h3>
        </div>

        <div className="deck-stepper">
          <button
            aria-label={`Diminuir quantidade de ${card.name}`}
            className="deck-stepper__button"
            disabled={quantity <= 0}
            onClick={onDecrease}
            type="button"
          >
            -
          </button>
          <div className="deck-stepper__value">
            <strong>{quantity}</strong>
            <span>de {card.maxCopies}</span>
          </div>
          <button
            aria-label={`Aumentar quantidade de ${card.name}`}
            className="deck-stepper__button"
            disabled={quantity >= card.maxCopies}
            onClick={onIncrease}
            type="button"
          >
            +
          </button>
        </div>
      </div>
    </Card>
  );
}

export function DecksPage() {
  const token = useAuthStore((state) => state.token);
  const rules = useDeckStore((state) => state.rules);
  const catalog = useDeckStore((state) => state.catalog);
  const decks = useDeckStore((state) => state.decks);
  const imoCards = useDeckStore((state) => state.imoCards);
  const openSections = useDeckStore((state) => state.openSections);
  const selectedDeckId = useDeckStore((state) => state.selectedDeckId);
  const name = useDeckStore((state) => state.name);
  const draftQuantities = useDeckStore((state) => state.draftQuantities);
  const imoForm = useDeckStore((state) => state.imoForm);
  const isDraftDirty = useDeckStore((state) => state.isDraftDirty);
  const setModuleData = useDeckStore((state) => state.setModuleData);
  const setDraftState = useDeckStore((state) => state.setDraftState);
  const updateDraftName = useDeckStore((state) => state.updateDraftName);
  const updateDraftQuantities = useDeckStore((state) => state.updateDraftQuantities);
  const setOpenSections = useDeckStore((state) => state.setOpenSections);
  const setImoForm = useDeckStore((state) => state.setImoForm);
  const resetImoForm = useDeckStore((state) => state.resetImoForm);
  const [previewCard, setPreviewCard] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const hasModuleCache = Boolean(
    rules ||
      catalog.length ||
      decks.length ||
      imoCards.length ||
      Object.keys(draftQuantities || {}).length
  );
  const [isLoading, setIsLoading] = useState(!hasModuleCache);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const catalogMap = useMemo(() => new Map(catalog.map((card) => [card.id, card])), [catalog]);
  const draftSummary = useMemo(
    () => buildSummary(draftQuantities, catalogMap),
    [draftQuantities, catalogMap]
  );
  const deckEvaluation = useMemo(
    () => buildDeckEvaluation(draftSummary, rules),
    [draftSummary, rules]
  );
  const userDeck = useMemo(() => decks[0] || null, [decks]);
  const selectedCards = useMemo(() => {
    return Object.entries(draftQuantities)
      .map(([cardId, quantity]) => {
        const parsedQuantity = Number(quantity) || 0;
        if (parsedQuantity <= 0) {
          return null;
        }

        const card = catalogMap.get(cardId);
        if (!card) {
          return null;
        }

        return {
          id: cardId,
          name: card.name,
          quantity: parsedQuantity,
          category: card.category,
          imagePath: card.imagePath,
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        const categoryDiff = CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category);
        if (categoryDiff !== 0) {
          return categoryDiff;
        }

        return left.name.localeCompare(right.name, 'pt-BR');
      });
  }, [draftQuantities, catalogMap]);

  const filteredCatalog = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const nextCatalog = catalog.filter((card) => {
      const matchesType = typeFilter === 'all' ? true : card.category === typeFilter;
      const matchesSearch = normalizedSearch
        ? card.name.toLowerCase().includes(normalizedSearch)
        : true;
      const matchesSelectedOnly = showSelectedOnly
        ? Number(draftQuantities[card.id] ?? 0) > 0
        : true;

      return matchesType && matchesSearch && matchesSelectedOnly;
    });

    return sortCatalogCards(nextCatalog, sortBy);
  }, [catalog, draftQuantities, searchTerm, showSelectedOnly, sortBy, typeFilter]);

  const groupedCatalog = useMemo(() => {
    return CATEGORY_ORDER.reduce((accumulator, category) => {
      accumulator[category] = filteredCatalog.filter((card) => card.category === category);
      return accumulator;
    }, {});
  }, [filteredCatalog]);

  useEffect(() => {
    let isMounted = true;

    async function loadDeckModuleData() {
      const currentDeckState = useDeckStore.getState();
      const shouldShowLoading =
        !currentDeckState.rules &&
        !currentDeckState.catalog.length &&
        !currentDeckState.decks.length &&
        !currentDeckState.imoCards.length &&
        !Object.keys(currentDeckState.draftQuantities || {}).length;

      if (shouldShowLoading && isMounted) {
        setIsLoading(true);
      }

      try {
        const [rulesResponse, catalogResponse, decksResponse, imoResponse] = await Promise.all([
          deckApi.getRules({ token }),
          deckApi.getCatalog({ token }),
          deckApi.listDecks({ token }),
          deckApi.listImoCards({ token }),
        ]);

        if (!isMounted) {
          return;
        }

        setModuleData({
          rules: rulesResponse.rules,
          catalog: catalogResponse.catalog,
          decks: decksResponse.decks,
          imoCards: imoResponse.cards || [],
        });

        const deckState = useDeckStore.getState();
        const existingDeck = decksResponse.decks?.[0] || null;
        if (!deckState.hasInitializedDraft) {
          if (existingDeck) {
            setDraftState({
              selectedDeckId: existingDeck.id,
              name: existingDeck.name || '',
              draftQuantities: buildDraftFromDeckCards(existingDeck.cards_json || [], catalogResponse.catalog),
            });
          } else {
            setDraftState({
              selectedDeckId: null,
              name: '',
              draftQuantities: buildEmptyDraft(catalogResponse.catalog),
            });
          }
        } else if (!deckState.isDraftDirty) {
          const syncedDeck =
            decksResponse.decks.find((deck) => deck.id === deckState.selectedDeckId) ||
            existingDeck;

          if (syncedDeck) {
            setDraftState({
              selectedDeckId: syncedDeck.id,
              name: syncedDeck.name || '',
              draftQuantities: buildDraftFromDeckCards(syncedDeck.cards_json || [], catalogResponse.catalog),
            });
          } else {
            setDraftState({
              selectedDeckId: null,
              name: '',
              draftQuantities: buildEmptyDraft(catalogResponse.catalog),
            });
          }
        } else {
          setDraftState({
            selectedDeckId: deckState.selectedDeckId,
            name: deckState.name,
            draftQuantities: mergeDraftWithCatalog(deckState.draftQuantities, catalogResponse.catalog),
            isDraftDirty: true,
          });
        }
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

    loadDeckModuleData();

    return () => {
      isMounted = false;
    };
  }, [setDraftState, setModuleData, token]);

  function applyDeckToForm(deck) {
    setDraftState({
      selectedDeckId: deck?.id || null,
      name: deck?.name || '',
      draftQuantities: buildDraftFromDeckCards(deck?.cards_json || [], catalog),
    });
  }

  function resetForm() {
    setDraftState({
      selectedDeckId: null,
      name: '',
      draftQuantities: buildEmptyDraft(catalog),
    });
  }

  function handleQuantityChange(cardId, rawValue) {
    const card = catalogMap.get(cardId);
    if (!card) {
      return;
    }

    const parsedValue = Number(rawValue);
    const safeValue = Number.isInteger(parsedValue)
      ? Math.max(0, Math.min(parsedValue, card.maxCopies))
      : 0;

    updateDraftQuantities((previous) => ({
      ...previous,
      [cardId]: safeValue,
    }));
  }

  function handleAdjustQuantity(cardId, delta) {
    const currentQuantity = Number(draftQuantities[cardId] ?? 0);
    handleQuantityChange(cardId, currentQuantity + delta);
  }

  function handlePreviewCard(card) {
    setPreviewCard(card);
  }

  function handleClosePreview() {
    setPreviewCard(null);
  }

  function handleToggleSection(category) {
    setOpenSections((previous) => ({
      ...previous,
      [category]: !previous[category],
    }));
  }

  function handleImoFormChange(field, value) {
    setImoForm((previous) => ({
      ...previous,
      [field]: value,
    }));
  }

  function handleImoImageChange(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setImoForm((previous) => ({
        ...previous,
        imagePath: typeof reader.result === 'string' ? reader.result : DEFAULT_IMO_IMAGE,
      }));
    };
    reader.readAsDataURL(file);
  }

  async function handleCreateImoCard(event) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const response = await deckApi.createImoCard({
        token,
        payload: {
          name: imoForm.name.trim() || `Carta Imo ${imoCards.length + 1}`,
          description: imoForm.description.trim() || 'Carta Imo personalizada criada pelo jogador.',
          imagePath: imoForm.imagePath,
          maxCopies: Number(imoForm.maxCopies) || 1,
          imoCost: Number(imoForm.imoCost) || 0,
        },
      });

      const nextCatalog = [...catalog, response.card];
      setModuleData({
        rules,
        catalog: nextCatalog,
        decks,
        imoCards: [response.card, ...imoCards],
      });
      setDraftState({
        selectedDeckId,
        name,
        draftQuantities: {
          ...draftQuantities,
          [response.card.id]: 0,
        },
        isDraftDirty,
      });
      resetImoForm();
      setStatusMessage(`Carta Imo ${response.card.name} criada com sucesso.`);
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
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
        description: '',
        cards,
      };

      let savedDeck;
      const deckToPersist = userDeck?.id || selectedDeckId;
      if (deckToPersist) {
        const response = await deckApi.updateDeck({
          token,
          deckId: deckToPersist,
          payload,
        });
        savedDeck = response.deck;
      } else {
        const response = await deckApi.createDeck({ token, payload });
        savedDeck = response.deck;
      }

      const listResponse = await deckApi.listDecks({ token });
      setModuleData({
        rules,
        catalog,
        decks: listResponse.decks,
        imoCards,
      });

      const persistedDeck = listResponse.decks.find((deck) => deck.id === savedDeck.id) || savedDeck;
      applyDeckToForm(persistedDeck);

      setStatusMessage(deckToPersist ? 'Deck atualizado com sucesso.' : 'Deck criado com sucesso.');
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
      setModuleData({
        rules,
        catalog,
        decks: listResponse.decks,
        imoCards,
      });

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
    <section className="stack-gap-lg deck-builder-page">
      <div className="deck-builder-hero">
        <div className="stack-gap" style={{ gap: '10px' }}>
          <span className="deck-builder-hero__eyebrow">Deck Builder</span>
          <h1 className="page-title">Monte um deck com cara de jogo digital</h1>
        </div>

        <form className="deck-name-bar" onSubmit={handleSaveDeck}>
          <Input
            id="deck-name"
            inputClassName="deck-name-bar__input"
            label="Nome do deck"
            onChange={(event) => updateDraftName(event.target.value)}
            placeholder="Ex.: Divisao Ofensiva"
            required
            value={name}
          />

          <div className="deck-name-bar__actions">
            <Button disabled={isLoading} loading={isSubmitting} type="submit">
              {userDeck ? 'Salvar' : 'Criar deck'}
            </Button>
            <Button
              disabled={isSubmitting || isLoading}
              onClick={resetForm}
              type="button"
              variant="secondary"
            >
              Limpar
            </Button>
          </div>
        </form>
      </div>

      <div className="deck-builder-layout deck-builder-layout--premium">
        <div className="deck-builder-left">
          <Card
            className="deck-overview-card"
            description="Resumo visual da composicao atual com foco em validacao rapida."
            title="Resumo do deck"
          >
            <div className="deck-feedback-stack">
              {isLoading ? <p className="muted-text">Carregando regras e cartas...</p> : null}
              {statusMessage ? <p className="success-text">{statusMessage}</p> : null}
              {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
              {deckEvaluation ? (
                <div className={['deck-feedback-banner', `is-${deckEvaluation.status}`].join(' ')}>
                  <span className={getStatusDotClassName(deckEvaluation.status)} />
                  <div className="stack-gap" style={{ gap: '4px' }}>
                    <strong>{deckEvaluation.title}</strong>
                    <span>{deckEvaluation.message}</span>
                  </div>
                </div>
              ) : null}
            </div>

            {!isLoading && deckEvaluation ? (
              <div className="deck-metrics-grid">
                <DeckMetricCard metric={deckEvaluation.metrics.total} />
                {CATEGORY_ORDER.map((category) => (
                  <DeckMetricCard key={category} metric={deckEvaluation.metrics[category]} />
                ))}
              </div>
            ) : null}
          </Card>

          <Card
            className="deck-catalog-panel"
            description="Busque, filtre e monte o deck com controles rapidos."
            title="Catalogo de cartas"
          >
            <div className="deck-catalog-toolbar">
              <Input
                className="deck-toolbar-field deck-toolbar-field--search"
                label="Buscar por nome"
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Procure uma carta"
                value={searchTerm}
              />

              <label className="ui-input deck-toolbar-field">
                <span className="ui-input__label">Tipo</span>
                <select
                  className="ui-input__field"
                  onChange={(event) => setTypeFilter(event.target.value)}
                  value={typeFilter}
                >
                  <option value="all">Todos</option>
                  {CATEGORY_ORDER.map((category) => (
                    <option key={category} value={category}>
                      {CATEGORY_LABEL[category]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="ui-input deck-toolbar-field">
                <span className="ui-input__label">Ordenar por</span>
                <select
                  className="ui-input__field"
                  onChange={(event) => setSortBy(event.target.value)}
                  value={sortBy}
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {SORT_LABEL[option]}
                    </option>
                  ))}
                </select>
              </label>

              <button
                className={['deck-toggle-chip', showSelectedOnly ? 'is-active' : ''].join(' ')}
                onClick={() => setShowSelectedOnly((current) => !current)}
                type="button"
              >
                {showSelectedOnly ? 'Mostrando selecionadas' : 'Apenas selecionadas'}
              </button>
            </div>

            <div className="catalog-sections deck-catalog-sections">
              {CATEGORY_ORDER.map((category) => {
                const isOpen = openSections[category];
                const cards = groupedCatalog[category] || [];
                const shouldRenderSection = typeFilter === 'all' || typeFilter === category;

                if (!shouldRenderSection) {
                  return null;
                }

                return (
                  <section className="catalog-section deck-catalog-section" key={category}>
                    <button
                      aria-expanded={isOpen}
                      className="catalog-section__toggle deck-catalog-section__toggle"
                      onClick={() => handleToggleSection(category)}
                      type="button"
                    >
                      <div className="catalog-section__toggle-left deck-catalog-section__toggle-left">
                        <div className="deck-catalog-section__title-wrap">
                          <h2 className="catalog-section__title">{CATEGORY_LABEL[category]}</h2>
                          <span className="deck-catalog-section__count">{cards.length} cartas</span>
                        </div>
                      </div>
                      <span
                        className={['catalog-section__chevron', isOpen ? 'is-open' : ''].join(' ')}
                      >
                        v
                      </span>
                    </button>

                    {isOpen ? (
                      <>
                        {category === 'imo' ? (
                          <div className="imo-creator-layout">
                            <Card
                              compact
                              className="deck-subpanel"
                              description="Crie uma carta Imo personalizada persistida no backend."
                              title="Criar carta Imo"
                            >
                              <form className="stack-gap" onSubmit={handleCreateImoCard}>
                                <Input
                                  label="Nome da carta"
                                  onChange={(event) => handleImoFormChange('name', event.target.value)}
                                  placeholder="Ex.: Ritual de Eclipse"
                                  value={imoForm.name}
                                />

                                <div className="deck-meta-grid">
                                  <Input
                                    label="Maximo de copias"
                                    max="5"
                                    min="1"
                                    onChange={(event) =>
                                      handleImoFormChange('maxCopies', event.target.value)
                                    }
                                    type="number"
                                    value={imoForm.maxCopies}
                                  />

                                  <Input
                                    label="Custo de Imo"
                                    min="0"
                                    onChange={(event) =>
                                      handleImoFormChange('imoCost', event.target.value)
                                    }
                                    type="number"
                                    value={imoForm.imoCost}
                                  />
                                </div>

                                <Input
                                  label="Descricao"
                                  multiline
                                  onChange={(event) =>
                                    handleImoFormChange('description', event.target.value)
                                  }
                                  placeholder="Explique o efeito, custo e comportamento da carta."
                                  rows={4}
                                  value={imoForm.description}
                                />

                                <label className="ui-input">
                                  <span className="ui-input__label">Imagem da carta</span>
                                  <input
                                    accept="image/*"
                                    className="ui-input__field"
                                    onChange={handleImoImageChange}
                                    type="file"
                                  />
                                  <span className="ui-input__description">
                                    Upload local para a imagem da carta Imo.
                                  </span>
                                </label>

                                <Button loading={isSubmitting} type="submit">
                                  Criar carta Imo
                                </Button>
                              </form>
                            </Card>

                            <Card
                              compact
                              className="deck-subpanel"
                              description="Preview da carta Imo antes de salvar."
                              title="Preview Imo"
                            >
                              <CardItem
                                category="Imo"
                                description={
                                  imoForm.description ||
                                  'A descricao completa da carta Imo aparecera aqui.'
                                }
                                imageSrc={resolveCardImageUrl(imoForm.imagePath)}
                                maxCopies={Number(imoForm.maxCopies) || 1}
                                name={imoForm.name.trim() || 'Carta Imo em criacao'}
                                showDescription={false}
                              />

                              <div className="row-wrap">
                                <Badge tone="accent">Custo Imo {Number(imoForm.imoCost) || 0}</Badge>
                                <Badge tone="secondary">{imoCards.length} cartas salvas</Badge>
                              </div>
                            </Card>
                          </div>
                        ) : null}

                        {cards.length ? (
                          <div className="deck-catalog-grid deck-catalog-grid--premium">
                            {cards.map((card) => (
                              <DeckCardControl
                                card={card}
                                key={card.id}
                                onDecrease={() => handleAdjustQuantity(card.id, -1)}
                                onIncrease={() => handleAdjustQuantity(card.id, 1)}
                                onPreview={() => handlePreviewCard(card)}
                                quantity={Number(draftQuantities[card.id] ?? 0)}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="empty-state">
                            Nenhuma carta encontrada com os filtros atuais.
                          </div>
                        )}
                      </>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="deck-builder-right">
          <Card
            className="deck-side-panel"
            description="Painel premium para acompanhar o deck em tempo real."
            title="Meu Deck"
          >
            <div className="deck-side-panel__content">
              <div className="deck-side-panel__hero">
                <div className="stack-gap" style={{ gap: '8px' }}>
                  <div className="deck-side-panel__title-row">
                    <h3>{name || userDeck?.name || 'Novo deck'}</h3>
                    {deckEvaluation ? (
                      <Badge tone={STATUS_BADGE_TONE[deckEvaluation.status]}>
                        {deckEvaluation.title}
                      </Badge>
                    ) : null}
                  </div>

                  <div className="deck-side-panel__status-line">
                    <span>{draftSummary.totalCards} / {rules?.maxCards || 0} cartas</span>
                    <span>{isDraftDirty ? 'Rascunho com alteracoes' : deckEvaluation?.persistenceLabel}</span>
                  </div>
                </div>

                {deckEvaluation ? (
                  <div className="deck-side-panel__progress">
                    <div className="deck-side-panel__progress-bar">
                      <span
                        className="deck-side-panel__progress-fill"
                        style={{ width: `${Math.max(deckEvaluation.completion * 100, 8)}%` }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              {deckEvaluation ? (
                <div className="deck-side-panel__metrics">
                  <div className={['deck-mini-stat', `is-${deckEvaluation.metrics.fixed.state}`].join(' ')}>
                    <span>Fixas</span>
                    <strong>{deckEvaluation.metrics.fixed.displayValue}</strong>
                  </div>
                  <div
                    className={['deck-mini-stat', `is-${deckEvaluation.metrics.division.state}`].join(' ')}
                  >
                    <span>Divisao</span>
                    <strong>{deckEvaluation.metrics.division.displayValue}</strong>
                  </div>
                  <div className={['deck-mini-stat', `is-${deckEvaluation.metrics.imo.state}`].join(' ')}>
                    <span>Imo</span>
                    <strong>{deckEvaluation.metrics.imo.displayValue}</strong>
                  </div>
                </div>
              ) : null}

              <div className="deck-feedback-banner deck-feedback-banner--compact">
                <span className={getStatusDotClassName(deckEvaluation?.status || 'incomplete')} />
                <div className="stack-gap" style={{ gap: '4px' }}>
                  <strong>{deckEvaluation?.title || 'Montando deck'}</strong>
                  <span>{deckEvaluation?.message || 'Adicione cartas para começar.'}</span>
                </div>
              </div>

              <div className="stack-gap" style={{ gap: '12px' }}>
                <div className="deck-side-panel__list-head">
                  <span className="status-label">Lista atual</span>
                  <Badge tone="secondary">{selectedCards.length} cartas distintas</Badge>
                </div>

                {selectedCards.length ? (
                  <div className="deck-side-list">
                    {selectedCards.map((card) => (
                      <article className="deck-side-list__item" key={card.id}>
                        <div className="deck-side-list__main">
                          <img
                            alt={`Miniatura da carta ${card.name}`}
                            className="deck-side-list__thumb"
                            src={resolveCardImageUrl(card.imagePath)}
                          />
                          <div className="stack-gap" style={{ gap: '4px' }}>
                            <strong>{card.name}</strong>
                            <span className="muted-text compact">
                              {CATEGORY_LABEL[card.category] || 'Carta'}
                            </span>
                          </div>
                        </div>

                        <div className="deck-side-list__actions">
                          <Badge tone="primary">x{card.quantity}</Badge>
                          <button
                            aria-label={`Remover ${card.name} do deck`}
                            className="deck-side-list__remove"
                            onClick={() => handleQuantityChange(card.id, 0)}
                            type="button"
                          >
                            Remover
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">Nenhuma carta selecionada.</div>
                )}
              </div>

              <div className="deck-side-panel__footer">
                <Button
                  disabled={!userDeck || isSubmitting}
                  onClick={() => applyDeckToForm(userDeck)}
                  size="sm"
                  variant="secondary"
                >
                  Recarregar salvo
                </Button>
                <Button
                  disabled={!userDeck || isSubmitting}
                  onClick={() => handleDeleteDeck(userDeck)}
                  size="sm"
                  variant="danger"
                >
                  Excluir deck
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Modal
        cancelLabel={null}
        confirmLabel="Fechar"
        description={undefined}
        onClose={handleClosePreview}
        onConfirm={handleClosePreview}
        open={Boolean(previewCard)}
        title={previewCard?.name || 'Detalhes da carta'}
      >
        {previewCard ? (
          <div className="deck-preview-modal">
            <div className="deck-preview-modal__art">
              <div className="game-card__image-wrap deck-preview-modal__image-wrap">
                <img
                  alt={`Carta ${previewCard.name}`}
                  className="game-card__image deck-preview-modal__image"
                  src={resolveCardImageUrl(previewCard.imagePath)}
                />
              </div>
            </div>

            <div className="deck-preview-modal__content">
              <div className="deck-preview-modal__badges row-wrap">
                <Badge tone="secondary">{CATEGORY_LABEL[previewCard.category] || 'Imo'}</Badge>
                <Badge tone="accent">Max {previewCard.maxCopies}</Badge>
                {previewCard.category === 'imo' ? (
                  <Badge tone="accent">Custo Imo {previewCard.imoCost || 0}</Badge>
                ) : null}
                {String(previewCard.id).startsWith('imo:') ? (
                  <Badge tone="primary">Customizada</Badge>
                ) : null}
              </div>

              <div className="deck-preview-modal__section">
                <span className="status-label">Descricao</span>
                <p className="deck-preview-modal__description">
                  {previewCard.effect || 'Sem descricao adicional.'}
                </p>
              </div>

              <div className="deck-preview-modal__meta">
                <div className="deck-preview-modal__meta-item">
                  <span>Tipo</span>
                  <strong>{CATEGORY_LABEL[previewCard.category] || 'Carta'}</strong>
                </div>
                <div className="deck-preview-modal__meta-item">
                  <span>Copias</span>
                  <strong>Max {previewCard.maxCopies}</strong>
                </div>
                <div className="deck-preview-modal__meta-item">
                  <span>Custo</span>
                  <strong>
                    {previewCard.category === 'imo'
                      ? `Imo ${previewCard.imoCost || 0}`
                      : getCardCost(previewCard) ?? '-'}
                  </strong>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
