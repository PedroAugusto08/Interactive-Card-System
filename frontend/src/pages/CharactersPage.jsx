import { useEffect, useMemo, useState } from 'react';

import { characterApi } from '../api/characterApi';
import { CardItem } from '../components/system/CardItem';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { useAuthStore } from '../stores/authStore';
import { useCharacterStore } from '../stores/characterStore';
import { resolveCardImageUrl } from '../utils/cardImages';
import { formatErrorMessage } from '../utils/formatError';

const EMPTY_CHARACTER_FORM = {
  id: null,
  name: '',
  description: '',
  divisionIds: [],
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

function toggleId(currentIds, nextId) {
  return currentIds.includes(nextId)
    ? currentIds.filter((value) => value !== nextId)
    : [...currentIds, nextId];
}

export function CharactersPage() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const catalog = useCharacterStore((state) => state.catalog);
  const characters = useCharacterStore((state) => state.characters);
  const setModuleData = useCharacterStore((state) => state.setModuleData);

  const [characterForm, setCharacterForm] = useState(EMPTY_CHARACTER_FORM);
  const [imoForm, setImoForm] = useState(EMPTY_IMO_FORM);
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
  const divisionCards = useMemo(() => catalog?.divisions || [], [catalog]);
  const canManageMultipleCharacters = Boolean(
    user?.canManageMultipleCharacters ||
      user?.canManageMultipleDecks ||
      user?.isMasterAccount ||
      user?.isDevMasterOverride ||
      user?.devMasterOverride
  );

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
      divisionIds: character.division_ids_json || [],
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
        divisionIds: characterForm.divisionIds,
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
          <h1 className="page-title">Personagens</h1>
          <p className="muted-text">
            Monte personagens com arsenal aberto de Divisão e conjunto próprio de cartas de Imo geráveis.
          </p>
        </div>
        <Badge tone="secondary">{characters.length} salvo(s)</Badge>
      </div>

      <div className="grid-2">
        <div className="stack-gap">
          <Card title="Editor de personagem" description="Defina quais ações de Divisão ficam abertas e quais Imos esse personagem pode gerar.">
            <form className="stack-gap" onSubmit={handleSaveCharacter}>
              <Input
                label="Nome"
                onChange={(event) => setCharacterForm((current) => ({ ...current, name: event.target.value }))}
                required
                value={characterForm.name}
              />

              <Input
                label="Descrição"
                multiline
                onChange={(event) => setCharacterForm((current) => ({ ...current, description: event.target.value }))}
                rows={4}
                value={characterForm.description}
              />

              <div className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">Divisão aberta</span>
                <div className="row-wrap">
                  {divisionCards.map((card) => (
                    <Button
                      key={card.id}
                      onClick={() =>
                        setCharacterForm((current) => ({
                          ...current,
                          divisionIds: toggleId(current.divisionIds, card.id),
                        }))
                      }
                      type="button"
                      variant={characterForm.divisionIds.includes(card.id) ? 'primary' : 'secondary'}
                    >
                      {card.name}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">Imos do personagem</span>
                <div className="row-wrap">
                  {allImoCards.map((card) => (
                    <Button
                      key={card.id}
                      onClick={() =>
                        setCharacterForm((current) => ({
                          ...current,
                          imoCardIds: toggleId(current.imoCardIds, card.id),
                        }))
                      }
                      type="button"
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

          <Card title="Criar carta de Imo" description="Cartas customizadas ficam disponíveis para vincular aos personagens da conta.">
            <form className="stack-gap" onSubmit={handleCreateImoCard}>
              <Input
                label="Nome da carta"
                onChange={(event) => setImoForm((current) => ({ ...current, name: event.target.value }))}
                required
                value={imoForm.name}
              />
              <Input
                label="Descrição"
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
                  <option value="standard">Ação padrão</option>
                  <option value="complementary">Ação complementar</option>
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
                  <option value="false">Não</option>
                </select>
              </label>

              <label className="ui-input">
                <span className="ui-input__label">Automação ao usar</span>
                <select
                  className="ui-input__field"
                  onChange={(event) => setImoForm((current) => ({ ...current, useTemplate: event.target.value }))}
                  value={imoForm.useTemplate}
                >
                  <option value="none">Manual / sem automação</option>
                  <option value="gainCatalogCardToHand">Gerar outra carta na mão</option>
                  <option value="restoreSelectedExiledCardId">Remover uma carta do exílio</option>
                </select>
              </label>

              <label className="ui-input">
                <span className="ui-input__label">Automação ao exilar</span>
                <select
                  className="ui-input__field"
                  onChange={(event) => setImoForm((current) => ({ ...current, exileTemplate: event.target.value }))}
                  value={imoForm.exileTemplate}
                >
                  <option value="none">Sem automação</option>
                  <option value="gainCatalogCardToHand">Gerar outra carta na mão</option>
                </select>
              </label>

              {imoForm.useTemplate === 'gainCatalogCardToHand' || imoForm.exileTemplate === 'gainCatalogCardToHand' ? (
                <label className="ui-input">
                  <span className="ui-input__label">Carta gerada pela automação</span>
                  <select
                    className="ui-input__field"
                    onChange={(event) =>
                      setImoForm((current) => ({ ...current, useGeneratedCardId: event.target.value }))
                    }
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
          <Card title="Personagens salvos" description={canManageMultipleCharacters ? 'O mestre pode manter vários personagens.' : 'Jogadores comuns mantêm apenas 1 personagem salvo.'}>
            {characters.length ? (
              <div className="stack-gap" style={{ gap: '12px' }}>
                {characters.map((character) => (
                  <article className="ui-card ui-card--compact" key={`character-${character.id}`}>
                    <div className="ui-card__content">
                      <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
                        <div className="stack-gap" style={{ gap: '4px' }}>
                          <strong>{character.name}</strong>
                          <span className="muted-text compact">{character.description || 'Sem descrição'}</span>
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
                        <Badge tone="secondary">Divisão {character.division_ids_json?.length || 0}</Badge>
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

          <Card title="Catálogo de Divisão">
            <div className="player-hand">
              {divisionCards.map((card) => (
                <div className="player-hand__slot" key={`division-catalog-${card.id}`}>
                  <CardItem
                    category="Divisão"
                    cost={card.imoCost || 0}
                    costLabel="Imo"
                    description={card.effect}
                    imageSrc={resolveCardImageUrl(card.imagePath)}
                    name={card.name}
                  />
                </div>
              ))}
            </div>
          </Card>

          <Card title="Catálogo de Imo">
            <div className="player-hand">
              {allImoCards.map((card) => (
                <div className="player-hand__slot" key={`imo-catalog-${card.id}`}>
                  <CardItem
                    category="Imo"
                    cost={card.imoCost || 0}
                    costLabel="Imo"
                    description={card.effect}
                    imageSrc={resolveCardImageUrl(card.imagePath)}
                    name={card.name}
                  />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
