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

const ACTION_COPY = {
  drawCard: 'comprar carta',
  playCard: 'jogar cartas',
  discardCard: 'descartar cartas',
  endTurn: 'encerrar o turno',
};

function formatNaturalList(items) {
  if (!items.length) {
    return '';
  }

  if (items.length === 1) {
    return items[0];
  }

  if (items.length === 2) {
    return `${items[0]} e ${items[1]}`;
  }

  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

function buildActionReason(action, { focusedParticipant, availableActions, isSubmitting }) {
  if (isSubmitting) {
    return 'Aguarde a acao atual terminar.';
  }

  if (!focusedParticipant) {
    return 'Selecione um participante em foco para agir.';
  }

  if (availableActions.includes(action)) {
    return '';
  }

  if (!focusedParticipant.isCurrentTurn) {
    return 'Voce so pode agir no turno do participante em foco.';
  }

  if (action === 'drawCard') {
    return 'Essa compra nao esta disponivel agora.';
  }

  if (action === 'endTurn') {
    return 'Essa acao ainda nao esta disponivel agora.';
  }

  if (action === 'playCard') {
    return 'Voce ainda nao pode jogar cartas nessa janela.';
  }

  if (action === 'discardCard') {
    return 'Voce ainda nao pode descartar cartas nessa janela.';
  }

  return 'Essa acao nao esta disponivel agora.';
}

function buildContextBarState({
  focusedParticipant,
  activeTurnParticipant,
  availableActions,
  combatState,
  isCurrentUserCombatDefender,
  controlledParticipantIds,
}) {
  if (combatState?.status === 'awaiting-reaction' && isCurrentUserCombatDefender) {
    return {
      tone: 'danger',
      eyebrow: 'Resposta de ataque pendente',
      title: `${combatState.attackerDisplayName} atacou ${combatState.defenderDisplayName}.`,
      description: 'Use uma Reacao agora ou siga sem responder.',
      badge: '⚔️ Defesa',
    };
  }

  if (combatState?.status === 'awaiting-reaction-result' && isCurrentUserCombatDefender) {
    return {
      tone: 'accent',
      eyebrow: 'Teste de defesa',
      title: 'Resolva o teste fisico para liberar sua resposta.',
      description: 'Se superar o ataque, a mesa libera uma carta em resposta.',
      badge: '🛡️ Em resolucao',
    };
  }

  if (combatState?.status === 'awaiting-counter-response' && isCurrentUserCombatDefender) {
    return {
      tone: 'success',
      eyebrow: 'Resposta liberada',
      title: 'Voce pode jogar ou descartar uma carta agora.',
      description: 'Escolha a melhor resposta antes da rodada continuar.',
      badge: '✨ Janela aberta',
    };
  }

  if (!focusedParticipant) {
    return {
      tone: 'secondary',
      eyebrow: 'Sem foco',
      title: 'Nenhum participante sob seu controle esta em foco.',
      description: 'Selecione uma criatura para acompanhar a rodada.',
      badge: '🧿 Foco',
    };
  }

  const actionLabels = availableActions.map((action) => ACTION_COPY[action]).filter(Boolean);
  const actionCount = actionLabels.length;
  const currentTurnIsControlled =
    activeTurnParticipant && controlledParticipantIds.includes(activeTurnParticipant.participantId);

  if (focusedParticipant.isCurrentTurn) {
    return {
      tone: 'success',
      eyebrow: 'Seu turno',
      title: `${focusedParticipant.displayName} esta na vez.`,
      description: actionCount
        ? `Voce pode ${formatNaturalList(actionLabels)}.`
        : 'Nenhuma acao esta disponivel nesse momento.',
      badge: `${actionCount} acoes disponiveis`,
    };
  }

  if (currentTurnIsControlled && activeTurnParticipant) {
    return {
      tone: 'primary',
      eyebrow: 'Sua mesa esta agindo',
      title: `${activeTurnParticipant.displayName} esta na vez agora.`,
      description: 'Troque o foco para a criatura ativa se quiser acompanhar as acoes dela.',
      badge: '🧿 Trocar foco',
    };
  }

  return {
    tone: 'secondary',
    eyebrow: 'Aguardando rodada',
    title: `Aguardando ${activeTurnParticipant?.displayName || 'outro participante'} agir...`,
    description: 'Suas cartas ficam disponiveis quando um participante sob seu controle entrar na vez.',
    badge: '⌛ Em espera',
  };
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
  const contextBarState = buildContextBarState({
    focusedParticipant,
    activeTurnParticipant,
    availableActions,
    combatState,
    isCurrentUserCombatDefender,
    controlledParticipantIds,
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
      setLocalError('Selecione uma carta do seu exilio.');
      return;
    }

    if (requiresOwnHandSelection && !pendingCardAction.selectedOwnHandCardId) {
      setLocalError('Selecione uma carta da sua mao para passar.');
      return;
    }

    if (requiresTargetHandSelection && !pendingCardAction.selectedTargetHandCardId) {
      setLocalError('Selecione uma carta da mao do alvo.');
      return;
    }

    if (requiresPairedTarget && !pendingCardAction.pairedTargetParticipantId) {
      setLocalError('Selecione um alvo para a carta jogada junto.');
      return;
    }

    if (requiresPairedExileSelection && !pendingCardAction.pairedSelectedExileCardId) {
      setLocalError('Selecione uma carta do exilio para a carta jogada junto.');
      return;
    }

    if (requiresPairedOwnHandSelection && !pendingCardAction.pairedSelectedOwnHandCardId) {
      setLocalError('Selecione uma carta da sua mao para a carta jogada junto.');
      return;
    }

    if (requiresPairedTargetHandSelection && !pendingCardAction.pairedSelectedTargetHandCardId) {
      setLocalError('Selecione uma carta da mao do alvo da carta jogada junto.');
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

  if (!currentRoom) {
    return (
      <section className="stack-gap-lg">
        <Card title="Partida">
          <div className="empty-state">Nenhuma sala ativa carregada.</div>
        </Card>
      </section>
    );
  }

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
            <Badge tone="success">Atualizacao</Badge>
            <span>{syncMessage}</span>
          </div>
        ) : null}
      </div>
      {localError ? <p className="error-text">{localError}</p> : null}

      <div className="grid-2">
        <div className="stack-gap">
          <Card
            className="match-initiative-card"
            actions={
              <div className="row-wrap">
                <Badge tone={isViewerTurn ? 'success' : 'secondary'}>
                  ⚔️ {activeTurnParticipant?.displayName || 'Participante'}
                </Badge>
                <Badge tone="accent">{participantStates.length} na mesa</Badge>
              </div>
            }
            title="Iniciativa"
          >
            <div className="stack-gap match-initiative-track" style={{ gap: '12px' }}>
              {participantStates.map((participant) => (
                <button
                  aria-disabled={!participant.isControlledByViewer}
                  aria-pressed={focusedParticipantId === participant.participantId}
                  className={[
                    'match-initiative-item',
                    participant.isCurrentTurn ? 'match-initiative-item--active' : '',
                    focusedParticipantId === participant.participantId ? 'match-initiative-item--focused' : '',
                    participant.isDefeated ? 'match-initiative-item--defeated' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  key={`participant-state-${participant.participantId}`}
                  onClick={() =>
                    participant.isControlledByViewer
                      ? setManualFocusedParticipantId(participant.participantId)
                      : undefined
                  }
                  style={{
                    cursor: participant.isControlledByViewer ? 'pointer' : 'default',
                  }}
                  type="button"
                >
                  <span className="match-initiative-item__order">{participant.turnOrder}</span>

                  <div className="stack-gap match-initiative-item__body" style={{ gap: '4px' }}>
                    <div className="row-wrap match-initiative-item__header">
                      <strong>{participant.displayName}</strong>
                      {participant.isDefeated ? <Badge tone="danger">Derrotado</Badge> : null}
                    </div>
                    <span className="muted-text compact">
                      {participant.isCurrentTurn
                        ? participant.isControlledByViewer
                          ? 'Sua vez com este participante.'
                          : 'Participante ativo na rodada.'
                        : participant.isControlledByViewer
                          ? 'Sob seu controle. Clique para focar na mesa.'
                          : participant.participantType === 'master-creature'
                            ? 'Criatura aguardando a vez.'
                            : 'Jogador aguardando a vez.'}
                    </span>
                  </div>

                  <div className="match-initiative-item__state">
                    {participant.isControlledByViewer && !participant.isCurrentTurn ? (
                      <span className="match-initiative-item__pill match-initiative-item__pill--control">
                        Seu controle
                      </span>
                    ) : null}
                    {participant.isCurrentTurn ? (
                      <span className="match-initiative-item__pill match-initiative-item__pill--active">Agindo</span>
                    ) : null}
                    {focusedParticipantId === participant.participantId ? (
                      <span className="match-initiative-item__pill match-initiative-item__pill--focus">Em foco</span>
                    ) : participant.isControlledByViewer ? (
                      <span className="match-initiative-item__link">Focar</span>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          </Card>

          <Card className="match-log-card" title="Historico da mesa">
            {logs.length ? (
              <div className="stack-gap" style={{ gap: '10px' }}>
                {logs.map((item) => (
                  <ActionLogItem item={item} key={`match-log-${item.id || item.timestamp}`} />
                ))}
              </div>
            ) : (
              <div className="empty-state">Ainda nao ha eventos registrados.</div>
            )}
          </Card>
        </div>

        <div className="stack-gap">
          <Card
            className="match-focus-card"
            actions={
              focusedParticipant ? (
                <Badge tone={focusedParticipant.isCurrentTurn ? 'success' : 'secondary'}>
                  🧿 {focusedParticipant.displayName}
                </Badge>
              ) : null
            }
            title="Participante em foco"
          >
            {focusedParticipant ? (
              <div className="stack-gap" style={{ gap: '18px' }}>
                {controlledParticipants.length > 1 ? (
                  <div className="stack-gap match-focus-switcher" style={{ gap: '10px' }}>
                    <div className="row-wrap">
                      <strong>Alternar criatura em foco</strong>
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

                <div className="match-table-layout">
                  <aside className="match-table-layout__rail">
                    <div className="row-wrap match-focus-metrics">
                      <Badge tone="primary">Vida {focusedParticipant.health}</Badge>
                      <Badge tone="accent">Imo {focusedParticipant.imo}/{focusedParticipant.maxImo}</Badge>
                      <Badge tone="secondary">Iniciativa {focusedParticipant.turnOrder}</Badge>
                      {focusedParticipant.isCurrentTurn ? <Badge tone="success">Agindo</Badge> : null}
                    </div>

                    <div className={['match-context-bar', `match-context-bar--${contextBarState.tone}`].join(' ')}>
                      <div className="match-context-bar__copy">
                        <span className="match-context-bar__eyebrow">{contextBarState.eyebrow}</span>
                        <strong>{contextBarState.title}</strong>
                        <span className="muted-text compact">{contextBarState.description}</span>
                      </div>
                      <Badge tone={contextBarState.tone}>{contextBarState.badge}</Badge>
                    </div>

                    <div className="match-zone-rail">
                      <ZoneContainer
                        count={focusedZones.deckCount}
                        description="Cartas restantes"
                        title="Deck"
                      />
                      <ZoneContainer
                        count={focusedZones.exileCount}
                        description="Cartas removidas"
                        onClick={() => setIsExileModalOpen(true)}
                        previewCards={exileCards}
                        title="Exilio"
                        tone="accent"
                      />
                    </div>
                  </aside>

                  <div className="match-table-layout__main">
                    <div className="stack-gap match-hand-stage" style={{ gap: '12px' }}>
                      <div className="match-hand-stage__header">
                        <div className="stack-gap" style={{ gap: '6px' }}>
                          <div className="row-wrap">
                            <strong>Mao</strong>
                            <Badge tone="secondary">{focusedZones.handCount} cartas</Badge>
                            {availableActions.includes('playCard') ? <Badge tone="success">Janela de jogo</Badge> : null}
                          </div>
                          <span className="muted-text compact">{contextBarState.description}</span>
                        </div>

                        <div className="row-wrap match-hand-stage__actions">
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
                          {drawDisabledReason || endTurnDisabledReason || 'Essa acao nao esta disponivel agora.'}
                        </span>
                      ) : null}

                      <PlayerHand
                        canDiscard={availableActions.includes('discardCard')}
                        canPlay={availableActions.includes('playCard')}
                        cards={handCards}
                        discardDisabledReason={discardDisabledReason}
                        isSubmitting={isSubmitting}
                        onDiscardCard={(cardId) => openCardAction('match:discardCard', cardId)}
                        onPlayCard={(cardId) => openCardAction('match:playCard', cardId)}
                        onSelectCard={setSelectedHandCardId}
                        playDisabledReason={playDisabledReason}
                        selectedCardId={selectedHandCardId}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty-state">Nenhum participante sob seu controle nesta partida.</div>
            )}
          </Card>

          <Card
            className="match-users-card"
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
            title="Usuarios na sala"
          >
            <div className="row-wrap">
              <Badge tone="secondary">{players.length} conectados</Badge>
              <span className="muted-text compact">Presenca da sala durante a partida.</span>
            </div>

            {!isRoomUsersCollapsed ? (
              <div className="stack-gap match-users-list" style={{ gap: '10px', marginTop: '12px' }}>
                {players.map((player) => (
                  <div
                    key={`room-player-${player.user_id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                      padding: '10px 12px',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: '14px',
                      background: player.is_master ? 'rgba(255,255,255,0.03)' : 'transparent',
                    }}
                  >
                    <div className="stack-gap" style={{ gap: '2px' }}>
                      <strong>{player.username}</strong>
                      <div className="row-wrap">
                        <Badge tone={player.is_master ? 'accent' : 'secondary'}>
                          {player.is_master ? '👑 Mestre' : '🎮 Jogador'}
                        </Badge>
                        <Badge tone={player.is_ready ? 'success' : 'secondary'}>
                          {player.is_ready ? 'Pronto' : 'Nao pronto'}
                        </Badge>
                      </div>
                    </div>
                    {player.user_id === currentRoom?.host_id ? <Badge tone="accent">👑 Host</Badge> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </Card>
        </div>
      </div>

      <Modal
        confirmLabel="Encerrar turno"
        description="Essa criatura ainda nao comprou carta neste turno. Encerrar mesmo assim?"
        isLoading={isSubmitting}
        onClose={() => setIsEndTurnConfirmOpen(false)}
        onConfirm={handleConfirmEndTurn}
        open={isEndTurnConfirmOpen}
        title="Confirmar turno"
      >
        <p className="muted-text">Voce pode confirmar agora ou voltar e comprar uma carta antes de encerrar o turno.</p>
      </Modal>

      <Modal
        confirmLabel={pendingCardAction ? 'Confirmar acao' : 'Fechar'}
        description={
          pendingCardAction
            ? `Complete as escolhas necessarias para ${pendingCardAction.cardName}.`
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
                  <p className="muted-text">Nenhum alvo disponivel para esta carta.</p>
                )}
              </section>
            ) : null}

            {pendingCardAction.automation?.selection === 'own-exile-card' ? (
              <section className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">Escolha a carta do exilio</span>
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
                  <p className="muted-text">Seu exilio esta vazio.</p>
                )}
              </section>
            ) : null}

            {automationRequiresOwnHandSelection(pendingCardAction.automation) ? (
              <section className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">Escolha outra carta da sua mao</span>
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
                  <p className="muted-text">Nao ha outra carta disponivel na sua mao.</p>
                )}
              </section>
            ) : null}

            {automationRequiresTargetHandSelection(pendingCardAction.automation) ? (
              <section className="stack-gap" style={{ gap: '10px' }}>
                <span className="status-label">Escolha a carta da mao do alvo</span>
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
                    <p className="muted-text">A mao do alvo esta vazia.</p>
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
                <span className="status-label">Escolha a carta do exilio para a carta extra</span>
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
                <span className="status-label">Escolha a carta da sua mao para a carta extra</span>
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
                <span className="status-label">Escolha a carta da mao do alvo da carta extra</span>
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
        cancelLabel={null}
        confirmLabel={
          combatState?.status === 'awaiting-reaction'
            ? 'Seguir sem reacao'
            : combatState?.status === 'awaiting-reaction-result'
              ? 'Nao superou'
              : 'Pular resposta'
        }
        description={
          combatState?.status === 'awaiting-reaction'
            ? `${combatState.attackerDisplayName} atacou ${combatState.defenderDisplayName}. Se voce tiver Reacao na mao, pode usa-la agora.`
            : combatState?.status === 'awaiting-reaction-result'
              ? 'Resolva fisicamente o teste de defesa. Se tiver sucesso, libera uma carta de resposta.'
              : `Voce superou o ataque. Agora pode jogar ou descartar uma carta em resposta antes de seguir a partida.`
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
        open={isCurrentUserCombatDefender && !pendingCardAction}
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
                            Usar Reacao
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
              <div className="empty-state">Voce nao tem uma carta de Reacao disponivel na mao.</div>
            )}
          </div>
        ) : null}

        {combatState?.status === 'awaiting-reaction-result' ? (
          <div className="stack-gap" style={{ gap: '14px' }}>
            <Badge tone="primary">Reacao usada</Badge>
            <p className="muted-text">Resolva o teste fisico e, se tiver sucesso, libere a carta de resposta.</p>
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
              ? `Voce visualizou uma carta aleatoria da mao de ${activeTopDeckView.targetDisplayName}. Essa informacao fica apenas com voce.`
              : `Voce visualizou o topo do deck de ${activeTopDeckView.targetDisplayName}. Revele para a mesa apenas se quiser compartilhar essa informacao.`
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
          <div className="empty-state">Nao foi possivel carregar a carta visualizada.</div>
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
        description="As cartas aparecem em ordem no exilio: do topo para o fundo."
        onClose={() => setIsExileModalOpen(false)}
        onConfirm={() => setIsExileModalOpen(false)}
        open={isExileModalOpen}
        title="Exilio"
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
                      <span>{index === 0 ? 'Topo do exilio' : `Posicao ${index + 1}`}</span>
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

