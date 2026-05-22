import { useEffect, useMemo, useState } from 'react';

import { characterApi } from '../api/characterApi';
import { CardItem } from '../components/system/CardItem';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { useAuthStore } from '../stores/authStore';
import { useCharacterStore } from '../stores/characterStore';
import { resolveCardImageUrl } from '../utils/cardImages';
import { formatErrorMessage } from '../utils/formatError';

const FRAGMENT_FIELDS = [
  { key: 'combate', label: 'Combate' },
  { key: 'pontaria', label: 'Pontaria' },
  { key: 'resistencia', label: 'Resistencia' },
  { key: 'furor', label: 'Furor' },
  { key: 'percepcao', label: 'Percepcao' },
  { key: 'conhecimento', label: 'Conhecimento' },
  { key: 'medicina', label: 'Medicina' },
  { key: 'furtividade', label: 'Furtividade' },
  { key: 'improviso', label: 'Improviso' },
  { key: 'mobilidade', label: 'Mobilidade' },
];

const DIVISION_IMAGE_BY_ID = {
  'executor-desgastado': '/divisoes/executor_desgastado.png',
  remendador: '/divisoes/remendador.png',
  'arquivista-do-vazio': '/divisoes/arquivista_do_vazio.png',
  'flagelado-voluntario': '/divisoes/flagelado_voluntario.png',
  'condutor-de-ecos': '/divisoes/condutor_de_ecos.png',
  'rato-de-ruina': '/divisoes/rato_de_ruina.png',
};

function createEmptyFragments() {
  return Object.fromEntries(FRAGMENT_FIELDS.map((field) => [field.key, 0]));
}

const EMPTY_CHARACTER_FORM = {
  id: null,
  name: '',
  description: '',
  divisionId: '',
  baseCarne: 5,
  baseImo: 5,
  fragments: createEmptyFragments(),
  imoCardIds: [],
};

const EMPTY_IMO_FORM = {
  name: '',
  description: '',
  imoCost: 1,
  imagePath: '',
  actionSlot: 'standard',
  canExile: true,
  useTemplate: 'none',
  useGeneratedCardId: '',
  exileTemplate: 'none',
};

function buildImoAutomationPayload(form) {
  const useAutomation =
    form.useTemplate === 'gainCatalogCardToHand' && form.useGeneratedCardId
      ? {
          effects: [
            {
              type: 'gainCatalogCardToHand',
              cardId: form.useGeneratedCardId,
            },
          ],
        }
      : form.useTemplate === 'restoreSelectedExiledCardId'
        ? {
            selection: 'own-exiled-card-id',
            effects: [
              {
                type: 'restoreSelectedExiledCardId',
                target: 'self',
              },
            ],
          }
        : null;

  const exileAutomation =
    form.exileTemplate === 'gainCatalogCardToHand' && form.useGeneratedCardId
      ? {
          effects: [
            {
              type: 'gainCatalogCardToHand',
              cardId: form.useGeneratedCardId,
            },
          ],
        }
      : null;

  return {
    actionSlot: form.actionSlot,
    canExile: form.canExile,
    useAutomation,
    exileAutomation,
  };
}

function toggleSingleId(currentIds, nextId, maxLength) {
  if (currentIds.includes(nextId)) {
    return currentIds.filter((value) => value !== nextId);
  }

  if (currentIds.length >= maxLength) {
    return [...currentIds.slice(1 - maxLength), nextId].slice(-maxLength);
  }

  return [...currentIds, nextId];
}

function normalizeFragmentsForForm(fragments, fallbackFragments = {}) {
  return Object.fromEntries(
    FRAGMENT_FIELDS.map((field) => [field.key, Number(fragments?.[field.key] ?? fallbackFragments?.[field.key] ?? 0)])
  );
}

function applyDivisionSelection(currentForm, division) {
  if (!division) {
    return currentForm;
  }

  const nextFragments = Object.fromEntries(
    FRAGMENT_FIELDS.map((field) => [
      field.key,
      Math.max(Number(currentForm.fragments?.[field.key] ?? 0), Number(division.fragments?.[field.key] ?? 0)),
    ])
  );

  return {
    ...currentForm,
    divisionId: division.id,
    fragments: nextFragments,
    imoCardIds:
      (currentForm.imoCardIds || []).length > Number(division.imoCardSlots || 0)
        ? currentForm.imoCardIds.slice(0, Number(division.imoCardSlots || 0))
        : currentForm.imoCardIds,
  };
}

function formatFragmentSummary(fragments) {
  return FRAGMENT_FIELDS.map((field) => `${field.label} ${Number(fragments?.[field.key] || 0)}`)
    .filter((item) => !item.endsWith(' 0'))
    .join(' • ');
}

function resolveDivisionImageUrl(division) {
  return DIVISION_IMAGE_BY_ID[division?.id] || resolveCardImageUrl(division?.cards?.[0]?.imagePath);
}

function formatActionSlotLabel(actionSlot) {
  if (actionSlot === 'complementary') {
    return 'Acao complementar';
  }

  return 'Acao padrao';
}

function buildCatalogCardPreview(card, options = {}) {
  return {
    ...card,
    previewCategory: options.previewCategory || 'Carta',
    previewDescription: card.effect || card.description || 'Sem descricao.',
    previewDivisionName: options.previewDivisionName || '',
    previewImageSrc: resolveCardImageUrl(card.imagePath),
    previewCost: Number(card.imoCost || 0),
  };
}

export function CharactersPage() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const catalog = useCharacterStore((state) => state.catalog);
  const characters = useCharacterStore((state) => state.characters);
  const setModuleData = useCharacterStore((state) => state.setModuleData);

  const [characterForm, setCharacterForm] = useState(EMPTY_CHARACTER_FORM);
  const [imoForm, setImoForm] = useState(EMPTY_IMO_FORM);
  const [selectedDivisionPreview, setSelectedDivisionPreview] = useState(null);
  const [selectedCatalogCardPreview, setSelectedCatalogCardPreview] = useState(null);
  const [showOtherDivisionCards, setShowOtherDivisionCards] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      try {
        const [catalogResponse, charactersResponse, imoCardsResponse] = await Promise.all([
          characterApi.getCatalog({ token }),
          characterApi.listCharacters({ token }),
          characterApi.listImoCards({ token }),
        ]);

        if (!isMounted) {
          return;
        }

        setModuleData({
          catalog: catalogResponse.catalog,
          characters: charactersResponse.characters || [],
          imoCards: imoCardsResponse.cards || [],
        });
      } catch (error) {
        if (isMounted) {
          setErrorMessage(formatErrorMessage(error));
        }
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, [setModuleData, token]);

  const allImoCards = useMemo(() => catalog?.imoCards || [], [catalog]);
  const divisions = useMemo(() => catalog?.divisions || [], [catalog]);
  const divisionCardGroups = useMemo(
    () =>
      divisions
        .map((division) => ({
          ...division,
          catalogCards: (division.cards || []).map((card) =>
            buildCatalogCardPreview(card, {
              previewCategory: 'Carta de Divisao',
              previewDivisionName: division.name,
            })
          ),
        }))
        .filter((division) => division.catalogCards.length),
    [divisions]
  );
  const selectedDivision = useMemo(
    () => divisions.find((division) => division.id === characterForm.divisionId) || null,
    [characterForm.divisionId, divisions]
  );
  const selectedDivisionCardGroup = useMemo(
    () => divisionCardGroups.find((division) => division.id === selectedDivision?.id) || null,
    [divisionCardGroups, selectedDivision]
  );
  const otherDivisionCardGroups = useMemo(
    () => divisionCardGroups.filter((division) => division.id !== selectedDivision?.id),
    [divisionCardGroups, selectedDivision]
  );
  const allowedImoSlots = Number(selectedDivision?.imoCardSlots || 0);
  const baseResourceSum = Number(characterForm.baseCarne || 0) + Number(characterForm.baseImo || 0);
  const canManageMultipleCharacters = Boolean(
    user?.canManageMultipleCharacters ||
      user?.canManageMultipleDecks ||
      user?.isMasterAccount ||
      user?.isDevMasterOverride ||
      user?.devMasterOverride
  );

  useEffect(() => {
    setShowOtherDivisionCards(false);
  }, [characterForm.divisionId]);

  async function reloadCharacters() {
    const [catalogResponse, charactersResponse, imoCardsResponse] = await Promise.all([
      characterApi.getCatalog({ token }),
      characterApi.listCharacters({ token }),
      characterApi.listImoCards({ token }),
    ]);

    setModuleData({
      catalog: catalogResponse.catalog,
      characters: charactersResponse.characters || [],
      imoCards: imoCardsResponse.cards || [],
    });
  }

  function loadCharacterIntoForm(character) {
    setCharacterForm({
      id: character.id,
      name: character.name || '',
      description: character.description || '',
      divisionId: character.division_id || character.division?.id || '',
      baseCarne: Number(character.base_carne ?? character.resources?.baseCarne ?? 5),
      baseImo: Number(character.base_imo ?? character.resources?.baseImo ?? 5),
      fragments: normalizeFragmentsForForm(character.fragments, character.division?.fragments),
      imoCardIds: character.imo_card_ids_json || [],
    });
    setStatusMessage('');
    setErrorMessage('');
  }

  function resetCharacterForm() {
    setCharacterForm(EMPTY_CHARACTER_FORM);
  }

  async function handleSaveCharacter(event) {
    event.preventDefault();
    setIsLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const payload = {
        name: characterForm.name.trim(),
        description: characterForm.description.trim(),
        divisionId: characterForm.divisionId,
        baseCarne: Number(characterForm.baseCarne) || 0,
        baseImo: Number(characterForm.baseImo) || 0,
        fragments: normalizeFragmentsForForm(characterForm.fragments),
        imoCardIds: characterForm.imoCardIds,
      };

      if (characterForm.id) {
        await characterApi.updateCharacter({
          token,
          characterId: characterForm.id,
          payload,
        });
        setStatusMessage('Personagem atualizado.');
      } else {
        await characterApi.createCharacter({ token, payload });
        setStatusMessage('Personagem criado.');
      }

      await reloadCharacters();
      resetCharacterForm();
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeleteCharacter(character) {
    setIsLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      await characterApi.deleteCharacter({ token, characterId: character.id });
      await reloadCharacters();
      if (Number(characterForm.id) === Number(character.id)) {
        resetCharacterForm();
      }
      setStatusMessage('Personagem removido.');
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateImoCard(event) {
    event.preventDefault();
    setIsLoading(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      await characterApi.createImoCard({
        token,
        payload: {
          name: imoForm.name.trim(),
          description: imoForm.description.trim(),
          imagePath: imoForm.imagePath,
          imoCost: Number(imoForm.imoCost) || 0,
          automation: buildImoAutomationPayload(imoForm),
        },
      });
      setImoForm(EMPTY_IMO_FORM);
      await reloadCharacters();
      setStatusMessage('Carta de Imo criada.');
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  function handleImoImageChange(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImoForm((current) => ({
          ...current,
          imagePath: reader.result,
        }));
      }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }

  return (
    <section className="stack-gap-lg">
      <div className="section-header">
        <div className="stack-gap" style={{ gap: '8px' }}>
          <h1 className="page-title">{canManageMultipleCharacters ? 'Personagens' : 'Personagem'}</h1>
          <p className="muted-text">
            Monte personagens com Divisao aberta, recursos base persistidos e fragmentos que crescem com a progressao.
          </p>
        </div>
        <Badge tone="secondary">{characters.length} salvo(s)</Badge>
      </div>

      <div className="grid-2">
        <div className="stack-gap" style={{ alignSelf: 'start' }}>
          <Card
            title="Editor de personagem"
            description="A Divisao define o ponto de partida. Carne, Imo e Fragmentos podem crescer depois pela progressao."
          >
            <form className="stack-gap" onSubmit={handleSaveCharacter}>
              <Input
                label="Nome"
                onChange={(event) => setCharacterForm((current) => ({ ...current, name: event.target.value }))}
                required
                value={characterForm.name}
              />

              <Input
                label="Descricao"
                multiline
                onChange={(event) => setCharacterForm((current) => ({ ...current, description: event.target.value }))}
                rows={4}
                value={characterForm.description}
              />

              <div className="stack-gap" style={{ gap: '10px' }}>
                <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
                  <span className="status-label">Divisao do personagem</span>
                  {selectedDivision ? <Badge tone="primary">{selectedDivision.name}</Badge> : null}
                </div>
                <div className="player-hand">
                  {divisions.map((division) => (
                    <div className="player-hand__slot" key={division.id}>
                      <CardItem
                        footer={
                          <div className="row-wrap">
                            <Button
                              onClick={() => setSelectedDivisionPreview(division)}
                              size="sm"
                              type="button"
                              variant="secondary"
                            >
                              Ver detalhes
                            </Button>
                            <Button
                              onClick={() => setCharacterForm((current) => applyDivisionSelection(current, division))}
                              size="sm"
                              type="button"
                              variant={characterForm.divisionId === division.id ? 'primary' : 'secondary'}
                            >
                              {characterForm.divisionId === division.id ? 'Selecionada' : 'Selecionar'}
                            </Button>
                          </div>
                        }
                        imageSrc={resolveDivisionImageUrl(division)}
                        name={division.name}
                        onClick={() => setSelectedDivisionPreview(division)}
                        selected={characterForm.divisionId === division.id}
                        showDescription={false}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid-2">
                <Input
                  label="Carne base"
                  min="0"
                  onChange={(event) => setCharacterForm((current) => ({ ...current, baseCarne: event.target.value }))}
                  type="number"
                  value={characterForm.baseCarne}
                />
                <Input
                  label="Imo base"
                  min="0"
                  onChange={(event) => setCharacterForm((current) => ({ ...current, baseImo: event.target.value }))}
                  type="number"
                  value={characterForm.baseImo}
                />
              </div>

              <div className="row-wrap">
                <Badge tone={characterForm.id ? 'accent' : baseResourceSum === 10 ? 'success' : 'secondary'}>
                  Total base {baseResourceSum}
                </Badge>
                <span className="muted-text compact">
                  {characterForm.id
                    ? 'Na edicao, o total pode ficar acima de 10 por progressao.'
                    : 'Na criacao inicial, Carne base + Imo base precisam somar 10.'}
                </span>
              </div>

              <div className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">Fragmentos do personagem</span>
                {selectedDivision ? (
                  <p className="muted-text compact">
                    A Divisao fornece a base inicial. O personagem salva os valores atuais para acomodar progressao.
                  </p>
                ) : (
                  <p className="muted-text compact">Selecione uma Divisao para usar seus fragmentos iniciais como referencia.</p>
                )}
                <div className="grid-2">
                  {FRAGMENT_FIELDS.map((field) => (
                    <Input
                      key={field.key}
                      label={field.label}
                      min={selectedDivision ? Number(selectedDivision.fragments?.[field.key] || 0) : 0}
                      onChange={(event) =>
                        setCharacterForm((current) => ({
                          ...current,
                          fragments: {
                            ...current.fragments,
                            [field.key]: event.target.value,
                          },
                        }))
                      }
                      type="number"
                      value={characterForm.fragments[field.key]}
                    />
                  ))}
                </div>
              </div>

              <div className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">
                  Imos do personagem {selectedDivision ? `(${characterForm.imoCardIds.length}/${allowedImoSlots})` : ''}
                </span>
                {selectedDivision ? (
                  <p className="muted-text compact">
                    Passiva: {selectedDivision.passive} Essa Divisao exige {allowedImoSlots} carta(s) de Imo configurada(s).
                  </p>
                ) : (
                  <p className="muted-text compact">Selecione uma Divisao para definir quantas cartas de Imo esse personagem domina.</p>
                )}
                <div className="row-wrap">
                  {allImoCards.map((card) => (
                    <Button
                      key={card.id}
                      onClick={() =>
                        setCharacterForm((current) => ({
                          ...current,
                          imoCardIds: toggleSingleId(current.imoCardIds, card.id, Math.max(allowedImoSlots, 0)),
                        }))
                      }
                      type="button"
                      disabled={!selectedDivision}
                      variant={characterForm.imoCardIds.includes(card.id) ? 'primary' : 'secondary'}
                    >
                      {card.name}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="row-wrap">
                <Button loading={isLoading} type="submit">
                  {characterForm.id ? 'Salvar personagem' : 'Criar personagem'}
                </Button>
                <Button onClick={resetCharacterForm} type="button" variant="secondary">
                  Limpar
                </Button>
              </div>
            </form>
          </Card>

          <Card title="Criar carta de Imo" description="Cartas customizadas ficam disponiveis para vincular aos personagens da conta.">
            <form className="stack-gap" onSubmit={handleCreateImoCard}>
              <Input
                label="Nome da carta"
                onChange={(event) => setImoForm((current) => ({ ...current, name: event.target.value }))}
                required
                value={imoForm.name}
              />
              <Input
                label="Descricao"
                multiline
                onChange={(event) => setImoForm((current) => ({ ...current, description: event.target.value }))}
                required
                rows={4}
                value={imoForm.description}
              />
              <Input
                label="Custo de Imo"
                min="0"
                onChange={(event) => setImoForm((current) => ({ ...current, imoCost: event.target.value }))}
                type="number"
                value={imoForm.imoCost}
              />

              <label className="ui-input">
                <span className="ui-input__label">Slot de uso</span>
                <select
                  className="ui-input__field"
                  onChange={(event) => setImoForm((current) => ({ ...current, actionSlot: event.target.value }))}
                  value={imoForm.actionSlot}
                >
                  <option value="standard">Acao padrao</option>
                  <option value="complementary">Acao complementar</option>
                </select>
              </label>

              <label className="ui-input">
                <span className="ui-input__label">Pode ser exilada</span>
                <select
                  className="ui-input__field"
                  onChange={(event) =>
                    setImoForm((current) => ({ ...current, canExile: event.target.value === 'true' }))
                  }
                  value={String(imoForm.canExile)}
                >
                  <option value="true">Sim</option>
                  <option value="false">Nao</option>
                </select>
              </label>

              <label className="ui-input">
                <span className="ui-input__label">Automacao ao usar</span>
                <select
                  className="ui-input__field"
                  onChange={(event) => setImoForm((current) => ({ ...current, useTemplate: event.target.value }))}
                  value={imoForm.useTemplate}
                >
                  <option value="none">Manual / sem automacao</option>
                  <option value="gainCatalogCardToHand">Gerar outra carta na mao</option>
                  <option value="restoreSelectedExiledCardId">Remover uma carta do exilio</option>
                </select>
              </label>

              <label className="ui-input">
                <span className="ui-input__label">Automacao ao exilar</span>
                <select
                  className="ui-input__field"
                  onChange={(event) => setImoForm((current) => ({ ...current, exileTemplate: event.target.value }))}
                  value={imoForm.exileTemplate}
                >
                  <option value="none">Sem automacao</option>
                  <option value="gainCatalogCardToHand">Gerar outra carta na mao</option>
                </select>
              </label>

              {imoForm.useTemplate === 'gainCatalogCardToHand' || imoForm.exileTemplate === 'gainCatalogCardToHand' ? (
                <label className="ui-input">
                  <span className="ui-input__label">Carta gerada pela automacao</span>
                  <select
                    className="ui-input__field"
                    onChange={(event) => setImoForm((current) => ({ ...current, useGeneratedCardId: event.target.value }))}
                    value={imoForm.useGeneratedCardId}
                  >
                    <option value="">Selecione uma carta</option>
                    {allImoCards.map((card) => (
                      <option key={`generated-card-${card.id}`} value={card.id}>
                        {card.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label className="ui-input">
                <span className="ui-input__label">Imagem da carta</span>
                <input accept="image/*" className="ui-input__field" onChange={handleImoImageChange} type="file" />
              </label>

              <Button loading={isLoading} type="submit">
                Criar carta de Imo
              </Button>
            </form>
          </Card>

          {statusMessage ? <p className="success-text">{statusMessage}</p> : null}
          {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
        </div>

        <div className="stack-gap">
          <Card
            title={canManageMultipleCharacters ? 'Personagens salvos' : 'Personagem salvo'}
            description={canManageMultipleCharacters ? 'O mestre pode manter varios personagens.' : 'Jogadores comuns mantem apenas 1 personagem salvo.'}
          >
            {characters.length ? (
              <div className="stack-gap" style={{ gap: '12px' }}>
                {characters.map((character) => (
                  <article className="ui-card ui-card--compact" key={`character-${character.id}`}>
                    <div className="ui-card__content">
                      <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
                        <div className="stack-gap" style={{ gap: '4px' }}>
                          <strong>{character.name}</strong>
                          <span className="muted-text compact">{character.description || 'Sem descricao'}</span>
                          <span className="muted-text compact">
                            {character.division
                              ? `${character.division.name} • Carne ${character.base_carne} • Imo ${character.base_imo}`
                              : 'Divisao nao configurada'}
                          </span>
                          <span className="muted-text compact">
                            {formatFragmentSummary(character.fragments) || 'Sem fragmentos acima de zero'}
                          </span>
                        </div>
                        <div className="row-wrap">
                          <Button onClick={() => loadCharacterIntoForm(character)} size="sm" type="button" variant="secondary">
                            Editar
                          </Button>
                          <Button onClick={() => handleDeleteCharacter(character)} size="sm" type="button" variant="danger">
                            Excluir
                          </Button>
                        </div>
                      </div>

                      <div className="row-wrap">
                        <Badge tone="secondary">{character.division?.name || 'Sem Divisao'}</Badge>
                        <Badge tone="accent">Imo {character.imo_card_ids_json?.length || 0}</Badge>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">Nenhum personagem salvo ainda.</div>
            )}
          </Card>

          <Card title="Catalogo de Cartas" description="Acoes de Divisao e cartas de Imo disponiveis no sistema.">
            <div className="stack-gap" style={{ gap: '14px' }}>
              <div className="stack-gap" style={{ gap: '8px' }}>
                <div className="row-wrap" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="status-label">Cartas de Divisao</span>
                  {selectedDivision ? (
                    <Button
                      onClick={() => setShowOtherDivisionCards((current) => !current)}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      {showOtherDivisionCards ? '^ Ocultar outras divisoes' : 'v Mostrar outras divisoes'}
                    </Button>
                  ) : null}
                </div>

                {selectedDivisionCardGroup ? (
                  <div className="stack-gap" style={{ gap: '10px' }}>
                    <div className="row-wrap" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong>{selectedDivisionCardGroup.name}</strong>
                      <Badge tone="primary">Selecionada</Badge>
                    </div>
                    <div className="player-hand">
                      {selectedDivisionCardGroup.catalogCards.map((card) => (
                        <div className="player-hand__slot" key={`selected-division-card-${selectedDivisionCardGroup.id}-${card.id}`}>
                          <CardItem
                            imageSrc={card.previewImageSrc}
                            name={card.name}
                            onClick={() => setSelectedCatalogCardPreview(card)}
                            showDescription={false}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {(selectedDivision ? (showOtherDivisionCards ? otherDivisionCardGroups : []) : divisionCardGroups).map((division) => (
                  <div className="stack-gap" key={`division-card-group-${division.id}`} style={{ gap: '10px' }}>
                    <strong>{division.name}</strong>
                    <div className="player-hand">
                      {division.catalogCards.map((card) => (
                        <div className="player-hand__slot" key={`division-card-catalog-${division.id}-${card.id}`}>
                          <CardItem
                            imageSrc={card.previewImageSrc}
                            name={card.name}
                            onClick={() => setSelectedCatalogCardPreview(card)}
                            showDescription={false}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="stack-gap" style={{ gap: '8px' }}>
                <span className="status-label">Cartas de Imo</span>
                <div className="player-hand">
                  {allImoCards.map((card) => (
                    <div className="player-hand__slot" key={`imo-catalog-${card.id}`}>
                      <CardItem
                        imageSrc={resolveCardImageUrl(card.imagePath)}
                        name={card.name}
                        onClick={() =>
                          setSelectedCatalogCardPreview(
                            buildCatalogCardPreview(card, {
                              previewCategory: 'Carta de Imo',
                            })
                          )
                        }
                        showDescription={false}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Modal
        cancelLabel={null}
        confirmLabel="Fechar"
        description=""
        onClose={() => setSelectedDivisionPreview(null)}
        onConfirm={() => setSelectedDivisionPreview(null)}
        open={Boolean(selectedDivisionPreview)}
        title={selectedDivisionPreview?.name || 'Divisao'}
      >
        {selectedDivisionPreview ? (
            <div
              style={{
                display: 'grid',
                gap: '16px',
                gridTemplateColumns: 'minmax(0, 1.7fr) minmax(220px, 0.9fr)',
                alignItems: 'start',
                marginTop: '8px',
              }}
            >
            <div
              style={{
                display: 'grid',
                gap: '0',
              }}
            >
              <div
                style={{
                  padding: '12px 0 16px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
                  textAlign: 'center',
                  color: 'rgba(255, 244, 234, 0.92)',
                  fontSize: '1.08rem',
                  lineHeight: 1.55,
                }}
              >
                {FRAGMENT_FIELDS.filter((field) => Number(selectedDivisionPreview.fragments?.[field.key] || 0) > 0).map((field) => (
                  <div key={`division-fragment-${field.key}`}>
                    {field.label} [{Number(selectedDivisionPreview.fragments?.[field.key] || 0)}]
                  </div>
                ))}
              </div>

              <div
                style={{
                  padding: '16px 0',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
                  textAlign: 'center',
                  lineHeight: 1.55,
                  color: 'rgba(255, 244, 234, 0.92)',
                  fontSize: '1.08rem',
                }}
              >
                {selectedDivisionPreview.passive}
              </div>

              <div
                style={{
                  padding: '16px 0',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
                  lineHeight: 1.55,
                  color: 'rgba(255, 244, 234, 0.92)',
                  fontSize: '1.04rem',
                }}
              >
                {(selectedDivisionPreview.cards || []).map((card) => (
                  <p key={`division-detail-card-${card.id}`} style={{ margin: '0 0 12px' }}>
                    <strong style={{ color: '#fff7ef' }}>{card.name}:</strong> {card.effect}
                  </p>
                ))}
              </div>

              <div
                style={{
                  padding: '16px 0 6px',
                  textAlign: 'center',
                  color: 'rgba(255, 244, 234, 0.92)',
                  fontSize: '1.08rem',
                }}
              >
                Possui <strong style={{ color: '#fff7ef' }}>{selectedDivisionPreview.imoCardSlots} carta de Imo</strong>.
              </div>
            </div>

            <div className="stack-gap" style={{ gap: '12px' }}>
              <img
                alt={selectedDivisionPreview.name}
                src={resolveDivisionImageUrl(selectedDivisionPreview)}
                style={{
                  width: '100%',
                  border: '1px solid rgba(255, 255, 255, 0.14)',
                  borderRadius: '18px',
                  objectFit: 'cover',
                }}
              />
              <Button
                onClick={() => {
                  setCharacterForm((current) => applyDivisionSelection(current, selectedDivisionPreview));
                  setSelectedDivisionPreview(null);
                }}
                type="button"
                variant={characterForm.divisionId === selectedDivisionPreview.id ? 'primary' : 'secondary'}
              >
                {characterForm.divisionId === selectedDivisionPreview.id ? 'Divisao selecionada' : 'Selecionar divisao'}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        cancelLabel={null}
        confirmLabel="Fechar"
        description=""
        onClose={() => setSelectedCatalogCardPreview(null)}
        onConfirm={() => setSelectedCatalogCardPreview(null)}
        open={Boolean(selectedCatalogCardPreview)}
        title={selectedCatalogCardPreview?.name || 'Carta'}
      >
        {selectedCatalogCardPreview ? (
          <div
            style={{
              display: 'grid',
              gap: '16px',
              gridTemplateColumns: 'minmax(0, 1.5fr) minmax(220px, 0.9fr)',
              alignItems: 'start',
              marginTop: '8px',
            }}
          >
            <div
              style={{
                display: 'grid',
                gap: '0',
              }}
            >
              <div
                style={{
                  padding: '12px 0 16px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
                  textAlign: 'center',
                  color: 'rgba(255, 244, 234, 0.92)',
                  fontSize: '1.08rem',
                  lineHeight: 1.55,
                }}
              >
                <div>{selectedCatalogCardPreview.previewCategory}</div>
                {selectedCatalogCardPreview.previewDivisionName ? (
                  <div style={{ marginTop: '4px' }}>{selectedCatalogCardPreview.previewDivisionName}</div>
                ) : null}
              </div>

              <div
                style={{
                  padding: '16px 0',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
                  textAlign: 'center',
                  lineHeight: 1.55,
                  color: 'rgba(255, 244, 234, 0.92)',
                  fontSize: '1.08rem',
                }}
              >
                <div>
                  Custo: <strong style={{ color: '#fff7ef' }}>{selectedCatalogCardPreview.previewCost} de Imo</strong>
                </div>
                {selectedCatalogCardPreview.actionSlot ? (
                  <div>
                    Uso: <strong style={{ color: '#fff7ef' }}>{formatActionSlotLabel(selectedCatalogCardPreview.actionSlot)}</strong>
                  </div>
                ) : null}
                {typeof selectedCatalogCardPreview.canExile === 'boolean' ? (
                  <div>
                    Exilio: <strong style={{ color: '#fff7ef' }}>{selectedCatalogCardPreview.canExile ? 'Permitido' : 'Nao permitido'}</strong>
                  </div>
                ) : null}
              </div>

              <div
                style={{
                  padding: '16px 0 6px',
                  lineHeight: 1.6,
                  color: 'rgba(255, 244, 234, 0.92)',
                  fontSize: '1.05rem',
                }}
              >
                {selectedCatalogCardPreview.previewDescription}
              </div>
            </div>

            <div className="stack-gap" style={{ gap: '12px' }}>
              <img
                alt={selectedCatalogCardPreview.name}
                src={selectedCatalogCardPreview.previewImageSrc}
                style={{
                  width: '100%',
                  border: '1px solid rgba(255, 255, 255, 0.14)',
                  borderRadius: '18px',
                  objectFit: 'cover',
                }}
              />
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
