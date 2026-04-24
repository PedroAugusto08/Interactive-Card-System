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
  fixed: 'Fixas',
  division: 'Divisao',
  imo: 'Imo',
};

const DEFAULT_SECTION_STATE = {
  fixed: true,
  division: true,
  imo: true,
};

const CATEGORY_ORDER = ['fixed', 'division', 'imo'];
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
      <text x="150" y="334" text-anchor="middle" fill="#AAB2C5" font-size="14" font-family="Inter, sans-serif">Personalizada</text>
    </svg>
  `);

const API_ORIGIN = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api').replace(/\/api\/?$/, '');
const CARDS_BASE_URL = (import.meta.env.VITE_SOCKET_URL || API_ORIGIN).replace(/\/$/, '');

function resolveCardImageUrl(imagePath) {
  if (!imagePath) {
    return '';
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

function buildDefaultImoForm() {
  return {
    name: '',
    description: '',
    maxCopies: 1,
    imoCost: 1,
    imagePreview: DEFAULT_IMO_IMAGE,
  };
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
  const [customImoCards, setCustomImoCards] = useState([]);
  const [imoForm, setImoForm] = useState(buildDefaultImoForm);
  const [openSections, setOpenSections] = useState(DEFAULT_SECTION_STATE);

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const catalogMap = useMemo(() => new Map(catalog.map((card) => [card.id, card])), [catalog]);
  const draftSummary = useMemo(() => buildSummary(draftQuantities, catalogMap), [draftQuantities, catalogMap]);
  const selectedDeck = useMemo(() => decks.find((deck) => deck.id === selectedDeckId) || null, [decks, selectedDeckId]);

  const groupedCatalog = useMemo(() => {
    return CATEGORY_ORDER.reduce((accumulator, category) => {
      accumulator[category] = catalog.filter((card) => card.category === category);
      return accumulator;
    }, {});
  }, [catalog]);

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
        imagePreview: typeof reader.result === 'string' ? reader.result : DEFAULT_IMO_IMAGE,
      }));
    };
    reader.readAsDataURL(file);
  }

  function handleCreateImoCard(event) {
    event.preventDefault();

    const nextIndex = customImoCards.length + 1;
    const parsedMaxCopies = Number(imoForm.maxCopies);
    const parsedImoCost = Number(imoForm.imoCost);

    const customCard = {
      id: `custom_imo_${Date.now()}`,
      name: imoForm.name.trim() || `Carta Imo ${nextIndex}`,
      category: 'imo',
      maxCopies: Number.isInteger(parsedMaxCopies) ? Math.max(1, parsedMaxCopies) : 1,
      imoCost: Number.isInteger(parsedImoCost) ? Math.max(0, parsedImoCost) : 0,
      effect: imoForm.description.trim() || 'Carta Imo personalizada criada pelo jogador.',
      imagePath: imoForm.imagePreview || DEFAULT_IMO_IMAGE,
      isCustom: true,
    };

    setCustomImoCards((previous) => [customCard, ...previous]);
    setImoForm(buildDefaultImoForm());
    setStatusMessage(`Carta Imo ${customCard.name} criada no catalogo local.`);
    setErrorMessage('');
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

          <Card title="Catalogo de cartas">
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
                            <Card
                              compact
                              description="Crie uma carta Imo personalizada com imagem, descricao, custo e limite de copias."
                              title="Criar carta Imo"
                            >
                              <form className="stack-gap" onSubmit={handleCreateImoCard}>
                                <Input
                                  label="Nome da carta (opcional)"
                                  onChange={(event) => handleImoFormChange('name', event.target.value)}
                                  placeholder="Ex.: Ritual de Eclipse"
                                  value={imoForm.name}
                                />

                                <div className="deck-meta-grid">
                                  <Input
                                    description="Limite de copias por deck."
                                    label="Maximo de copias"
                                    max="5"
                                    min="1"
                                    onChange={(event) => handleImoFormChange('maxCopies', event.target.value)}
                                    type="number"
                                    value={imoForm.maxCopies}
                                  />

                                  <Input
                                    description="Custo inicial de Imo da carta."
                                    label="Custo de Imo"
                                    min="0"
                                    onChange={(event) => handleImoFormChange('imoCost', event.target.value)}
                                    type="number"
                                    value={imoForm.imoCost}
                                  />
                                </div>

                                <Input
                                  description="Descricao completa da carta."
                                  label="Descricao"
                                  multiline
                                  onChange={(event) => handleImoFormChange('description', event.target.value)}
                                  placeholder="Explique o efeito, custo e comportamento da carta."
                                  rows={4}
                                  value={imoForm.description}
                                />

                                <label className="ui-input">
                                  <span className="ui-input__label">Imagem da carta</span>
                                  <input accept="image/*" className="ui-input__field" onChange={handleImoImageChange} type="file" />
                                  <span className="ui-input__description">Upload local para preview da carta Imo.</span>
                                </label>

                                <Button type="submit">Criar carta Imo</Button>
                              </form>
                            </Card>

                            <Card compact description="Preview da proxima carta Imo antes de adicionar." title="Preview Imo">
                              <CardItem
                                category="Imo"
                                description={imoForm.description || 'A descricao completa da carta Imo aparecera aqui.'}
                                imageSrc={resolveCardImageUrl(imoForm.imagePreview)}
                                maxCopies={Number(imoForm.maxCopies) || 1}
                                name={imoForm.name.trim() || 'Carta Imo em criacao'}
                                showDescription={false}
                              />

                              <div className="row-wrap">
                                <Badge tone="accent">Custo Imo {Number(imoForm.imoCost) || 0}</Badge>
                                <Badge tone="secondary">Rascunho</Badge>
                              </div>
                            </Card>
                          </div>
                        ) : null}

                        <div className="deck-catalog-grid">
                          {groupedCatalog[category]?.map((card) => (
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

                          {category === 'imo' &&
                            customImoCards.map((card) => (
                              <CardItem
                                category="Imo"
                                description={card.effect}
                                footer={
                                  <div className="stack-gap" style={{ gap: '8px' }}>
                                    <Badge tone="accent">Custo Imo {card.imoCost}</Badge>
                                    <Badge tone="secondary">Rascunho local</Badge>
                                  </div>
                                }
                                imageSrc={resolveCardImageUrl(card.imagePath)}
                                key={card.id}
                                maxCopies={card.maxCopies}
                                name={card.name}
                                onClick={() => handlePreviewCard(card)}
                                showDescription={false}
                              />
                            ))}
                        </div>

                        {category === 'imo' && !customImoCards.length ? (
                          <div className="empty-state">
                            Nenhuma carta Imo personalizada criada ainda. Use o formulario acima para adicionar a primeira.
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </section>
                );
              })}
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
              <Badge tone="secondary">{CATEGORY_LABEL[previewCard.category] || 'Imo'}</Badge>
              <Badge tone="accent">Max {previewCard.maxCopies}</Badge>
              {previewCard.imoCost !== undefined ? <Badge tone="accent">Custo Imo {previewCard.imoCost}</Badge> : null}
              {previewCard.isCustom ? <Badge tone="primary">Customizada</Badge> : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
