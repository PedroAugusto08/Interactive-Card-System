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
import { formatErrorMessage } from '../utils/formatError';

const CATEGORY_LABEL = {
  fixed: 'Fixas',
  division: 'Divisão',
  imo: 'Imo',
};

const CATEGORY_ORDER = ['fixed', 'division', 'imo'];
const API_ORIGIN = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api').replace(/\/api\/?$/, '');
const CARDS_BASE_URL = (import.meta.env.VITE_SOCKET_URL || API_ORIGIN).replace(/\/$/, '');
const DEFAULT_IMO_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 420">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#22183f"/>
          <stop offset="100%" stop-color="#0e1420"/>
        </linearGradient>
      </defs>
      <rect width="300" height="420" rx="28" fill="url(#bg)"/>
      <circle cx="150" cy="138" r="74" fill="rgba(124,92,255,0.22)" stroke="rgba(245,197,66,0.42)" stroke-width="3"/>
      <path d="M150 92 L165 140 L215 140 L174 170 L189 220 L150 190 L111 220 L126 170 L85 140 L135 140 Z" fill="#f5c542"/>
      <text x="150" y="302" text-anchor="middle" fill="#E6EAF2" font-size="24" font-family="Inter, sans-serif">Carta Imo</text>
    </svg>
  `);

function resolveCardImageUrl(imagePath) {
  if (!imagePath) {
    return DEFAULT_IMO_IMAGE;
  }

  if (/^(https?:\/\/|data:)/i.test(imagePath)) {
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

function getCategoryRuleLabel(category, rules) {
  if (!rules) {
    return '-';
  }

  if (category === 'fixed') {
    return '10';
  }

  if (category === 'division') {
    return `${rules.divisionMinCards} a ${rules.divisionMaxCards}`;
  }

  return `${rules.imoMinCards} a ${rules.imoMaxCards}`;
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
  const draftSummary = useMemo(() => buildSummary(draftQuantities, catalogMap), [draftQuantities, catalogMap]);
  const selectedDeck = useMemo(() => decks.find((deck) => deck.id === selectedDeckId) || null, [decks, selectedDeckId]);
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
        };
      })
      .filter(Boolean);
  }, [draftQuantities, catalogMap]);

  const groupedCatalog = useMemo(() => {
    return CATEGORY_ORDER.reduce((accumulator, category) => {
      accumulator[category] = catalog.filter((card) => card.category === category);
      return accumulator;
    }, {});
  }, [catalog]);

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
    const safeValue = Number.isInteger(parsedValue) ? Math.max(0, Math.min(parsedValue, card.maxCopies)) : 0;

    updateDraftQuantities((previous) => ({
      ...previous,
      [cardId]: safeValue,
    }));
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
    <section className="stack-gap-lg">
      <div className="section-header">
        <div className="stack-gap" style={{ gap: '10px' }}>
          <h1 className="page-title">Monte seu deck</h1>
        </div>
      </div>

      <div className="deck-builder-layout">
        <div className="deck-builder-left">
          <Card description="Acompanhe rapidamente a composição antes de salvar." title="Resumo do deck">
            {isLoading ? <p className="muted-text">Carregando regras e cartas...</p> : null}
            {statusMessage ? <p className="success-text">{statusMessage}</p> : null}
            {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

            {!isLoading && rules ? (
              <div className="deck-summary-grid" style={{ marginTop: '16px' }}>
                <div className="deck-summary-box">
                  <span className="status-label">Total ({rules.minCards} a {rules.maxCards})</span>
                  <strong>{draftSummary.totalCards}</strong>
                </div>
                {CATEGORY_ORDER.map((category) => (
                  <div className="deck-summary-box" key={category}>
                    <span className="status-label">
                      {CATEGORY_LABEL[category]} ({getCategoryRuleLabel(category, rules)})
                    </span>
                    <strong>{draftSummary.categoryTotals[category] || 0}</strong>
                  </div>
                ))}
              </div>
            ) : null}
          </Card>

          <Card
            description="Configure nome e quantidades."
            title={selectedDeck ? `Editando: ${selectedDeck.name}` : 'Meu deck'}
          >
            <form className="stack-gap" onSubmit={handleSaveDeck}>
              <div>
                <Input
                  id="deck-name"
                  label="Nome do deck"
                  onChange={(event) => updateDraftName(event.target.value)}
                  placeholder="Ex.: Divisão Ofensiva"
                  required
                  value={name}
                />
              </div>

              <div className="row-wrap">
                <Button disabled={isLoading} loading={isSubmitting} type="submit">
                  {userDeck ? 'Salvar alterações' : 'Criar deck'}
                </Button>

                <Button disabled={isSubmitting || isLoading} onClick={resetForm} type="button" variant="secondary">
                  Limpar formulario
                </Button>
              </div>
            </form>
          </Card>

          <Card title="Catálogo de cartas">
            <div className="catalog-sections">
              {CATEGORY_ORDER.map((category) => {
                const isOpen = openSections[category];

                return (
                  <section className="catalog-section" key={category}>
                    <button
                      aria-expanded={isOpen}
                      className="catalog-section__toggle"
                      onClick={() => handleToggleSection(category)}
                      type="button"
                    >
                      <div className="catalog-section__toggle-left">
                        <h2 className="catalog-section__title">{CATEGORY_LABEL[category]}</h2>
                      </div>
                      <span className={['catalog-section__chevron', isOpen ? 'is-open' : ''].join(' ')}>
                        ▾
                      </span>
                    </button>

                    {isOpen ? (
                      <>
                        {category === 'imo' ? (
                          <div className="imo-creator-layout">
                            <Card compact description="Crie uma carta Imo personalizada persistida no backend." title="Criar carta Imo">
                              <form className="stack-gap" onSubmit={handleCreateImoCard}>
                                <Input
                                  label="Nome da carta"
                                  onChange={(event) => handleImoFormChange('name', event.target.value)}
                                  placeholder="Ex.: Ritual de Eclipse"
                                  value={imoForm.name}
                                />

                                <div className="deck-meta-grid">
                                  <Input
                                    label="Máximo de cópias"
                                    max="5"
                                    min="1"
                                    onChange={(event) => handleImoFormChange('maxCopies', event.target.value)}
                                    type="number"
                                    value={imoForm.maxCopies}
                                  />

                                  <Input
                                    label="Custo de Imo"
                                    min="0"
                                    onChange={(event) => handleImoFormChange('imoCost', event.target.value)}
                                    type="number"
                                    value={imoForm.imoCost}
                                  />
                                </div>

                                <Input
                                  label="Descrição"
                                  multiline
                                  onChange={(event) => handleImoFormChange('description', event.target.value)}
                                  placeholder="Explique o efeito, custo e comportamento da carta."
                                  rows={4}
                                  value={imoForm.description}
                                />

                                <label className="ui-input">
                                  <span className="ui-input__label">Imagem da carta</span>
                                  <input accept="image/*" className="ui-input__field" onChange={handleImoImageChange} type="file" />
                                  <span className="ui-input__description">Upload local para a imagem da carta Imo.</span>
                                </label>

                                <Button loading={isSubmitting} type="submit">
                                  Criar carta Imo
                                </Button>
                              </form>
                            </Card>

                            <Card compact description="Preview da carta Imo antes de salvar." title="Preview Imo">
                              <CardItem
                                category="Imo"
                      description={imoForm.description || 'A descrição completa da carta Imo aparecerá aqui.'}
                                imageSrc={resolveCardImageUrl(imoForm.imagePath)}
                                maxCopies={Number(imoForm.maxCopies) || 1}
                      name={imoForm.name.trim() || 'Carta Imo em criação'}
                                showDescription={false}
                              />

                              <div className="row-wrap">
                                <Badge tone="accent">Custo Imo {Number(imoForm.imoCost) || 0}</Badge>
                                <Badge tone="secondary">{imoCards.length} cartas salvas</Badge>
                              </div>
                            </Card>
                          </div>
                        ) : null}

                        <div className="deck-catalog-grid">
                          {groupedCatalog[category]?.map((card) => (
                            <CardItem
                              category={CATEGORY_LABEL[card.category] || 'Imo'}
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
                      </>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="deck-builder-right">
          <Card description="Resumo da composição atual do seu deck." title="Meu Deck">
            <div className="stack-gap">
              {userDeck || draftSummary.totalCards > 0 || name ? (
                <>
                  <div className="stack-gap" style={{ gap: '8px' }}>
                    <div className="row-wrap">
                      <h3>{name || userDeck?.name || 'Meu deck'}</h3>
                    </div>
                  </div>

                  <div className="stack-gap" style={{ gap: '10px' }}>
                    <span className="status-label">Cartas selecionadas</span>
                    {selectedCards.length ? (
                      <div className="selected-card-list">
                        {selectedCards.map((card) => (
                          <div className="selected-card-row" key={card.id}>
                            <div className="stack-gap" style={{ gap: '4px' }}>
                              <strong>{card.name}</strong>
                              <span className="muted-text compact">{CATEGORY_LABEL[card.category] || 'Carta'}</span>
                            </div>
                            <Badge tone="secondary">x{card.quantity}</Badge>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-state">Nenhuma carta selecionada.</div>
                    )}
                  </div>

                  <div className="row-wrap">
                    <Button disabled={!userDeck || isSubmitting} onClick={() => applyDeckToForm(userDeck)} size="sm" variant="secondary">
                      Recarregar deck salvo
                    </Button>
                    <Button disabled={!userDeck || isSubmitting} onClick={() => handleDeleteDeck(userDeck)} size="sm" variant="danger">
                      Excluir deck
                    </Button>
                  </div>
                </>
              ) : (
                <div className="empty-state">Você ainda não tem deck salvo.</div>
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
              <img alt={`Carta ${previewCard.name}`} className="game-card__image" src={resolveCardImageUrl(previewCard.imagePath)} />
            </div>

            <div className="row-wrap game-card__badges">
              <Badge tone="secondary">{CATEGORY_LABEL[previewCard.category] || 'Imo'}</Badge>
              <Badge tone="accent">Max {previewCard.maxCopies}</Badge>
              {previewCard.category === 'imo' ? <Badge tone="accent">Custo Imo {previewCard.imoCost || 0}</Badge> : null}
              {String(previewCard.id).startsWith('imo:') ? <Badge tone="primary">Customizada</Badge> : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
