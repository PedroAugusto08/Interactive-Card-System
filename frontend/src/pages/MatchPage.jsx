import { useEffect, useState } from 'react';

import { ActionLogItem } from '../components/system/ActionLogItem';
import { CardItem } from '../components/system/CardItem';
import { PlayerHand } from '../components/system/PlayerHand';
import { ZoneContainer } from '../components/system/ZoneContainer';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { matchApi } from '../api/matchApi';
import { roomApi } from '../api/roomApi';
import { useSocket } from '../hooks/useSocket';
import { useAuthStore } from '../stores/authStore';
import { useRoomStore } from '../stores/roomStore';
import { resolveCardImageUrl } from '../utils/cardImages';
import { formatErrorMessage } from '../utils/formatError';

function emitSocketAction(socket, action, payload) {
  return new Promise((resolve, reject) => {
    socket.emit(action, payload, (response) => {
      if (!response?.ok) {
        reject(new Error(response?.error || 'Falha ao sincronizar a partida.'));
        return;
      }

      resolve(response);
    });
  });
}

function formatPerfLabel(metrics) {
  if (!metrics?.totalMs) {
    return '';
  }

  return ` (${Math.round(metrics.totalMs)}ms)`;
}

function getCardActionAutomation(card, action) {
  if (!card) {
    return null;
  }

  return action === 'match:playCard' ? card.playAutomation || null : card.discardAutomation || null;
}

function getTargetOptions(participants, actingParticipantId, targetScope) {
  if (!Array.isArray(participants)) {
    return [];
  }

  if (targetScope === 'other-player') {
    return participants.filter((participant) => participant.participantId !== actingParticipantId && !participant.isDefeated);
  }

  if (targetScope === 'selected-player') {
    return participants.filter((participant) => !participant.isDefeated);
  }

  return [];
}

function automationRequiresTargetHandSelection(automation) {
  return automation?.selection === 'target-hand-card';
}

function automationRequiresOwnHandSelection(automation) {
  return automation?.selection === 'own-hand-card';
}

function getTargetHandCards(participantStates, targetParticipantId) {
  if (!Array.isArray(participantStates) || !targetParticipantId) {
    return [];
  }

  return participantStates.find((participant) => participant.participantId === targetParticipantId)?.handCards || [];
}

function getSelectableOwnHandCards(cards, excludedInstanceIds = []) {
  const excludedIds = new Set((excludedInstanceIds || []).filter(Boolean));
  return (cards || []).filter((card) => !excludedIds.has(card.instanceId));
}

function getPlayableTogetherCandidates(cards, primaryCardId) {
  return (cards || []).filter((card) => card.instanceId !== primaryCardId);
}

function getReactionCards(cards) {
  return (cards || []).filter((card) => card?.combatRole === 'reaction');
}

function buildActionFeedback(logMessage, notice, metrics) {
  const text = [logMessage, notice].filter(Boolean).join(' ');
  if (!text) {
    return '';
  }

  return `${text}${import.meta.env.DEV ? formatPerfLabel(metrics) : ''}`;
}

function getPrivateCardViewEffects(effectResults) {
  if (!Array.isArray(effectResults)) {
    return [];
  }

  return effectResults.filter(
    (effect) => (effect?.type === 'viewTopDeck' || effect?.type === 'viewRandomHandCard') && effect?.card
  );
}

function buildActionReason(action, { focusedParticipant, availableActions, isSubmitting }) {
  if (isSubmitting) {
    return 'Aguarde a ação atual terminar.';
  }

  if (!focusedParticipant) {
    return 'Selecione um participante em foco para agir.';
  }

  if (availableActions.includes(action)) {
    return '';
  }

  if (!focusedParticipant.isCurrentTurn) {
    return 'Você só pode agir no turno do participante em foco.';
  }

  if (action === 'drawCard') {
    return 'Essa compra não está disponível agora.';
  }

  if (action === 'endTurn') {
    return 'Essa ação ainda não está disponível agora.';
  }

  if (action === 'playCard') {
    return 'Você ainda não pode jogar cartas agora.';
  }

  if (action === 'discardCard') {
    return 'Você ainda não pode descartar cartas agora.';
  }

  return 'Essa ação não está disponível agora.';
}

export function MatchPage() {
  const token = useAuthStore((state) => state.token);

  const currentRoom = useRoomStore((state) => state.currentRoom);
  const players = useRoomStore((state) => state.players);
  const currentMatch = useRoomStore((state) => state.currentMatch);
  const viewer = useRoomStore((state) => state.viewer);
  const participantStates = useRoomStore((state) => state.participantStates);
  const logs = useRoomStore((state) => state.logs);
  const setRoomData = useRoomStore((state) => state.setRoomData);
  const setMatchData = useRoomStore((state) => state.setMatchData);
  const appendMatchLog = useRoomStore((state) => state.appendMatchLog);
  const clearRoom = useRoomStore((state) => state.clearRoom);

  const socket = useSocket(token);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [manualFocusedParticipantId, setManualFocusedParticipantId] = useState(null);
  const [selectedHandCardId, setSelectedHandCardId] = useState(null);
  const [isEndTurnConfirmOpen, setIsEndTurnConfirmOpen] = useState(false);
  const [isExileModalOpen, setIsExileModalOpen] = useState(false);
  const [isRoomUsersCollapsed, setIsRoomUsersCollapsed] = useState(true);
  const [pendingCardAction, setPendingCardAction] = useState(null);
  const [pendingFerroadaAction, setPendingFerroadaAction] = useState(null);
  const [pendingCardViews, setPendingCardViews] = useState([]);
  const [revealedTopDeckModal, setRevealedTopDeckModal] = useState(null);

  const isSocketConnected = Boolean(socket?.connected);
  const controlledParticipantIds = viewer?.controlledParticipantIds || [];
  const controlledParticipants = participantStates.filter((participant) =>
    controlledParticipantIds.includes(participant.participantId)
  );
  const combatState = currentMatch?.combatState || null;

  useEffect(() => {
    let isMounted = true;

    async function hydrateFromApi() {
      try {
        const roomState = await roomApi.getCurrentRoom({ token });
        if (!isMounted || !roomState.room) {
          return;
        }

        setRoomData(roomState);
        if (roomState.match) {
          setMatchData(roomState.match);
        }
      } catch (error) {
        if (isMounted) {
          setLocalError(formatErrorMessage(error));
        }
      }
    }

    hydrateFromApi();
    return () => {
      isMounted = false;
    };
  }, [setMatchData, setRoomData, token]);

  useEffect(() => {
    if (!socket) {
      return undefined;
    }

    function handleRoomUpdate(payload) {
      setRoomData(payload);
    }

    function handleMatchSync(payload) {
      setMatchData(payload);
    }

    function handleLog(payload) {
      setSyncMessage(payload.message);
      appendMatchLog(payload);
    }

    function handleTopDeckRevealed(payload) {
      if (!payload?.card) {
        return;
      }

      setRevealedTopDeckModal(payload);
    }

    socket.on('room:update', handleRoomUpdate);
    socket.on('match:sync', handleMatchSync);
    socket.on('match:log', handleLog);
    socket.on('match:topDeckRevealed', handleTopDeckRevealed);

    return () => {
      socket.off('room:update', handleRoomUpdate);
      socket.off('match:sync', handleMatchSync);
      socket.off('match:log', handleLog);
      socket.off('match:topDeckRevealed', handleTopDeckRevealed);
    };
  }, [appendMatchLog, setMatchData, setRoomData, socket]);

  useEffect(() => {
    if (socket && currentRoom?.id && isSocketConnected) {
      socket.emit('room:join', { code: currentRoom.code });
      socket.emit('match:sync', { roomId: currentRoom.id });
    }
  }, [currentRoom?.code, currentRoom?.id, isSocketConnected, socket]);

  useEffect(() => {
    if (!syncMessage) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setSyncMessage('');
    }, 3200);

    return () => window.clearTimeout(timeoutId);
  }, [syncMessage]);

  const focusedParticipantId =
    !controlledParticipantIds.length
      ? null
      : combatState?.defenderParticipantId && controlledParticipantIds.includes(combatState.defenderParticipantId)
        ? combatState.defenderParticipantId
        : manualFocusedParticipantId && controlledParticipantIds.includes(manualFocusedParticipantId)
          ? manualFocusedParticipantId
          : controlledParticipantIds.includes(currentMatch?.currentTurnParticipantId)
            ? currentMatch.currentTurnParticipantId
            : controlledParticipantIds.includes(viewer?.focusedParticipantId)
              ? viewer.focusedParticipantId
              : controlledParticipantIds[0];

  const focusedParticipant = controlledParticipants.find(
    (participant) => participant.participantId === focusedParticipantId
  ) || controlledParticipants[0] || null;
  const activeTurnParticipant = participantStates.find(
    (participant) => participant.participantId === currentMatch?.currentTurnParticipantId
  ) || null;
  const isViewerTurn = controlledParticipantIds.includes(currentMatch?.currentTurnParticipantId);
  const focusedZones = focusedParticipant?.zones || {
    deckCount: 0,
    handCount: 0,
    exileCount: 0,
  };
  const handCards = focusedParticipant?.handCards || [];
  const exileCards = focusedParticipant?.exileCards || [];
  const availableActions = focusedParticipant?.availableActions || [];
  const hasDrawnThisTurn = Boolean(focusedParticipant?.hasDrawnThisTurn);
  const reactionCards = getReactionCards(handCards);
  const activeTopDeckView = pendingCardViews[0] || null;
  const connectionState = !socket ? 'offline' : isSocketConnected ? 'connected' : 'reconnecting';
  const connectionLabel =
    connectionState === 'connected'
      ? 'Conectado'
      : connectionState === 'reconnecting'
        ? 'Reconectando...'
        : 'Desconectado';
  const currentCombatDefender = combatState?.defenderParticipantId
    ? participantStates.find((participant) => participant.participantId === combatState.defenderParticipantId)
    : null;
  const isCurrentUserCombatDefender = Boolean(
    currentCombatDefender && controlledParticipantIds.includes(currentCombatDefender.participantId)
  );
  const counterResponseCards = currentCombatDefender?.handCards || [];
  const drawDisabledReason = buildActionReason('drawCard', {
    focusedParticipant,
    availableActions,
    isSubmitting,
  });
  const endTurnDisabledReason = buildActionReason('endTurn', {
    focusedParticipant,
    availableActions,
    isSubmitting,
  });
  const playDisabledReason = buildActionReason('playCard', {
    focusedParticipant,
    availableActions,
    isSubmitting,
  });
  const discardDisabledReason = buildActionReason('discardCard', {
    focusedParticipant,
    availableActions,
    isSubmitting,
  });

  async function handleLeaveRoom() {
    if (!currentRoom?.id) {
      return;
    }

    setIsSubmitting(true);
    setLocalError('');

    try {
      await roomApi.leaveRoom({ roomId: currentRoom.id, token });
      clearRoom();
    } catch (error) {
      setLocalError(formatErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRefreshMatch() {
    if (!currentRoom?.id) {
      return;
    }

    setIsSubmitting(true);
    setLocalError('');

    try {
      const response = await roomApi.listPlayers({ roomId: currentRoom.id, token });
      setRoomData(response);
      const snapshot = await matchApi.getSnapshot({ roomId: currentRoom.id, token });
      setMatchData(snapshot);
    } catch (error) {
      setLocalError(formatErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAction(action, payload = {}) {
    if (!currentRoom?.id) {
      return;
    }

    setIsSubmitting(true);
    setLocalError('');

    try {
      if (isSocketConnected) {
        const response = await emitSocketAction(socket, action, {
          roomId: currentRoom.id,
          ...payload,
        });
        if (response?.snapshot) {
          setMatchData(response.snapshot);
        }
        const effectResults = getPrivateCardViewEffects(response?.effectResults);
        if (effectResults.length) {
          setPendingCardViews((current) => [...current, ...effectResults]);
        }
        if (response?.log) {
          setSyncMessage(buildActionFeedback(response.log.message, response.notice, response.metrics));
          appendMatchLog(response.log);
        } else if (response?.notice) {
          setSyncMessage(buildActionFeedback('', response.notice, response.metrics));
        }
      } else {
        let snapshot = null;

        if (action === 'match:draw') {
          snapshot = await matchApi.draw({
            roomId: currentRoom.id,
            actingParticipantId: payload.actingParticipantId,
            token,
          });
        } else if (action === 'match:playCard') {
          snapshot = await matchApi.playCard({
            roomId: currentRoom.id,
            token,
            ...payload,
          });
        } else if (action === 'match:discardCard') {
          snapshot = await matchApi.discardCard({
            roomId: currentRoom.id,
            token,
            ...payload,
          });
        } else if (action === 'match:reactToAttack') {
          snapshot = await matchApi.reactToAttack({
            roomId: currentRoom.id,
            actingParticipantId: payload.actingParticipantId,
            reactionCardId: payload.reactionCardId,
            token,
          });
        } else if (action === 'match:resolveAttack') {
          snapshot = await matchApi.resolveAttack({
            roomId: currentRoom.id,
            actingParticipantId: payload.actingParticipantId,
            resolution: payload.resolution,
            token,
          });
        } else if (action === 'match:useFerroada') {
          snapshot = await matchApi.useFerroada({
            roomId: currentRoom.id,
            actingParticipantId: payload.actingParticipantId,
            ferroadaCardId: payload.ferroadaCardId,
            selectedOwnHandCardIds: payload.selectedOwnHandCardIds,
            token,
          });
        } else if (action === 'match:endTurn') {
          snapshot = await matchApi.endTurn({
            roomId: currentRoom.id,
            actingParticipantId: payload.actingParticipantId,
            token,
          });
        }

        if (snapshot) {
          setMatchData(snapshot);
          setSyncMessage(snapshot.actionNotice || '');
          const effectResults = getPrivateCardViewEffects(snapshot.actionEffects);
          if (effectResults.length) {
            setPendingCardViews((current) => [...current, ...effectResults]);
          }
        }
      }
    } catch (error) {
      setLocalError(formatErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRevealTopDeck() {
    if (!activeTopDeckView || !currentRoom?.id) {
      return;
    }

    setIsSubmitting(true);
    setLocalError('');

    try {
      if (isSocketConnected) {
        await emitSocketAction(socket, 'match:revealTopDeck', {
          roomId: currentRoom.id,
          actingParticipantId: activeTopDeckView.actorParticipantId,
          targetParticipantId: activeTopDeckView.targetParticipantId,
          topDeckInstanceId: activeTopDeckView.card.instanceId,
        });
      } else {
        const response = await matchApi.revealTopDeck({
          roomId: currentRoom.id,
          actingParticipantId: activeTopDeckView.actorParticipantId,
          targetParticipantId: activeTopDeckView.targetParticipantId,
          topDeckInstanceId: activeTopDeckView.card.instanceId,
          token,
        });

        if (response?.log) {
          setSyncMessage(response.log.message);
          appendMatchLog(response.log);
        }
        if (response?.revealEvent?.card) {
          setRevealedTopDeckModal(response.revealEvent);
        }
      }

      setPendingCardViews((current) => current.slice(1));
    } catch (error) {
      setLocalError(formatErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleEndTurnClick() {
    if (!focusedParticipant?.participantId) {
      return;
    }

    if (!hasDrawnThisTurn) {
      setIsEndTurnConfirmOpen(true);
      return;
    }

    handleAction('match:endTurn', {
      actingParticipantId: focusedParticipant.participantId,
    });
  }

  function handleConfirmEndTurn() {
    setIsEndTurnConfirmOpen(false);
    handleAction('match:endTurn', {
      actingParticipantId: focusedParticipant?.participantId,
    });
  }

  function openCardAction(action, cardId, options = {}) {
    if (!focusedParticipant) {
      return;
    }

    const targetCard = handCards.find((card) => card.instanceId === cardId);
    if (!targetCard) {
      return;
    }

    const automation = getCardActionAutomation(targetCard, action);
    const targetOptions = getTargetOptions(participantStates, focusedParticipant.participantId, automation?.targetScope);
    const pairedCandidates =
      action === 'match:playCard' && targetCard.canPlayTogether && !options.asCounterResponse
        ? getPlayableTogetherCandidates(handCards, cardId)
        : [];
    const requiresTarget = Boolean(automation?.targetScope);
    const requiresExileSelection = automation?.selection === 'own-exile-card' && exileCards.length > 0;
    const requiresOwnHandSelection = automationRequiresOwnHandSelection(automation);
    const requiresTargetHandSelection = automationRequiresTargetHandSelection(automation);
    const allowsPairedCard = action === 'match:playCard' && pairedCandidates.length > 0;
    const initialTargetParticipantId = targetOptions[0]?.participantId || null;
    const initialOwnHandCards = requiresOwnHandSelection
      ? getSelectableOwnHandCards(handCards, [cardId])
      : [];
    const initialTargetHandCards = requiresTargetHandSelection
      ? getTargetHandCards(participantStates, initialTargetParticipantId)
      : [];

    if (
      !requiresTarget &&
      !requiresExileSelection &&
      !requiresOwnHandSelection &&
      !requiresTargetHandSelection &&
      !allowsPairedCard
    ) {
      handleAction(action, {
        actingParticipantId: focusedParticipant.participantId,
        cardId,
        asCounterResponse: options.asCounterResponse || undefined,
      });
      return;
    }

    setLocalError('');
    setPendingCardAction({
      action,
      actingParticipantId: focusedParticipant.participantId,
      cardId,
      cardName: targetCard.name,
      automation,
      targetParticipantId: initialTargetParticipantId,
      selectedExileCardId: requiresExileSelection ? exileCards[0]?.instanceId || null : null,
      selectedOwnHandCardId: initialOwnHandCards[0]?.instanceId || null,
      selectedTargetHandCardId: initialTargetHandCards[0]?.instanceId || null,
      asCounterResponse: Boolean(options.asCounterResponse),
      pairedCardId: null,
      pairedCardName: '',
      pairedAutomation: null,
      pairedTargetParticipantId: null,
      pairedSelectedExileCardId: null,
      pairedSelectedOwnHandCardId: null,
      pairedSelectedTargetHandCardId: null,
    });
  }

  function closePendingCardAction() {
    setPendingCardAction(null);
  }

  function openFerroadaAction(cardId) {
    if (!focusedParticipant) {
      return;
    }

    const targetCard = handCards.find((card) => card.instanceId === cardId && card.id === 'ferroada');
    if (!targetCard) {
      return;
    }

    const selectableCards = getSelectableOwnHandCards(handCards, [cardId]);
    if (!selectableCards.length) {
      setLocalError('A Ferroada precisa de pelo menos 1 outra carta na sua mão.');
      return;
    }

    setLocalError('');
    setPendingFerroadaAction({
      actingParticipantId: focusedParticipant.participantId,
      ferroadaCardId: cardId,
      selectedOwnHandCardIds: selectableCards.slice(0, 2).map((card) => card.instanceId),
    });
  }

  function closePendingFerroadaAction() {
    setPendingFerroadaAction(null);
  }

  const pendingTargetOptions = getTargetOptions(
    participantStates,
    pendingCardAction?.actingParticipantId,
    pendingCardAction?.automation?.targetScope
  );
  const pendingTargetHandCards = getTargetHandCards(participantStates, pendingCardAction?.targetParticipantId);
  const pendingOwnHandCards = getSelectableOwnHandCards(handCards, [
    pendingCardAction?.cardId,
    pendingCardAction?.pairedCardId,
  ]);
  const pendingPairedTargetOptions = getTargetOptions(
    participantStates,
    pendingCardAction?.actingParticipantId,
    pendingCardAction?.pairedAutomation?.targetScope
  );
  const pendingPairedOwnHandCards = getSelectableOwnHandCards(handCards, [
    pendingCardAction?.cardId,
    pendingCardAction?.pairedCardId,
    pendingCardAction?.selectedOwnHandCardId,
  ]);
  const pendingPairedTargetHandCards = getTargetHandCards(
    participantStates,
    pendingCardAction?.pairedTargetParticipantId
  );
  const pairedCandidates = pendingCardAction
    ? getPlayableTogetherCandidates(handCards, pendingCardAction.cardId)
    : [];
  const ferroadaSelectableCards = getSelectableOwnHandCards(handCards, [pendingFerroadaAction?.ferroadaCardId]);

  async function handleConfirmPendingCardAction() {
    if (!pendingCardAction) {
      return;
    }

    const requiresTarget = Boolean(pendingCardAction.automation?.targetScope);
    const requiresExileSelection =
      pendingCardAction.automation?.selection === 'own-exile-card' && exileCards.length > 0;
    const requiresOwnHandSelection =
      automationRequiresOwnHandSelection(pendingCardAction.automation) && pendingOwnHandCards.length > 0;
    const requiresTargetHandSelection =
      automationRequiresTargetHandSelection(pendingCardAction.automation) && pendingTargetHandCards.length > 0;
    const requiresPairedTarget =
      Boolean(pendingCardAction.pairedCardId) && Boolean(pendingCardAction.pairedAutomation?.targetScope);
    const requiresPairedExileSelection =
      Boolean(pendingCardAction.pairedCardId) &&
      pendingCardAction.pairedAutomation?.selection === 'own-exile-card' &&
      exileCards.length > 0;
    const requiresPairedOwnHandSelection =
      Boolean(pendingCardAction.pairedCardId) &&
      automationRequiresOwnHandSelection(pendingCardAction.pairedAutomation) &&
      pendingPairedOwnHandCards.length > 0;
    const requiresPairedTargetHandSelection =
      Boolean(pendingCardAction.pairedCardId) &&
      automationRequiresTargetHandSelection(pendingCardAction.pairedAutomation) &&
      pendingPairedTargetHandCards.length > 0;

    if (requiresTarget && !pendingCardAction.targetParticipantId) {
      setLocalError('Selecione um alvo para essa carta.');
      return;
    }

    if (requiresExileSelection && !pendingCardAction.selectedExileCardId) {
      setLocalError('Selecione uma carta do seu exílio.');
      return;
    }

    if (requiresOwnHandSelection && !pendingCardAction.selectedOwnHandCardId) {
      setLocalError('Selecione uma carta da sua mão para passar.');
      return;
    }

    if (requiresTargetHandSelection && !pendingCardAction.selectedTargetHandCardId) {
      setLocalError('Selecione uma carta da mão do alvo.');
      return;
    }

    if (requiresPairedTarget && !pendingCardAction.pairedTargetParticipantId) {
      setLocalError('Selecione um alvo para a carta jogada junto.');
      return;
    }

    if (requiresPairedExileSelection && !pendingCardAction.pairedSelectedExileCardId) {
      setLocalError('Selecione uma carta do exílio para a carta jogada junto.');
      return;
    }

    if (requiresPairedOwnHandSelection && !pendingCardAction.pairedSelectedOwnHandCardId) {
      setLocalError('Selecione uma carta da sua mão para a carta jogada junto.');
      return;
    }

    if (requiresPairedTargetHandSelection && !pendingCardAction.pairedSelectedTargetHandCardId) {
      setLocalError('Selecione uma carta da mão do alvo da carta jogada junto.');
      return;
    }

    const payload = {
      actingParticipantId: pendingCardAction.actingParticipantId,
      cardId: pendingCardAction.cardId,
      targetParticipantId: pendingCardAction.targetParticipantId,
      selectedExileCardId: pendingCardAction.selectedExileCardId,
      selectedOwnHandCardId: pendingCardAction.selectedOwnHandCardId,
      selectedTargetHandCardId: pendingCardAction.selectedTargetHandCardId,
      pairedCardId: pendingCardAction.pairedCardId,
      pairedTargetParticipantId: pendingCardAction.pairedTargetParticipantId,
      pairedSelectedExileCardId: pendingCardAction.pairedSelectedExileCardId,
      pairedSelectedOwnHandCardId: pendingCardAction.pairedSelectedOwnHandCardId,
      pairedSelectedTargetHandCardId: pendingCardAction.pairedSelectedTargetHandCardId,
      asCounterResponse: pendingCardAction.asCounterResponse,
    };

    closePendingCardAction();
    await handleAction(pendingCardAction.action, payload);
  }

  async function handleConfirmPendingFerroadaAction() {
    if (!pendingFerroadaAction) {
      return;
    }

    if (!pendingFerroadaAction.selectedOwnHandCardIds.length) {
      setLocalError('Escolha pelo menos 1 outra carta da sua mão para exilar.');
      return;
    }

    closePendingFerroadaAction();
    await handleAction('match:useFerroada', {
      actingParticipantId: pendingFerroadaAction.actingParticipantId,
      ferroadaCardId: pendingFerroadaAction.ferroadaCardId,
      selectedOwnHandCardIds: pendingFerroadaAction.selectedOwnHandCardIds,
    });
  }

  if (!currentRoom) {
    return (
      <section className="stack-gap-lg">
        <Card title="Partida">
          <div className="empty-state">Nenhuma sala ativa carregada.</div>
        </Card>
      </section>
    );
  }

  const ferroadaDisabledReason = !focusedParticipant
    ? 'Selecione um participante em foco para agir.'
    : isSubmitting
      ? 'Aguarde a ação atual terminar.'
      : handCards.length <= 1
        ? 'A Ferroada precisa de pelo menos 1 outra carta na mão.'
        : !availableActions.includes('playCard') && !availableActions.includes('discardCard')
          ? 'Essa habilidade só pode ser usada antes da sua ação de carta do turno.'
          : '';

  return (
    <section className="stack-gap-lg match-page">
      <div className="section-header">
        <div className="stack-gap" style={{ gap: '8px' }}>
          <h1 className="page-title">Partida</h1>
          <span className="muted-text compact">Sala {currentRoom.code}</span>
        </div>

        <div className="row-wrap">
          <Badge tone="secondary">{connectionLabel}</Badge>
          <Button disabled={isSubmitting} onClick={handleRefreshMatch} variant="secondary">
            Atualizar
          </Button>
          <Button disabled={isSubmitting} onClick={handleLeaveRoom} variant="danger">
            Sair
          </Button>
        </div>
      </div>

      <div aria-live="polite" className="match-toast-layer">
        {syncMessage ? (
          <div className="match-toast">
            <Badge tone="success">Atualização</Badge>
            <span>{syncMessage}</span>
          </div>
        ) : null}
      </div>
      {localError ? <p className="error-text">{localError}</p> : null}

      <Card
        className="match-initiative-card"
        actions={
          <div className="row-wrap">
            <Badge tone={isViewerTurn ? 'success' : 'secondary'}>
              {activeTurnParticipant?.displayName || 'Participante'}
            </Badge>
            <Badge tone="accent">{participantStates.length} na mesa</Badge>
          </div>
        }
        title="Iniciativa"
      >
        <div className="initiative-track" role="list">
          {participantStates.map((participant, index) => (
            <div className="initiative-track__slot" key={`initiative-slot-${participant.participantId}`}>
              <button
                aria-disabled={!participant.isControlledByViewer}
                aria-pressed={focusedParticipantId === participant.participantId}
                className={[
                  'initiative-item',
                  'initiative-item--horizontal',
                  participant.isCurrentTurn ? 'initiative-item--active' : '',
                  focusedParticipantId === participant.participantId ? 'initiative-item--focused' : '',
                  participant.isDefeated ? 'initiative-item--disabled' : '',
                  participant.isControlledByViewer ? 'initiative-item--owned' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() =>
                  participant.isControlledByViewer
                    ? setManualFocusedParticipantId(participant.participantId)
                    : undefined
                }
                type="button"
              >
                <div className="initiative-item__main">
                  <div className="row-wrap initiative-item__head">
                    <strong>{participant.displayName}</strong>
                    {participant.isCurrentTurn ? <Badge tone="success">Agindo</Badge> : null}
                    {focusedParticipantId === participant.participantId ? <Badge tone="primary">Em foco</Badge> : null}
                  </div>
                  <div className="row-wrap initiative-item__badges">
                    {participant.isControlledByViewer ? <Badge tone="primary">Seu controle</Badge> : null}
                    {participant.participantType === 'master-creature' ? <Badge tone="accent">Criatura</Badge> : null}
                    {!participant.isControlledByViewer ? <Badge tone="secondary">Jogador</Badge> : null}
                    {participant.isDefeated ? <Badge tone="danger">Derrotado</Badge> : null}
                  </div>
                </div>
              </button>
              {index < participantStates.length - 1 ? <span className="initiative-track__arrow">-&gt;</span> : null}
            </div>
          ))}
        </div>
      </Card>

      <div className="match-table-layout">
        <div className="match-table-layout__deck">
          <ZoneContainer
            count={focusedZones.deckCount}
            description="Cartas restantes"
            title="Deck"
            tone="primary"
          />
        </div>

        <Card
          className="match-focus-card match-table-layout__center"
          actions={
            focusedParticipant ? (
              <Badge tone={focusedParticipant.isCurrentTurn ? 'success' : 'secondary'}>
                {focusedParticipant.displayName}
              </Badge>
            ) : null
          }
          title="Participante em foco"
        >
          {focusedParticipant ? (
            <div className="match-center-stage">
              <div className="match-focus-summary">
                <div className="match-focus-summary__identity">
                  <strong className="match-focus-summary__name">{focusedParticipant.displayName}</strong>
                  <div className="row-wrap match-focus-metrics">
                    <Badge tone="primary">Vida {focusedParticipant.health}</Badge>
                    <Badge tone="accent">Imo {focusedParticipant.imo}/{focusedParticipant.maxImo}</Badge>
                    <Badge tone="secondary">Iniciativa {focusedParticipant.turnOrder}</Badge>
                  </div>
                </div>

                {controlledParticipants.length > 1 ? (
                  <div className="match-focus-switcher">
                    <div className="row-wrap">
                      <strong>Alternar criatura</strong>
                      <Badge tone="secondary">{controlledParticipants.length} sob seu controle</Badge>
                    </div>
                    <div className="row-wrap">
                      {controlledParticipants.map((participant) => (
                        <Button
                          key={`focus-panel-participant-${participant.participantId}`}
                          onClick={() => setManualFocusedParticipantId(participant.participantId)}
                          size="sm"
                          type="button"
                          variant={focusedParticipantId === participant.participantId ? 'primary' : 'secondary'}
                        >
                          {participant.displayName}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="match-hand-stage">
                <div className="match-hand-stage__topbar">
                  <div className="match-hand-stage__header">
                    <strong>Mão</strong>
                    <Badge tone="secondary">{focusedZones.handCount} cartas</Badge>
                    {availableActions.includes('playCard') ? <Badge tone="success">Ações liberadas</Badge> : null}
                  </div>

                  <div className="row-wrap match-action-rack">
                    <Button
                      disabled={!availableActions.includes('drawCard') || isSubmitting}
                      onClick={() =>
                        handleAction('match:draw', { actingParticipantId: focusedParticipant.participantId })
                      }
                      title={drawDisabledReason || 'Comprar uma carta'}
                      type="button"
                    >
                      Comprar carta
                    </Button>

                    <Button
                      disabled={!availableActions.includes('endTurn') || isSubmitting}
                      onClick={handleEndTurnClick}
                      title={endTurnDisabledReason || 'Encerrar o turno'}
                      type="button"
                      variant="secondary"
                    >
                      Encerrar turno
                    </Button>
                  </div>
                </div>

                {!availableActions.includes('drawCard') || !availableActions.includes('endTurn') ? (
                  <span className="muted-text compact">
                    {drawDisabledReason || endTurnDisabledReason || 'Essa ação não está disponível agora.'}
                  </span>
                ) : null}

                <PlayerHand
                  canDiscard={availableActions.includes('discardCard')}
                  canPlay={availableActions.includes('playCard')}
                  canUseFerroada={Boolean(!ferroadaDisabledReason)}
                  cards={handCards}
                  discardDisabledReason={discardDisabledReason}
                  ferroadaDisabledReason={ferroadaDisabledReason}
                  isSubmitting={isSubmitting}
                  onDiscardCard={(cardId) => openCardAction('match:discardCard', cardId)}
                  onPlayCard={(cardId) => openCardAction('match:playCard', cardId)}
                  onSelectCard={setSelectedHandCardId}
                  onUseFerroada={openFerroadaAction}
                  playDisabledReason={playDisabledReason}
                  selectedCardId={selectedHandCardId}
                />
              </div>
            </div>
          ) : (
            <div className="empty-state">Nenhum participante sob seu controle nesta partida.</div>
          )}
        </Card>

        <div className="match-table-layout__exile">
          <ZoneContainer
            count={focusedZones.exileCount}
            description="Cartas removidas"
            onClick={() => setIsExileModalOpen(true)}
            previewCards={exileCards}
            title="Exílio"
            tone="accent"
          />
        </div>

        <Card className="match-log-card match-table-layout__log" title="Histórico da mesa">
          {logs.length ? (
            <div className="action-log-list match-log-scroll">
              {logs.map((item) => (
                <ActionLogItem item={item} key={`match-log-${item.id || item.timestamp}`} />
              ))}
            </div>
          ) : (
            <div className="empty-state">Ainda não há eventos registrados.</div>
          )}
        </Card>

        <Card
          className="match-users-card match-table-layout__users"
          actions={
            <Button
              onClick={() => setIsRoomUsersCollapsed((current) => !current)}
              size="sm"
              type="button"
              variant="secondary"
            >
              {isRoomUsersCollapsed ? 'Mostrar' : 'Ocultar'}
            </Button>
          }
          title="Usuários na sala"
        >
          <div className="row-wrap">
            <Badge tone="secondary">{players.length} conectados</Badge>
            <span className="muted-text compact">Presença da sala durante a partida.</span>
          </div>

          {!isRoomUsersCollapsed ? (
            <div className="match-users-list">
              {players.map((player) => (
                <div className="match-users-list__item" key={`room-player-${player.user_id}`}>
                  <div className="stack-gap" style={{ gap: '2px' }}>
                    <strong>{player.username}</strong>
                    <div className="row-wrap">
                      <Badge tone={player.is_master ? 'accent' : 'secondary'}>
                        {player.is_master ? 'Mestre' : 'Jogador'}
                      </Badge>
                      <Badge tone={player.is_ready ? 'success' : 'secondary'}>
                        {player.is_ready ? 'Pronto' : 'Não pronto'}
                      </Badge>
                    </div>
                  </div>
                  {player.user_id === currentRoom?.host_id ? <Badge tone="accent">Host</Badge> : null}
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      </div>

      <Modal
        confirmLabel="Encerrar turno"
        description="Essa criatura ainda não comprou carta neste turno. Encerrar mesmo assim?"
        isLoading={isSubmitting}
        onClose={() => setIsEndTurnConfirmOpen(false)}
        onConfirm={handleConfirmEndTurn}
        open={isEndTurnConfirmOpen}
        title="Confirmar turno"
      >
        <p className="muted-text">Você pode confirmar agora ou voltar e comprar uma carta antes de encerrar o turno.</p>
      </Modal>

      <Modal
        confirmLabel={pendingCardAction ? 'Confirmar ação' : 'Fechar'}
        description={
          pendingCardAction
            ? `Complete as escolhas necessárias para ${pendingCardAction.cardName}.`
            : ''
        }
        isLoading={isSubmitting}
        onClose={closePendingCardAction}
        onConfirm={handleConfirmPendingCardAction}
        open={Boolean(pendingCardAction)}
        title="Resolver carta"
      >
        {pendingCardAction ? (
          <div className="stack-gap" style={{ gap: '18px' }}>
            {pendingCardAction.automation?.targetScope ? (
              <section className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">Escolha o alvo</span>
                {pendingTargetOptions.length ? (
                  <div className="row-wrap">
                    {pendingTargetOptions.map((participant) => (
                      <Button
                        key={`target-option-${participant.participantId}`}
                        onClick={() =>
                          setPendingCardAction((current) =>
                            current
                              ? {
                                  ...current,
                                  targetParticipantId: participant.participantId,
                                  selectedTargetHandCardId: automationRequiresTargetHandSelection(current.automation)
                                    ? getTargetHandCards(participantStates, participant.participantId)[0]?.instanceId || null
                                    : current.selectedTargetHandCardId,
                                }
                              : current
                          )
                        }
                        type="button"
                        variant={
                          pendingCardAction.targetParticipantId === participant.participantId ? 'primary' : 'secondary'
                        }
                      >
                        {participant.displayName}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="muted-text">Nenhum alvo disponível para esta carta.</p>
                )}
              </section>
            ) : null}

            {pendingCardAction.automation?.selection === 'own-exile-card' ? (
              <section className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">Escolha a carta do exílio</span>
                {exileCards.length ? (
                  <div className="row-wrap">
                    {exileCards.map((card) => (
                      <Button
                        key={`exile-option-${card.instanceId}`}
                        onClick={() =>
                          setPendingCardAction((current) =>
                            current
                              ? {
                                  ...current,
                                  selectedExileCardId: card.instanceId,
                                }
                              : current
                          )
                        }
                        type="button"
                        variant={
                          pendingCardAction.selectedExileCardId === card.instanceId ? 'primary' : 'secondary'
                        }
                      >
                        {card.name}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="muted-text">Seu exílio está vazio.</p>
                )}
              </section>
            ) : null}

            {automationRequiresOwnHandSelection(pendingCardAction.automation) ? (
              <section className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">Escolha outra carta da sua mão</span>
                {pendingOwnHandCards.length ? (
                  <div className="row-wrap">
                    {pendingOwnHandCards.map((card) => (
                      <Button
                        key={`own-hand-option-${card.instanceId}`}
                        onClick={() =>
                          setPendingCardAction((current) =>
                            current
                              ? {
                                  ...current,
                                  selectedOwnHandCardId: card.instanceId,
                                }
                              : current
                          )
                        }
                        type="button"
                        variant={
                          pendingCardAction.selectedOwnHandCardId === card.instanceId ? 'primary' : 'secondary'
                        }
                      >
                        {card.name}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="muted-text">Não há outra carta disponível na sua mão.</p>
                )}
              </section>
            ) : null}

            {automationRequiresTargetHandSelection(pendingCardAction.automation) ? (
              <section className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">Escolha a carta da mão do alvo</span>
                {pendingCardAction.targetParticipantId ? (
                  pendingTargetHandCards.length ? (
                    <div className="row-wrap">
                      {pendingTargetHandCards.map((card) => (
                        <Button
                          key={`target-hand-option-${card.instanceId}`}
                          onClick={() =>
                            setPendingCardAction((current) =>
                              current
                                ? {
                                    ...current,
                                    selectedTargetHandCardId: card.instanceId,
                                  }
                                : current
                            )
                          }
                          type="button"
                          variant={
                            pendingCardAction.selectedTargetHandCardId === card.instanceId ? 'primary' : 'secondary'
                          }
                        >
                          {card.name}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <p className="muted-text">A mão do alvo está vazia.</p>
                  )
                ) : (
                  <p className="muted-text">Escolha um alvo primeiro.</p>
                )}
              </section>
            ) : null}

            {pairedCandidates.length ? (
              <section className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">Carta jogada junto (opcional)</span>
                <div className="row-wrap">
                  <Button
                    onClick={() =>
                      setPendingCardAction((current) =>
                        current
                          ? {
                              ...current,
                              pairedCardId: null,
                              pairedCardName: '',
                              pairedAutomation: null,
                              pairedTargetParticipantId: null,
                              pairedSelectedExileCardId: null,
                              pairedSelectedOwnHandCardId: null,
                              pairedSelectedTargetHandCardId: null,
                            }
                          : current
                      )
                    }
                    type="button"
                    variant={!pendingCardAction.pairedCardId ? 'primary' : 'secondary'}
                  >
                    Sem carta extra
                  </Button>
                  {pairedCandidates.map((card) => (
                    <Button
                      key={`paired-card-option-${card.instanceId}`}
                      onClick={() =>
                        setPendingCardAction((current) =>
                          current
                            ? {
                                ...current,
                                pairedCardId: card.instanceId,
                                pairedCardName: card.name,
                                pairedAutomation: card.playAutomation || null,
                                pairedTargetParticipantId: card.playAutomation?.targetScope
                                  ? getTargetOptions(participantStates, current.actingParticipantId, card.playAutomation.targetScope)[0]?.participantId || null
                                  : null,
                                pairedSelectedExileCardId: null,
                                pairedSelectedOwnHandCardId: null,
                                pairedSelectedTargetHandCardId: null,
                              }
                            : current
                        )
                      }
                      type="button"
                      variant={pendingCardAction.pairedCardId === card.instanceId ? 'primary' : 'secondary'}
                    >
                      {card.name}
                    </Button>
                  ))}
                </div>
              </section>
            ) : null}

            {pendingCardAction.pairedAutomation?.targetScope ? (
              <section className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">Escolha o alvo da carta extra</span>
                <div className="row-wrap">
                  {pendingPairedTargetOptions.map((participant) => (
                    <Button
                      key={`paired-target-option-${participant.participantId}`}
                      onClick={() =>
                        setPendingCardAction((current) =>
                          current
                            ? {
                                ...current,
                                pairedTargetParticipantId: participant.participantId,
                                pairedSelectedTargetHandCardId: automationRequiresTargetHandSelection(current.pairedAutomation)
                                  ? getTargetHandCards(participantStates, participant.participantId)[0]?.instanceId || null
                                  : current.pairedSelectedTargetHandCardId,
                              }
                            : current
                        )
                      }
                      type="button"
                      variant={
                        pendingCardAction.pairedTargetParticipantId === participant.participantId ? 'primary' : 'secondary'
                      }
                    >
                      {participant.displayName}
                    </Button>
                  ))}
                </div>
              </section>
            ) : null}

            {pendingCardAction.pairedAutomation?.selection === 'own-exile-card' ? (
              <section className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">Escolha a carta do exílio para a carta extra</span>
                <div className="row-wrap">
                  {exileCards.map((card) => (
                    <Button
                      key={`paired-exile-option-${card.instanceId}`}
                      onClick={() =>
                        setPendingCardAction((current) =>
                          current
                            ? {
                                ...current,
                                pairedSelectedExileCardId: card.instanceId,
                              }
                            : current
                        )
                      }
                      type="button"
                      variant={
                        pendingCardAction.pairedSelectedExileCardId === card.instanceId ? 'primary' : 'secondary'
                      }
                    >
                      {card.name}
                    </Button>
                  ))}
                </div>
              </section>
            ) : null}

            {automationRequiresOwnHandSelection(pendingCardAction.pairedAutomation) ? (
              <section className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">Escolha a carta da sua mão para a carta extra</span>
                <div className="row-wrap">
                  {pendingPairedOwnHandCards.map((card) => (
                    <Button
                      key={`paired-own-hand-option-${card.instanceId}`}
                      onClick={() =>
                        setPendingCardAction((current) =>
                          current
                            ? {
                                ...current,
                                pairedSelectedOwnHandCardId: card.instanceId,
                              }
                            : current
                        )
                      }
                      type="button"
                      variant={
                        pendingCardAction.pairedSelectedOwnHandCardId === card.instanceId ? 'primary' : 'secondary'
                      }
                    >
                      {card.name}
                    </Button>
                  ))}
                </div>
              </section>
            ) : null}

            {automationRequiresTargetHandSelection(pendingCardAction.pairedAutomation) ? (
              <section className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">Escolha a carta da mão do alvo da carta extra</span>
                {pendingCardAction.pairedTargetParticipantId ? (
                  <div className="row-wrap">
                    {pendingPairedTargetHandCards.map((card) => (
                      <Button
                        key={`paired-target-hand-option-${card.instanceId}`}
                        onClick={() =>
                          setPendingCardAction((current) =>
                            current
                              ? {
                                  ...current,
                                  pairedSelectedTargetHandCardId: card.instanceId,
                                }
                              : current
                          )
                        }
                        type="button"
                        variant={
                          pendingCardAction.pairedSelectedTargetHandCardId === card.instanceId ? 'primary' : 'secondary'
                        }
                      >
                        {card.name}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="muted-text">Escolha um alvo para a carta extra primeiro.</p>
                )}
              </section>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        confirmLabel="Exilar e comprar"
        description="Escolha até 2 outras cartas da sua mão para exilar. A Ferroada então compra até 2 cartas do seu deck."
        isLoading={isSubmitting}
        onClose={closePendingFerroadaAction}
        onConfirm={handleConfirmPendingFerroadaAction}
        open={Boolean(pendingFerroadaAction)}
        title="Ativar Ferroada"
      >
        {pendingFerroadaAction ? (
          <div className="stack-gap" style={{ gap: '14px' }}>
            <span className="status-label">Escolha 1 ou 2 outras cartas da sua mão</span>
            {ferroadaSelectableCards.length ? (
              <div className="row-wrap">
                {ferroadaSelectableCards.map((card) => {
                  const isSelected = pendingFerroadaAction.selectedOwnHandCardIds.includes(card.instanceId);
                  const canSelectMore =
                    isSelected || pendingFerroadaAction.selectedOwnHandCardIds.length < 2;

                  return (
                    <Button
                      key={`ferroada-own-hand-${card.instanceId}`}
                      onClick={() =>
                        setPendingFerroadaAction((current) => {
                          if (!current) {
                            return current;
                          }

                          const alreadySelected = current.selectedOwnHandCardIds.includes(card.instanceId);
                          if (alreadySelected) {
                            return {
                              ...current,
                              selectedOwnHandCardIds: current.selectedOwnHandCardIds.filter(
                                (instanceId) => instanceId !== card.instanceId
                              ),
                            };
                          }

                          if (current.selectedOwnHandCardIds.length >= 2) {
                            return current;
                          }

                          return {
                            ...current,
                            selectedOwnHandCardIds: [...current.selectedOwnHandCardIds, card.instanceId],
                          };
                        })
                      }
                      type="button"
                      variant={isSelected ? 'primary' : 'secondary'}
                    >
                      {card.name}
                      {!canSelectMore && !isSelected ? ' (limite)' : ''}
                    </Button>
                  );
                })}
              </div>
            ) : (
              <p className="muted-text">Não há outra carta disponível na sua mão.</p>
            )}

            <p className="muted-text compact">
              Selecionadas: {pendingFerroadaAction.selectedOwnHandCardIds.length} de 2.
            </p>
          </div>
        ) : null}
      </Modal>

      <Modal
        cancelLabel={null}
        confirmLabel={
          combatState?.status === 'awaiting-reaction'
            ? 'Seguir sem reação'
            : combatState?.status === 'awaiting-reaction-result'
              ? 'Não superou'
              : 'Pular resposta'
        }
        description={
          combatState?.status === 'awaiting-reaction'
            ? `${combatState.attackerDisplayName} atacou ${combatState.defenderDisplayName}. Se você tiver Reação na mão, pode usá-la agora.`
            : combatState?.status === 'awaiting-reaction-result'
              ? 'Resolva fisicamente o teste de defesa. Se tiver sucesso, libera uma carta de resposta.'
              : `Você superou o ataque. Agora pode jogar ou descartar uma carta em resposta antes de seguir a partida.`
        }
        isLoading={isSubmitting}
        onClose={() => {}}
        onConfirm={() =>
          handleAction('match:resolveAttack', {
            actingParticipantId: currentCombatDefender?.participantId,
            resolution:
              combatState?.status === 'awaiting-reaction'
                ? 'skip-reaction'
                : combatState?.status === 'awaiting-reaction-result'
                  ? 'reaction-fail'
                  : 'skip-counter-response',
          })
        }
        open={isCurrentUserCombatDefender && !pendingCardAction && !pendingFerroadaAction}
        title="Ataque recebido"
      >
        {combatState?.status === 'awaiting-reaction' ? (
          <div className="stack-gap" style={{ gap: '14px' }}>
            <div className="row-wrap">
              <Badge tone="accent">{combatState.attackCard?.name || 'Ataque'}</Badge>
              <Badge tone="secondary">{currentCombatDefender?.displayName}</Badge>
            </div>

            {reactionCards.length ? (
              <div className="player-hand">
                {reactionCards.map((card) => (
                  <div className="player-hand__slot" key={`reaction-${card.instanceId}`}>
                    <CardItem
                      category={card.category}
                      cost={card.category === 'imo' ? card.imoCost || 0 : undefined}
                      costLabel="Custo Imo"
                      description={card.effect}
                      footer={
                        <div className="row-wrap">
                          <Button
                            disabled={isSubmitting}
                            onClick={() =>
                              handleAction('match:reactToAttack', {
                                actingParticipantId: currentCombatDefender?.participantId,
                                reactionCardId: card.instanceId,
                              })
                            }
                            size="sm"
                            type="button"
                          >
                            Usar Reação
                          </Button>
                        </div>
                      }
                      imageSrc={resolveCardImageUrl(card.imagePath)}
                      name={card.name}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">Você não tem uma carta de Reação disponível na mão.</div>
            )}
          </div>
        ) : null}

        {combatState?.status === 'awaiting-reaction-result' ? (
          <div className="stack-gap" style={{ gap: '14px' }}>
            <Badge tone="primary">Reação usada</Badge>
            <p className="muted-text">Resolva o teste físico e, se tiver sucesso, libere a carta de resposta.</p>
            <Button
              disabled={isSubmitting}
              onClick={() =>
                handleAction('match:resolveAttack', {
                  actingParticipantId: currentCombatDefender?.participantId,
                  resolution: 'reaction-success',
                })
              }
              type="button"
            >
              Superou o ataque
            </Button>
          </div>
        ) : null}

        {combatState?.status === 'awaiting-counter-response' ? (
          <div className="stack-gap" style={{ gap: '14px' }}>
            <Badge tone="primary">Resposta liberada</Badge>
            {counterResponseCards.length ? (
              <div className="player-hand">
                {counterResponseCards.map((card) => (
                  <div className="player-hand__slot" key={`counter-response-${card.instanceId}`}>
                    <CardItem
                      category={card.category}
                      cost={card.category === 'imo' ? card.imoCost || 0 : undefined}
                      costLabel="Custo Imo"
                      description={card.effect}
                      footer={
                        <div className="row-wrap">
                          <Button
                            disabled={isSubmitting || card.combatRole === 'reaction'}
                            onClick={() => openCardAction('match:playCard', card.instanceId, { asCounterResponse: true })}
                            size="sm"
                            type="button"
                          >
                            Jogar em resposta
                          </Button>

                          <Button
                            disabled={isSubmitting || card.canDiscard === false}
                            onClick={() => openCardAction('match:discardCard', card.instanceId, { asCounterResponse: true })}
                            size="sm"
                            type="button"
                            variant="secondary"
                          >
                            Descartar em resposta
                          </Button>
                        </div>
                      }
                      imageSrc={resolveCardImageUrl(card.imagePath)}
                      name={card.name}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">Nenhuma carta disponivel para responder ao ataque.</div>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal
        cancelLabel={activeTopDeckView?.canReveal ? 'Seguir' : null}
        confirmLabel={activeTopDeckView?.canReveal ? 'Revelar' : 'Fechar'}
        description={
          activeTopDeckView
            ? activeTopDeckView.type === 'viewRandomHandCard'
              ? `Você visualizou uma carta aleatória da mão de ${activeTopDeckView.targetDisplayName}. Essa informação fica apenas com você.`
              : `Você visualizou o topo do deck de ${activeTopDeckView.targetDisplayName}. Revele para a mesa apenas se quiser compartilhar essa informação.`
            : ''
        }
        isLoading={isSubmitting}
        onClose={() => setPendingCardViews((current) => current.slice(1))}
        onConfirm={() =>
          activeTopDeckView?.canReveal
            ? handleRevealTopDeck()
            : setPendingCardViews((current) => current.slice(1))
        }
        open={Boolean(activeTopDeckView) && !revealedTopDeckModal}
        title="Visualizar"
      >
        {activeTopDeckView?.card ? (
          <div className="top-deck-modal__card">
            <CardItem
              category={activeTopDeckView.card.category}
              cost={activeTopDeckView.card.category === 'imo' ? activeTopDeckView.card.imoCost || 0 : undefined}
              costLabel="Custo Imo"
              description={activeTopDeckView.card.effect}
              imageSrc={resolveCardImageUrl(activeTopDeckView.card.imagePath)}
              name={activeTopDeckView.card.name}
              selected
            />
          </div>
        ) : (
          <div className="empty-state">Não foi possível carregar a carta visualizada.</div>
        )}
      </Modal>

      <Modal
        cancelLabel={null}
        confirmLabel="Fechar"
        description={
          revealedTopDeckModal
            ? `${revealedTopDeckModal.actorDisplayName} revelou o topo do deck de ${revealedTopDeckModal.targetDisplayName} para toda a mesa.`
            : ''
        }
        onClose={() => setRevealedTopDeckModal(null)}
        onConfirm={() => setRevealedTopDeckModal(null)}
        open={Boolean(revealedTopDeckModal)}
        title="Carta revelada"
      >
        {revealedTopDeckModal?.card ? (
          <div className="top-deck-modal__card">
            <CardItem
              category={revealedTopDeckModal.card.category}
              cost={revealedTopDeckModal.card.category === 'imo' ? revealedTopDeckModal.card.imoCost || 0 : undefined}
              costLabel="Custo Imo"
              description={revealedTopDeckModal.card.effect}
              imageSrc={resolveCardImageUrl(revealedTopDeckModal.card.imagePath)}
              name={revealedTopDeckModal.card.name}
              selected
            />
          </div>
        ) : (
          <div className="empty-state">Nenhuma carta revelada no momento.</div>
        )}
      </Modal>

      <Modal
        cancelLabel={null}
        confirmLabel="Fechar"
        description="As cartas aparecem em ordem no exílio: do topo para o fundo."
        onClose={() => setIsExileModalOpen(false)}
        onConfirm={() => setIsExileModalOpen(false)}
        open={isExileModalOpen}
        title="Exílio"
      >
        {exileCards.length ? (
          <div className="player-hand">
            {exileCards.map((card, index) => (
              <div className="player-hand__slot" key={`exile-card-${card.instanceId}`}>
                <CardItem
                  category={card.category}
                  cost={card.category === 'imo' ? card.imoCost || 0 : undefined}
                  costLabel="Custo Imo"
                  description={card.effect}
                  footer={
                    <div className="row-wrap">
                      <span>{index === 0 ? 'Topo do exílio' : `Posição ${index + 1}`}</span>
                    </div>
                  }
                  imageSrc={resolveCardImageUrl(card.imagePath)}
                  name={card.name}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">Nenhuma carta exilada no momento.</div>
        )}
      </Modal>
    </section>
  );
}




