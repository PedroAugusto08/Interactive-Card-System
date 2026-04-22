const STORAGE_KEYS = {
  USERS: "acedia_users",
  SESSION: "acedia_session",
};

const DECK_LIMITS = {
  MIN: 15,
  MAX: 25,
};

const BASE_CARDS = [
  {
    id: "base-1",
    name: "Ataque Normal",
    type: "fixed",
    description: "Golpe básico de combate.",
    imoCost: 0,
    imagePath: "cartas/1.png",
  },
  {
    id: "base-2",
    name: "Ataque Crítico",
    type: "fixed",
    description: "Golpe poderoso com risco.",
    imoCost: 0,
    imagePath: "cartas/2.png",
  },
  {
    id: "base-3",
    name: "Reação",
    type: "fixed",
    description: "Resposta rápida a uma ameaça.",
    imoCost: 0,
    imagePath: "cartas/3.png",
  },
  {
    id: "base-4",
    name: "Movimento",
    type: "fixed",
    description: "Reposicionamento tático.",
    imoCost: 0,
    imagePath: "cartas/4.png",
  },
  {
    id: "base-5",
    name: "Concentrar",
    type: "fixed",
    description: "Foco antes da próxima ação.",
    imoCost: 0,
    imagePath: "cartas/5.png",
  },
];

const state = {
  users: loadUsers(),
  currentUser: null,
  draw: {
    active: false,
    pile: [],
    hand: [],
    exile: [],
  },
};

const elements = {
  authScreen: document.getElementById("auth-screen"),
  mainScreen: document.getElementById("main-screen"),
  authForm: document.getElementById("auth-form"),
  username: document.getElementById("username"),
  password: document.getElementById("password"),
  imoPoints: document.getElementById("imo-points"),
  carnePoints: document.getElementById("carne-points"),
  authFeedback: document.getElementById("auth-feedback"),
  btnRegister: document.getElementById("btn-register"),
  btnLogout: document.getElementById("btn-logout"),
  btnResetDeck: document.getElementById("btn-reset-deck"),
  welcomeText: document.getElementById("welcome-text"),
  currentImo: document.getElementById("current-imo"),
  currentCarne: document.getElementById("current-carne"),
  baseCards: document.getElementById("base-cards"),
  imoForm: document.getElementById("imo-form"),
  imoName: document.getElementById("imo-name"),
  imoCost: document.getElementById("imo-cost"),
  imoDescription: document.getElementById("imo-description"),
  imoImage: document.getElementById("imo-image"),
  imoLibrary: document.getElementById("imo-library"),
  deckCards: document.getElementById("deck-cards"),
  deckCount: document.getElementById("deck-count"),
  deckRule: document.getElementById("deck-rule"),
  deckFeedback: document.getElementById("deck-feedback"),
  btnStartDraw: document.getElementById("btn-start-draw"),
  btnDrawOne: document.getElementById("btn-draw-one"),
  btnDrawThree: document.getElementById("btn-draw-three"),
  drawPile: document.getElementById("draw-pile"),
  handCards: document.getElementById("hand-cards"),
  exileCards: document.getElementById("exile-cards"),
  drawFeedback: document.getElementById("draw-feedback"),
  cardTemplate: document.getElementById("card-template"),
  cardModal: document.getElementById("card-modal"),
  modalCloseArea: document.getElementById("modal-close-area"),
  modalClose: document.getElementById("modal-close"),
  modalCardImage: document.getElementById("modal-card-image"),
  modalCardName: document.getElementById("modal-card-name"),
  modalCardType: document.getElementById("modal-card-type"),
  modalCardDescription: document.getElementById("modal-card-description"),
};

init();

function init() {
  bindEvents();

  const sessionUser = localStorage.getItem(STORAGE_KEYS.SESSION);
  if (sessionUser && state.users[sessionUser]) {
    loginUser(sessionUser, Number(state.users[sessionUser].profile.imo), Number(state.users[sessionUser].profile.carne), "Sessão restaurada.");
    return;
  }

  showAuthScreen();
}

function bindEvents() {
  elements.authForm.addEventListener("submit", (event) => {
    event.preventDefault();
    handleLogin();
  });

  elements.btnRegister.addEventListener("click", handleRegister);
  elements.btnLogout.addEventListener("click", handleLogout);
  elements.btnResetDeck.addEventListener("click", resetDeck);

  elements.imoForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await createCustomImoCard();
  });

  elements.btnStartDraw.addEventListener("click", startDrawSimulation);
  elements.btnDrawOne.addEventListener("click", () => drawCards(1));
  elements.btnDrawThree.addEventListener("click", () => drawCards(3));

  elements.modalCloseArea.addEventListener("click", closeCardModal);
  elements.modalClose.addEventListener("click", closeCardModal);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeCardModal();
    }
  });
}

function loadUsers() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || "{}");
}

function persistUsers() {
  localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(state.users));
}

function createEmptyProfile(imo = 5, carne = 10) {
  return {
    imo,
    carne,
    deck: [],
    customImoCards: [],
  };
}

function getUserProfile() {
  const user = state.users[state.currentUser];
  return user ? user.profile : null;
}

function showAuthScreen() {
  elements.authScreen.classList.add("active");
  elements.mainScreen.classList.add("hidden");
}

function showMainScreen() {
  elements.authScreen.classList.remove("active");
  elements.mainScreen.classList.remove("hidden");
}

function setFeedback(element, message, type = "") {
  element.textContent = message;
  element.classList.remove("error", "success");
  if (type) element.classList.add(type);
}

function readAuthFields() {
  return {
    username: elements.username.value.trim(),
    password: elements.password.value.trim(),
    imo: Number(elements.imoPoints.value),
    carne: Number(elements.carnePoints.value),
  };
}

function validatePoints(imo, carne) {
  return Number.isFinite(imo) && Number.isFinite(carne) && imo >= 0 && carne >= 0;
}

function handleRegister() {
  const { username, password, imo, carne } = readAuthFields();

  if (!username || !password) {
    setFeedback(elements.authFeedback, "Preencha usuário e senha.", "error");
    return;
  }

  if (!validatePoints(imo, carne)) {
    setFeedback(elements.authFeedback, "Informe Imo/Carne válidos.", "error");
    return;
  }

  if (state.users[username]) {
    setFeedback(elements.authFeedback, "Usuário já existe. Faça login.", "error");
    return;
  }

  state.users[username] = {
    password,
    profile: createEmptyProfile(imo, carne),
  };

  persistUsers();
  setFeedback(elements.authFeedback, "Conta criada com sucesso.", "success");
}

function handleLogin() {
  const { username, password, imo, carne } = readAuthFields();
  const user = state.users[username];

  if (!user || user.password !== password) {
    setFeedback(elements.authFeedback, "Credenciais inválidas.", "error");
    return;
  }

  if (!validatePoints(imo, carne)) {
    setFeedback(elements.authFeedback, "Informe Imo/Carne válidos.", "error");
    return;
  }

  loginUser(username, imo, carne, "Login realizado.");
}

function loginUser(username, imo, carne, message = "") {
  state.currentUser = username;

  if (!state.users[username].profile) {
    state.users[username].profile = createEmptyProfile(imo, carne);
  }

  state.users[username].profile.imo = imo;
  state.users[username].profile.carne = carne;
  persistUsers();

  localStorage.setItem(STORAGE_KEYS.SESSION, username);
  elements.welcomeText.textContent = `Sobrevivente: ${username}`;

  showMainScreen();
  resetDrawState();
  renderAll();
  setFeedback(elements.authFeedback, message, "success");
}

function handleLogout() {
  state.currentUser = null;
  resetDrawState();
  localStorage.removeItem(STORAGE_KEYS.SESSION);
  elements.authForm.reset();
  showAuthScreen();
  setFeedback(elements.authFeedback, "Sessão encerrada.");
}

function getAllImoCards() {
  const profile = getUserProfile();
  if (!profile) return [];
  return profile.customImoCards || [];
}

function renderAll() {
  renderTopbarPoints();
  renderBaseCards();
  renderImoLibrary();
  renderDeck();
  renderDrawArea();
}

function renderTopbarPoints() {
  const profile = getUserProfile();
  if (!profile) return;

  elements.currentImo.textContent = String(profile.imo);
  elements.currentCarne.textContent = String(profile.carne);
}

function cardTypeLabel(card) {
  const baseLabel = card.type === "imo" ? "Imo" : "Fixa";
  return `${baseLabel} • Custo ${card.imoCost}`;
}

function createCardNode(card) {
  const fragment = elements.cardTemplate.content.cloneNode(true);
  const cardElement = fragment.querySelector(".card");
  const imageElement = fragment.querySelector(".card-image");
  const nameElement = fragment.querySelector(".card-name");
  const typeElement = fragment.querySelector(".card-type");
  const descriptionElement = fragment.querySelector(".card-description");

  imageElement.src = card.imagePath;
  imageElement.alt = `Arte da carta ${card.name}`;
  nameElement.textContent = card.name;
  typeElement.textContent = cardTypeLabel(card);
  descriptionElement.textContent = card.description;

  cardElement.classList.add(card.type === "imo" ? "imo" : "fixed");
  cardElement.title = "Clique para visualizar a carta";
  cardElement.addEventListener("click", () => openCardModal(card));

  return cardElement;
}

function appendCardAction(cardNode, label, onClick, variant = "btn-secondary") {
  const actions = cardNode.querySelector(".card-actions");
  const button = document.createElement("button");
  button.type = "button";
  button.className = `btn ${variant} card-action-btn`;
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  actions.appendChild(button);
}

function renderBaseCards() {
  elements.baseCards.innerHTML = "";
  BASE_CARDS.forEach((card) => {
    const cardNode = createCardNode(card);
    appendCardAction(cardNode, "Adicionar", () => addCardToDeck(card), "btn-primary");
    elements.baseCards.appendChild(cardNode);
  });
}

function renderImoLibrary() {
  elements.imoLibrary.innerHTML = "";
  getAllImoCards().forEach((card) => {
    const cardNode = createCardNode(card);
    appendCardAction(cardNode, "Adicionar", () => addCardToDeck(card), "btn-accent");
    elements.imoLibrary.appendChild(cardNode);
  });
}

function makeDeckInstance(card) {
  return {
    ...card,
    instanceId: crypto.randomUUID(),
  };
}

function addCardToDeck(card) {
  const profile = getUserProfile();
  if (!profile) return;

  if (profile.deck.length >= DECK_LIMITS.MAX) {
    setFeedback(elements.deckFeedback, "Deck no limite máximo (25).", "error");
    return;
  }

  profile.deck.push(makeDeckInstance(card));
  persistUsers();
  renderDeck();
  setFeedback(elements.deckFeedback, `${card.name} adicionada ao deck.`, "success");
}

function removeDeckCard(instanceId) {
  const profile = getUserProfile();
  if (!profile) return;

  const index = profile.deck.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return;

  const [removed] = profile.deck.splice(index, 1);
  persistUsers();
  renderDeck();
  setFeedback(elements.deckFeedback, `${removed.name} removida do deck.`, "");
}

function renderDeck() {
  const profile = getUserProfile();
  if (!profile) return;

  elements.deckCards.innerHTML = "";
  profile.deck.forEach((card) => {
    const cardNode = createCardNode(card);
    appendCardAction(cardNode, "Remover", () => removeDeckCard(card.instanceId), "btn-danger");
    elements.deckCards.appendChild(cardNode);
  });

  updateDeckStatus(profile.deck.length);
}

function updateDeckStatus(deckSize) {
  elements.deckCount.textContent = `${deckSize} cartas`;
  elements.deckRule.classList.remove("good", "bad");
  if (deckSize >= DECK_LIMITS.MIN && deckSize <= DECK_LIMITS.MAX) {
    elements.deckRule.classList.add("good");
  } else {
    elements.deckRule.classList.add("bad");
  }
}

function resetDeck() {
  const profile = getUserProfile();
  if (!profile) return;

  profile.deck = [];
  persistUsers();
  resetDrawState();
  renderAll();
  setFeedback(elements.deckFeedback, "Deck resetado.");
}

async function createCustomImoCard() {
  const profile = getUserProfile();
  if (!profile) return;

  const name = elements.imoName.value.trim();
  const description = elements.imoDescription.value.trim();
  const imoCost = Number(elements.imoCost.value);
  const file = elements.imoImage.files[0];

  if (!name || !description || !file) {
    setFeedback(elements.deckFeedback, "Preencha nome, descrição e imagem da carta Imo.", "error");
    return;
  }

  if (!Number.isFinite(imoCost) || imoCost < 0) {
    setFeedback(elements.deckFeedback, "Custo de Imo inválido.", "error");
    return;
  }

  const imagePath = await fileToDataUrl(file);
  const customCard = {
    id: `imo-${crypto.randomUUID()}`,
    name,
    type: "imo",
    description,
    imoCost,
    imagePath,
  };

  profile.customImoCards.push(customCard);
  persistUsers();
  elements.imoForm.reset();
  elements.imoCost.value = "1";

  renderImoLibrary();
  setFeedback(elements.deckFeedback, "Carta Imo criada com sucesso.", "success");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function resetDrawState() {
  state.draw = {
    active: false,
    pile: [],
    hand: [],
    exile: [],
  };
}

function startDrawSimulation() {
  const profile = getUserProfile();
  if (!profile) return;

  if (profile.deck.length < DECK_LIMITS.MIN || profile.deck.length > DECK_LIMITS.MAX) {
    setFeedback(elements.drawFeedback, "Deck precisa ter entre 15 e 25 cartas.", "error");
    return;
  }

  resetDrawState();
  state.draw.active = true;
  state.draw.pile = shuffle(profile.deck.map((card) => makeDeckInstance(card)));
  renderDrawArea();
  setFeedback(elements.drawFeedback, "Simulação iniciada. Compre cartas.", "success");
}

function drawCards(amount) {
  if (!state.draw.active) {
    setFeedback(elements.drawFeedback, "Inicie a simulação primeiro.", "error");
    return;
  }

  let drawn = 0;
  for (let i = 0; i < amount; i += 1) {
    const card = state.draw.pile.shift();
    if (!card) break;
    state.draw.hand.push(card);
    drawn += 1;
  }

  if (drawn === 0) {
    setFeedback(elements.drawFeedback, "Sem cartas restantes para compra.", "error");
  } else {
    setFeedback(elements.drawFeedback, `${drawn} carta(s) comprada(s).`, "success");
  }

  renderDrawArea();
}

function exileHandCard(instanceId) {
  const index = state.draw.hand.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return;

  const [card] = state.draw.hand.splice(index, 1);
  state.draw.exile.push(card);
  renderDrawArea();
  setFeedback(elements.drawFeedback, `${card.name} enviada ao exílio.`);
}

function returnExiledCard(instanceId) {
  const index = state.draw.exile.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return;

  const [card] = state.draw.exile.splice(index, 1);
  state.draw.pile.unshift(card);
  renderDrawArea();
  setFeedback(elements.drawFeedback, `${card.name} retornou ao topo do baralho.`);
}

function renderDrawArea() {
  elements.drawPile.textContent = String(state.draw.pile.length);
  elements.handCards.innerHTML = "";
  elements.exileCards.innerHTML = "";

  state.draw.hand.forEach((card) => {
    const cardNode = createCardNode(card);
    appendCardAction(cardNode, "Exilar", () => exileHandCard(card.instanceId), "btn-danger");
    elements.handCards.appendChild(cardNode);
  });

  state.draw.exile.forEach((card) => {
    const cardNode = createCardNode(card);
    appendCardAction(cardNode, "Retornar", () => returnExiledCard(card.instanceId), "btn-secondary");
    elements.exileCards.appendChild(cardNode);
  });
}

function openCardModal(card) {
  elements.modalCardImage.src = card.imagePath;
  elements.modalCardImage.alt = `Imagem da carta ${card.name}`;
  elements.modalCardName.textContent = card.name;
  elements.modalCardType.textContent = cardTypeLabel(card);
  elements.modalCardDescription.textContent = card.description;
  elements.cardModal.classList.remove("hidden");
}

function closeCardModal() {
  elements.cardModal.classList.add("hidden");
}

function shuffle(array) {
  const clone = [...array];
  for (let i = clone.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone;
}