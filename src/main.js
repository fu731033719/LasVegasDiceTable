import * as THREE from "three";
import { joinRoom, selfId } from "trystero";

const ZONES = [
  { id: 1, name: "游戏1", type: "game", rewards: [40000, 40000], color: 0xd77847 },
  { id: 2, name: "游戏2", type: "game", rewards: [50000, 30000], color: 0xc95a3f },
  { id: 3, name: "游戏3", type: "game", rewards: [50000, 30000], color: 0xa64738 },
  { id: 4, name: "基础区4", type: "base", rewards: [90000, 40000], color: 0x4b9998 },
  { id: 5, name: "基础区5", type: "base", rewards: [80000, 30000], color: 0x3b7d84 },
  { id: 6, name: "基础区6", type: "base", rewards: [50000, 50000], color: 0x2d6069 },
];

const POLLUTION_PILES = [2, 2, 3, 1, 1, 2];
const GAME3_REWARDS = [5000, 8000, 15000, 30000, 50000, 80000];
const PLAYER_COLORS = ["#b8482d", "#116a73", "#8b6016", "#6241a6", "#22654b", "#8f2d58"];
const PLAYER_NAMES_STORAGE_KEY = "las-vegas-player-names";
const PARTICIPANT_ID_STORAGE_KEY = "las-vegas-participant-id";
const NETWORK_APP_ID = "las-vegas-desktop-openai";
const UI_ZONE_NAMES = {
  1: "浑水摸鱼",
  2: "猜正反",
  3: "猜大小",
  4: "基础区",
  5: "基础区",
  6: "基础区",
};

const state = {
  players: [],
  seatClaims: {},
  neutralPlacements: {},
  pollutionPiles: [],
  editingNamePlayerId: null,
  currentPlayerIndex: 0,
  roll: [],
  rollCounts: {},
  hasRolled: false,
  isRolling: false,
  gameOver: false,
  log: [],
  modal: null,
};

const els = {
  playerCount: document.getElementById("playerCount"),
  rulesBtn: document.getElementById("rulesBtn"),
  newGameBtn: document.getElementById("newGameBtn"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  copyJoinLinkBtn: document.getElementById("copyJoinLinkBtn"),
  currentPlayerName: document.getElementById("currentPlayerName"),
  roundInfo: document.getElementById("roundInfo"),
  diceLeftInfo: document.getElementById("diceLeftInfo"),
  roomCodeInfo: document.getElementById("roomCodeInfo"),
  networkStatus: document.getElementById("networkStatus"),
  peerCountInfo: document.getElementById("peerCountInfo"),
  netRoleBadge: document.getElementById("netRoleBadge"),
  rollHint: document.getElementById("rollHint"),
  groupOptions: document.getElementById("groupOptions"),
  rollBtn: document.getElementById("rollBtn"),
  boardActionHint: document.getElementById("boardActionHint"),
  boardActionBtn: document.getElementById("boardActionBtn"),
  boardRollPulse: document.getElementById("boardRollPulse"),
  playersPanel: document.getElementById("playersPanel"),
  logList: document.getElementById("logList"),
  logDock: document.getElementById("logDock"),
  logWindow: document.getElementById("logWindow"),
  logToggleBtn: document.getElementById("logToggleBtn"),
  logCloseBtn: document.getElementById("logCloseBtn"),
  modal: document.getElementById("modal"),
  modalTitle: document.getElementById("modalTitle"),
  modalBody: document.getElementById("modalBody"),
  closeModalBtn: document.getElementById("closeModalBtn"),
  threeMount: document.getElementById("threeMount"),
  zoneInfoOverlay: document.getElementById("zoneInfoOverlay"),
  turnToast: document.getElementById("turnToast"),
};

const view = {
  renderer: null,
  scene: null,
  camera: null,
  boardRoot: null,
  diceRoot: null,
  zoneObjects: new Map(),
  rollingDice: [],
  selectableDice: [],
  hoveredDieValue: null,
  centerDiceSyncKey: "",
  centerHitMesh: null,
  raycaster: new THREE.Raycaster(),
  pointer: new THREE.Vector2(),
  overlayCanvas: document.createElement("canvas"),
  modalThree: null,
  game1Overlay: null,
  game1DraggedEl: null,
  game1PileScenes: [],
};

const network = {
  room: null,
  roomId: "",
  isHost: false,
  connectedPeers: 0,
  localParticipantId: getOrCreateParticipantId(),
  peerParticipants: {},
  sendSnapshot: null,
  sendIntent: null,
  sendPresence: null,
  lastSnapshotHash: "",
};

init();

function init() {
  applyUiCopyOverrides();
  for (let count = 2; count <= 6; count += 1) {
    const option = document.createElement("option");
    option.value = String(count);
    option.textContent = `${count} 人`;
    els.playerCount.appendChild(option);
  }
  els.playerCount.value = "2";
  normalizePlayerCountOptions();

  setupBoardActionHint();
  setupRulesButton();
  hideLegacyRollPanel();

  initThreeScene();

  els.rulesBtn?.addEventListener("click", showRulesModal);
  els.newGameBtn.addEventListener("click", () => startNewGame(Number(els.playerCount.value)));
  els.createRoomBtn.addEventListener("click", createHostedRoom);
  els.copyJoinLinkBtn.addEventListener("click", copyJoinLink);
  els.logToggleBtn.addEventListener("click", toggleLogWindow);
  els.logCloseBtn.addEventListener("click", closeLogWindow);
  els.closeModalBtn.addEventListener("click", () => {
    if (!state.modal || !state.modal.allowClose) return;
    if (!canManageRoomLocally()) return;
    closeModal();
  });
  window.addEventListener("resize", handleResize);

  initNetworkingFromUrl();
  startNewGame(2);
  animate();
}

function applyUiCopyOverrides() {
  ZONES.forEach((zone) => {
    zone.name = UI_ZONE_NAMES[zone.id] || zone.name;
  });
}

function normalizePlayerCountOptions() {
  [...els.playerCount.options].forEach((option) => {
    option.textContent = `${option.value} 人`;
  });
}

function toggleLogWindow() {
  els.logWindow.classList.toggle("hidden");
  els.logDock.classList.toggle("open", !els.logWindow.classList.contains("hidden"));
}

function closeLogWindow() {
  els.logWindow.classList.add("hidden");
  els.logDock.classList.remove("open");
}

function initNetworkingFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("room")?.trim() || "";
  const hostFlag = params.get("host");
  if (!roomId) {
    renderNetworkPanel();
    return;
  }

  connectToRoom(roomId, hostFlag === "1" || hostFlag === "true");
}

function createHostedRoom() {
  if (network.roomId && network.isHost) {
    copyJoinLink();
    return;
  }

  const roomId = createRoomId();
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("room", roomId);
  nextUrl.searchParams.set("host", "1");
  window.history.replaceState({}, "", nextUrl);
  connectToRoom(roomId, true);
  render();
}

async function copyJoinLink() {
  if (!network.roomId) return;
  const joinUrl = getJoinUrl();
  try {
    await navigator.clipboard.writeText(joinUrl);
    els.networkStatus.textContent = "访客链接已复制";
  } catch {
    els.networkStatus.textContent = joinUrl;
  }
}

function getJoinUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("room", network.roomId);
  url.searchParams.delete("host");
  return url.toString();
}

function connectToRoom(roomId, isHost) {
  if (network.room) {
    network.room.leave?.();
  }

  network.roomId = roomId;
  network.isHost = isHost;
  network.connectedPeers = 0;
  network.peerParticipants = {};
  network.lastSnapshotHash = "";

  const room = joinRoom({ appId: NETWORK_APP_ID }, roomId);
  const [sendSnapshot, getSnapshot] = room.makeAction("snapshot");
  const [sendIntent, getIntent] = room.makeAction("intent");
  const [sendPresence, getPresence] = room.makeAction("presence");
  network.room = room;
  network.sendSnapshot = sendSnapshot;
  network.sendIntent = sendIntent;
  network.sendPresence = sendPresence;
  network.peerParticipants[selfId] = network.localParticipantId;

  getSnapshot((snapshot) => {
    if (network.isHost || !snapshot) return;
    applyRemoteSnapshot(snapshot);
  });

  getIntent((intent, peerId) => {
    if (!network.isHost || !intent) return;
    const actorId = network.peerParticipants[peerId] || intent.participantId;
    if (!actorId) return;
    handleIntent(intent, actorId);
  });

  getPresence((presence, peerId) => {
    if (!network.isHost || !presence?.participantId) return;
    network.peerParticipants[peerId] = presence.participantId;
    maybeBroadcastState();
  });

  room.onPeerJoin((peerId) => {
    network.connectedPeers += 1;
    renderNetworkPanel();
    announcePresence(peerId);
    if (network.isHost) {
      sendSnapshot(buildSerializableState(), peerId);
    }
  });

  room.onPeerLeave((peerId) => {
    network.connectedPeers = Math.max(0, network.connectedPeers - 1);
    const participantId = network.peerParticipants[peerId];
    delete network.peerParticipants[peerId];
    if (network.isHost && participantId) {
      releaseSeatClaimsForParticipant(participantId);
    }
    renderNetworkPanel();
  });

  announcePresence();
  renderNetworkPanel();
}

function buildSerializableState() {
  return JSON.parse(JSON.stringify(state));
}

function applyRemoteSnapshot(snapshot) {
  state.players = (snapshot.players || []).map((player) => ({
    rerollTokens: 2,
    ...player,
  }));
  state.pollutionPiles = Array.isArray(snapshot.pollutionPiles)
    ? snapshot.pollutionPiles.map((pile, index) => ({
        id: pile?.id ?? index + 1,
        count: Number(pile?.count ?? POLLUTION_PILES[index] ?? 0),
        used: Boolean(pile?.used),
      }))
    : POLLUTION_PILES.map((count, index) => ({ id: index + 1, count, used: false }));
  if (state.players.length) {
    els.playerCount.value = String(state.players.length);
  }
  state.seatClaims = snapshot.seatClaims || {};
  state.neutralPlacements = normalizeNeutralPlacements(snapshot.neutralPlacements);
  state.currentPlayerIndex = snapshot.currentPlayerIndex ?? 0;
  state.roll = snapshot.roll || [];
  state.rollCounts = snapshot.rollCounts || {};
  state.hasRolled = Boolean(snapshot.hasRolled);
  state.isRolling = Boolean(snapshot.isRolling);
  state.gameOver = Boolean(snapshot.gameOver);
  state.log = snapshot.log || [];
  state.modal = snapshot.modal || null;
  syncCenterDiceSceneWithState();
  render();
}

function maybeBroadcastState() {
  if (!network.room || !network.isHost || !network.sendSnapshot) return;
  const snapshot = buildSerializableState();
  const hash = JSON.stringify(snapshot);
  if (hash === network.lastSnapshotHash) return;
  network.lastSnapshotHash = hash;
  network.sendSnapshot(snapshot);
  renderNetworkPanel();
}

function renderNetworkPanel() {
  els.roomCodeInfo.textContent = network.roomId || "未创建";
  els.peerCountInfo.textContent = String(network.connectedPeers);
  els.netRoleBadge.textContent = network.roomId ? (network.isHost ? "房主" : "访客") : "单机";
  els.networkStatus.textContent = network.roomId ? (network.isHost ? `房主在线 · ${selfId}` : `已加入房间 · ${selfId}`) : "未连接";
  els.copyJoinLinkBtn.disabled = !network.roomId;
  els.createRoomBtn.textContent = network.isHost ? "复制房间" : "创建房间";
}

function announcePresence(peerId) {
  if (!network.room || !network.sendPresence) return;
  network.sendPresence({ participantId: network.localParticipantId }, peerId);
}

function getLocalActorId() {
  return network.roomId ? network.localParticipantId : "local";
}

function getClaimedSeatForActor(actorId) {
  return state.players.find((player) => state.seatClaims[player.id] === actorId) || null;
}

function getLocalClaimedSeat() {
  return getClaimedSeatForActor(getLocalActorId());
}

function canActOnCurrentTurn(actorId = getLocalActorId()) {
  if (!network.roomId) return true;
  const player = getCurrentPlayer();
  if (!player) return false;
  return state.seatClaims[player.id] === actorId;
}

function canEditPlayerNameLocally(playerId) {
  if (!network.roomId) return true;
  return state.seatClaims[playerId] === getLocalActorId();
}

function canManageRoomLocally() {
  return !network.roomId || network.isHost;
}

function canControlGameLocally() {
  return canActOnCurrentTurn();
}

function setupBoardActionHint() {
  if (els.boardActionHint) return;
  const boardSurface = document.querySelector(".board-surface");
  if (!boardSurface) return;

  const pulse = document.createElement("div");
  pulse.id = "boardRollPulse";
  pulse.className = "board-roll-pulse";
  pulse.appendChild(document.createElement("span"));
  boardSurface.appendChild(pulse);
  els.boardRollPulse = pulse;

  const hint = document.createElement("div");
  hint.id = "boardActionHint";
  hint.className = "board-action-hint";
  boardSurface.appendChild(hint);
  els.boardActionHint = hint;

  const actionBtn = document.createElement("button");
  actionBtn.id = "boardActionBtn";
  actionBtn.className = "board-action-btn hidden";
  actionBtn.type = "button";
  actionBtn.addEventListener("click", () => requestIntent("reroll"));
  boardSurface.appendChild(actionBtn);
  els.boardActionBtn = actionBtn;
}

function hideLegacyRollPanel() {
  if (els.rollBtn?.closest(".hud-panel")) {
    els.rollBtn.closest(".hud-panel").style.display = "none";
  }
}

function setupRulesButton() {
  if (!els.rulesBtn) return;
  els.rulesBtn.classList.add("floating-rules-btn");
  document.body.appendChild(els.rulesBtn);
}

function updateBoardActionButton() {
  if (!els.boardActionBtn) return;
  const player = getCurrentPlayer();
  const canReroll = Boolean(
    player &&
    canControlGameLocally() &&
    state.hasRolled &&
    !state.isRolling &&
    !state.modal &&
    !state.gameOver &&
    (player.rerollTokens || 0) > 0
  );

  els.boardActionBtn.classList.toggle("hidden", !canReroll);
  els.boardActionBtn.disabled = !canReroll;
  if (canReroll) {
    els.boardActionBtn.textContent = `重摇一次（剩余 ${player.rerollTokens}）`;
  }
}

function initThreeScene() {
  view.scene = new THREE.Scene();
  view.scene.background = new THREE.Color(0x3f2617);
  view.scene.fog = new THREE.Fog(0x3f2617, 18, 34);

  const width = els.threeMount.clientWidth || 900;
  const height = els.threeMount.clientHeight || 900;
  view.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
  view.camera.position.set(0, 16.5, 7.8);
  view.camera.lookAt(0, 0, 0);

  view.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  view.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  view.renderer.setSize(width, height);
  view.renderer.outputColorSpace = THREE.SRGBColorSpace;
  els.threeMount.appendChild(view.renderer.domElement);
  view.renderer.domElement.addEventListener("click", handleBoardClick);
  view.renderer.domElement.addEventListener("pointermove", handleBoardPointerMove);

  const ambient = new THREE.AmbientLight(0xf8ead8, 1.9);
  view.scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xfff3dc, 2.4);
  keyLight.position.set(4, 10, 5);
  view.scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x7ccad4, 1.2);
  fillLight.position.set(-6, 7, -2);
  view.scene.add(fillLight);

  view.boardRoot = new THREE.Group();
  view.diceRoot = new THREE.Group();
  view.scene.add(view.boardRoot);
  view.scene.add(view.diceRoot);

  buildBoardGeometry();
}

function buildBoardGeometry() {
  view.boardRoot.clear();
  view.zoneObjects.clear();

  const table = new THREE.Mesh(
    new THREE.CylinderGeometry(12, 12.8, 0.9, 48),
    new THREE.MeshStandardMaterial({ color: 0x6e4021, roughness: 0.92, metalness: 0.05 })
  );
  table.position.y = -0.8;
  view.boardRoot.add(table);

  const felt = new THREE.Mesh(
    new THREE.CylinderGeometry(10.8, 10.8, 0.24, 48),
    new THREE.MeshStandardMaterial({ color: 0x4b2f1d, roughness: 0.96, metalness: 0.02 })
  );
  felt.position.y = -0.18;
  view.boardRoot.add(felt);

  const centerHex = new THREE.Mesh(
    new THREE.CylinderGeometry(3.7, 3.7, 0.22, 6),
    new THREE.MeshStandardMaterial({ color: 0xc8984f, roughness: 0.82, metalness: 0.15 })
  );
  centerHex.rotation.y = Math.PI / 6;
  centerHex.position.y = -0.01;
  centerHex.userData.interaction = "roll-zone";
  view.boardRoot.add(centerHex);
  view.centerHitMesh = centerHex;

  const centerInset = new THREE.Mesh(
    new THREE.CylinderGeometry(3.05, 3.05, 0.16, 6),
    new THREE.MeshStandardMaterial({ color: 0x5d4129, roughness: 0.95, metalness: 0.04 })
  );
  centerInset.rotation.y = Math.PI / 6;
  centerInset.position.y = 0.12;
  view.boardRoot.add(centerInset);

  ZONES.forEach((zone, index) => {
    const zoneGroup = new THREE.Group();
    const angle = (Math.PI / 3) * index - Math.PI / 2;
    const radius = 6.6;
    zoneGroup.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    zoneGroup.rotation.y = -angle;

    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 0.45, 2.3),
      new THREE.MeshStandardMaterial({ color: zone.color, roughness: 0.82, metalness: 0.08 })
    );
    shell.scale.z = 0.95;
    shell.position.y = 0.12;
    zoneGroup.add(shell);

    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(2.72, 0.18, 1.82),
      new THREE.MeshStandardMaterial({ color: 0xf8efd9, roughness: 0.96, metalness: 0.04 })
    );
    plate.position.y = 0.43;
    zoneGroup.add(plate);

    const accents = new THREE.Mesh(
      new THREE.BoxGeometry(2.94, 0.08, 2.04),
      new THREE.MeshStandardMaterial({
        color: zone.type === "game" ? 0xf6cf9a : 0xb4e2dc,
        transparent: true,
        opacity: 0.68,
        roughness: 0.8,
      })
    );
    accents.position.y = 0.26;
    zoneGroup.add(accents);

    const markerGroup = new THREE.Group();
    zoneGroup.add(markerGroup);

    view.zoneObjects.set(zone.id, { zoneGroup, markerGroup });
    view.boardRoot.add(zoneGroup);
  });
}

function startNewGame(playerCount) {
  if (!canManageRoomLocally()) return;
  els.playerCount.value = String(playerCount);
  const persistedNames = loadPersistedPlayerNames();
  const existingNames = state.players.map((player) => player.name);
  state.players = Array.from({ length: playerCount }, (_, index) => ({
    id: index + 1,
    name: persistedNames[index] || getDefaultPlayerName(index + 1),
    color: PLAYER_COLORS[index],
    diceRemaining: 8,
    rerollTokens: 2,
    money: 0,
    placements: Object.fromEntries(ZONES.map((zone) => [zone.id, 0])),
  }));
  state.players.forEach((player, index) => {
    player.name = existingNames[index] || player.name;
  });
  state.seatClaims = Object.fromEntries(
    Object.entries(state.seatClaims).filter(([playerId]) => Number(playerId) <= playerCount)
  );
  state.neutralPlacements = Object.fromEntries(ZONES.map((zone) => [zone.id, 0]));
  state.pollutionPiles = POLLUTION_PILES.map((count, index) => ({
    id: index + 1,
    count,
    used: false,
  }));
  state.currentPlayerIndex = 0;
  state.roll = [];
  state.rollCounts = {};
  state.hasRolled = false;
  state.isRolling = false;
  state.gameOver = false;
  state.modal = null;
  state.log = [];
  clearDiceScene();
  persistPlayerNames();
  addLog("游戏开始", `本局共有 ${playerCount} 名玩家，每位玩家拥有 8 枚骰子。`);
  closeModal(true);
  render();
}

function requestIntent(type, payload = {}) {
  const intent = { type, participantId: getLocalActorId(), ...payload };
  if (!network.roomId || network.isHost) {
    return handleIntent(intent, getLocalActorId());
  }
  if (!network.sendIntent) return null;
  return network.sendIntent(intent);
}

async function handleIntent(intent, actorId) {
  switch (intent.type) {
    case "claimSeat":
      claimSeatForActor(actorId, intent.playerId, intent.name);
      break;
    case "releaseSeat":
      releaseSeatForActor(actorId, intent.playerId);
      break;
    case "renamePlayer":
      applyPlayerNameChange(actorId, intent.playerId, intent.name);
      break;
    case "roll":
      await handleRoll(actorId);
      break;
    case "reroll":
      await handleReroll(actorId);
      break;
    case "placeDice":
      placeDice(intent.faceValue, actorId);
      break;
    case "game1Pollution":
      applyGame1PollutionFixed(intent.pileIndex, intent.zoneId, actorId);
      break;
    case "game2Guess":
      await resolveGame2Guess(intent.guess, actorId);
      break;
    case "game2Cashout":
      resolveGame2Cashout(actorId);
      break;
    case "game3Predict":
      await resolveGame3Predict(intent.guess, actorId);
      break;
    case "game3Leave":
      resolveGame3Leave(actorId);
      break;
    default:
      break;
  }
}

function claimSeatForActor(actorId, playerId) {
  if (!network.roomId || !actorId) return;
  const player = state.players.find((item) => item.id === playerId);
  if (!player) return;
  const owner = state.seatClaims[playerId];
  if (owner && owner !== actorId) return;
  const currentSeat = getClaimedSeatForActor(actorId);
  if (currentSeat && currentSeat.id !== playerId) {
    currentSeat.name = getDefaultPlayerName(currentSeat.id);
    delete state.seatClaims[currentSeat.id];
  }
  state.seatClaims[playerId] = actorId;
  if (arguments.length > 2) {
    const seatName = arguments[2];
    player.name = normalizeSeatName(seatName, playerId);
  }
  persistPlayerNames();
  render();
}

function releaseSeatForActor(actorId, playerId) {
  if (!network.roomId || !actorId) return;
  if (state.seatClaims[playerId] !== actorId) return;
  const player = state.players.find((item) => item.id === playerId);
  if (player) {
    player.name = getDefaultPlayerName(playerId);
  }
  delete state.seatClaims[playerId];
  persistPlayerNames();
  render();
}

function releaseSeatClaimsForParticipant(actorId) {
  const entries = Object.entries(state.seatClaims).filter(([, owner]) => owner === actorId);
  if (!entries.length) return;
  entries.forEach(([playerId]) => {
    const player = state.players.find((item) => item.id === Number(playerId));
    if (player) {
      player.name = getDefaultPlayerName(player.id);
    }
    delete state.seatClaims[playerId];
  });
  persistPlayerNames();
  render();
}

function applyPlayerNameChange(actorId, playerId, value) {
  const player = state.players.find((item) => item.id === playerId);
  if (!player) return;
  if (network.roomId && state.seatClaims[playerId] !== actorId) return;
  const nextName = normalizeSeatName(value, playerId);
  player.name = nextName;
  persistPlayerNames();
  render();
}

async function handleRoll(actorId = getLocalActorId()) {
  if (!canActOnCurrentTurn(actorId)) return;
  if (state.gameOver || state.modal || state.isRolling) return;
  const player = getCurrentPlayer();
  if (!player || player.diceRemaining <= 0 || state.hasRolled) return;

  state.isRolling = true;
  state.roll = Array.from({ length: player.diceRemaining }, () => randomInt(1, 6));
  state.rollCounts = {};
  spawnRollingDice(state.roll);
  render();

  await wait(1100);

  settleDice(state.roll);
  state.rollCounts = countValues(state.roll);
  state.hasRolled = true;
  state.isRolling = false;
  addLog(player.name, `掷出了 ${state.roll.join("、")}。`);
  render();
}

async function handleReroll(actorId = getLocalActorId()) {
  if (!canActOnCurrentTurn(actorId)) return;
  if (state.gameOver || state.modal || state.isRolling || !state.hasRolled) return;
  const player = getCurrentPlayer();
  if (!player || player.diceRemaining <= 0 || (player.rerollTokens || 0) <= 0) return;

  player.rerollTokens -= 1;
  state.isRolling = true;
  state.roll = Array.from({ length: player.diceRemaining }, () => randomInt(1, 6));
  state.rollCounts = {};
  spawnRollingDice(state.roll);
  addLog(player.name, `消耗 1 个重摇筹码，剩余 ${player.rerollTokens} 个。`);
  render();

  await wait(1100);

  settleDice(state.roll);
  state.rollCounts = countValues(state.roll);
  state.hasRolled = true;
  state.isRolling = false;
  addLog(player.name, `重摇结果：${state.roll.join("、")}。`);
  render();
}

function placeDice(faceValue, actorId = getLocalActorId()) {
  if (!canActOnCurrentTurn(actorId)) return;
  if (state.modal || state.isRolling || !state.hasRolled || state.gameOver) return;
  const player = getCurrentPlayer();
  const count = state.rollCounts[faceValue];
  if (!count) return;

  player.placements[faceValue] += count;
  player.diceRemaining -= count;
  addLog(player.name, `将 ${count} 枚 ${faceValue} 点骰子放入 ${ZONES[faceValue - 1].name}。`);

  state.roll = [];
  state.rollCounts = {};
  state.hasRolled = false;
  clearDiceScene();
  render();

  if (faceValue <= 3) {
    openMiniGame(faceValue, player.id);
    return;
  }

  advanceTurn();
}

function advanceTurn() {
  if (state.players.every((player) => player.diceRemaining === 0)) {
    finalizeGame();
    return;
  }

  let nextIndex = state.currentPlayerIndex;
  do {
    nextIndex = (nextIndex + 1) % state.players.length;
  } while (state.players[nextIndex].diceRemaining === 0);

  state.currentPlayerIndex = nextIndex;
  render();
}

function finalizeGame() {
  const summary = [];
  ZONES.forEach((zone) => {
    getZoneRanking(zone.id).slice(0, 2).forEach((entry, index) => {
      const reward = zone.rewards[index];
      entry.player.money += reward;
      summary.push(`${zone.name}：${entry.player.name} 获得 ${formatMoney(reward)}`);
    });
  });

  state.players.forEach((player) => {
    const rerollBonus = (player.rerollTokens || 0) * 10000;
    if (rerollBonus <= 0) return;
    player.money += rerollBonus;
    summary.push(`${player.name} 的剩余重摇筹码兑换 ${formatMoney(rerollBonus)}`);
  });

  state.gameOver = true;
  addLog("结算完成", summary.length ? summary.join("；") : "没有产生有效区域奖励。");
  render();
  showSettlement();
}

function getZoneRanking(zoneId) {
  const grouped = new Map();
  state.players.forEach((player) => {
    const count = player.placements[zoneId];
    if (!count) return;
    if (!grouped.has(count)) grouped.set(count, []);
    grouped.get(count).push({ type: "player", player });
  });

  const neutralCount = Number(state.neutralPlacements[zoneId] || 0);
  if (neutralCount > 0) {
    if (!grouped.has(neutralCount)) grouped.set(neutralCount, []);
    grouped.get(neutralCount).push({ type: "neutral", id: `neutral-${zoneId}`, count: neutralCount });
  }

  return [...grouped.entries()]
    .filter(([, entries]) => entries.length === 1 && entries[0].type === "player")
    .sort((a, b) => b[0] - a[0])
    .map(([count, entries]) => ({ count, player: entries[0].player }));
}

function openMiniGame(gameId, playerId) {
  const player = state.players.find((item) => item.id === playerId);
  if (!player) return;

  if (gameId === 1) {
    state.modal = { type: "game1", playerId, allowClose: false, draggedPileIndex: null };
    renderGame1(player);
    return;
  }

  if (gameId === 2) {
    state.modal = { type: "game2", playerId, progress: 0, earned: 0, resolved: false, allowClose: false, animating: false, lastFlipResult: "", coinAngle: 0, coinTargetAngle: 0 };
    renderGame2(player);
    return;
  }

  const initialRoll = [randomInt(1, 6), randomInt(1, 6)];
  state.modal = {
    type: "game3",
    playerId,
    step: 0,
    lastTotal: null,
    earned: 0,
    resolved: false,
    allowClose: false,
    animating: true,
    previewRoll: [randomInt(1, 6), randomInt(1, 6)],
    lastOutcomeText: "正在投掷初始双骰，建立基准点数...",
    diceSpin: 0,
    initialRoll,
    initialRevealDone: false,
  };
  renderGame3(player);
  window.setTimeout(() => {
    if (!state.modal || state.modal.type !== "game3") return;
    state.modal.previewRoll = initialRoll;
    state.modal.lastTotal = initialRoll[0] + initialRoll[1];
    state.modal.animating = false;
    state.modal.initialRevealDone = true;
    state.modal.lastOutcomeText = `初始点数 ${initialRoll[0]} + ${initialRoll[1]} = ${state.modal.lastTotal}`;
    renderGame3(player);
  }, 1100);
}

function renderGame1(player) {
  destroyMiniGameThreeScene();
  destroyGame1BoardOverlay();
  destroyGame1PileScenes();
  cleanupGame1Drag();
  els.modalTitle.textContent = "游戏1：污染区域";
  els.modalBody.innerHTML = `
    <div class="minigame-stack game1-modal">
      <div class="pollution-piles pure-piles">
        ${POLLUTION_PILES.map((count, pileIndex) => `
          <div class="draggable-pile pile-three-card" data-pile="${pileIndex}">
            <div class="pile-three-mount" data-pile-three="${pileIndex}" data-pile-count="${count}"></div>
            <div class="pile-count-badge">${count}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  openModal();
  createGame1BoardOverlay();

  els.modalBody.querySelectorAll(".draggable-pile").forEach((pile) => {
    if (!canActOnCurrentTurn()) {
      pile.classList.add("disabled");
      return;
    }
    pile.addEventListener("pointerdown", (event) => {
      startGame1Drag(event, player, Number(pile.dataset.pile), pile);
    });
  });
  window.requestAnimationFrame(() => {
    if (!state.modal || state.modal.type !== "game1") return;
    setupGame1PileScenes();
  });
  maybeBroadcastState();
}

function applyGame1PollutionFixed(pileIndex, zoneId, actorId = getLocalActorId()) {
  if (!canActOnCurrentTurn(actorId)) return;
  const player = getCurrentPlayer();
  if (!player || !state.modal || state.modal.type !== "game1") return;
  const count = POLLUTION_PILES[pileIndex];
  if (!Number.isFinite(count)) return;
  state.neutralPlacements[zoneId] = Number(state.neutralPlacements[zoneId] || 0) + count;
  addLog(player.name, `在游戏1中把 ${count} 枚无效骰子拖入 ${ZONES[zoneId - 1].name}。`);
  closeModal();
  advanceTurn();
}

function renderGame2(player) {
  const { progress, earned, resolved, animating, lastFlipResult } = state.modal;
  els.modalTitle.textContent = "游戏2：硬币猜正反";
  els.modalBody.innerHTML = `
    <div class="minigame-stack">
      <p>${player.name} 最多可以猜 3 次。每次猜中获得 <span class="highlight-value">${formatMoney(20000)}</span>，猜错后本轮小游戏奖励清零。</p>
      <div class="coin-stage">
        <div id="miniThreeMount" class="mini-three-stage coin-three-stage"></div>
        <div class="coin-status">${animating ? "硬币正在空中翻转..." : lastFlipResult ? `上一投结果：${lastFlipResult}` : "等待选择正反"}</div>
      </div>
      <div class="status-pill">已成功 ${progress} / 3 次，当前可结算 ${formatMoney(earned)}</div>
      <div class="modal-actions">
        <button class="option-btn" data-action="coin" data-guess="heads" ${resolved || progress >= 3 || animating || !canControlGameLocally() ? "disabled" : ""}>猜正</button>
        <button class="option-btn" data-action="coin" data-guess="tails" ${resolved || progress >= 3 || animating || !canControlGameLocally() ? "disabled" : ""}>猜反</button>
        <button class="primary-btn" data-action="cashout" ${animating || !canControlGameLocally() ? "disabled" : ""}>${earned > 0 ? `带走 ${formatMoney(earned)}` : "结束小游戏"}</button>
      </div>
    </div>
  `;

  els.modalBody.querySelectorAll("[data-action='coin']").forEach((button) => {
    button.addEventListener("click", async () => {
      if (state.modal.animating) return;
      if (network.roomId && !network.isHost) {
        requestIntent("game2Guess", { guess: button.dataset.guess });
        return;
      }
      const guess = button.dataset.guess;
      const result = Math.random() < 0.5 ? "heads" : "tails";
      state.modal.animating = true;
      state.modal.lastFlipResult = "";
      state.modal.coinTargetAngle += Math.PI * 8 + (result === "heads" ? 0 : Math.PI);
      renderGame2(player);
      await wait(1200);
      state.modal.animating = false;
      state.modal.lastFlipResult = result === "heads" ? "正" : "反";
      state.modal.coinAngle = state.modal.coinTargetAngle;
      if (guess === result) {
        state.modal.progress += 1;
        state.modal.earned += 20000;
        addLog(player.name, `游戏2 猜中了${result === "heads" ? "正" : "反"}，当前可得 ${formatMoney(state.modal.earned)}。`);
      } else {
        state.modal.earned = 0;
        state.modal.resolved = true;
        addLog(player.name, "游戏2 猜错了，当前奖励清零。");
      }

      if (state.modal.progress >= 3) state.modal.resolved = true;
      renderGame2(player);
    });
  });

  els.modalBody.querySelector("[data-action='cashout']").addEventListener("click", () => {
    if (network.roomId && !network.isHost) {
      requestIntent("game2Cashout");
      return;
    }
    player.money += state.modal.earned;
    if (state.modal.earned > 0) addLog(player.name, `在游戏2中结算了 ${formatMoney(state.modal.earned)}。`);
    closeModal();
    advanceTurn();
  });

  setupMiniGameThreeScene("coin");
  openModal();
  maybeBroadcastState();
}

function renderGame3(player) {
  const { step, lastTotal, earned, resolved, animating, previewRoll = [1, 1], lastOutcomeText = "", initialRevealDone } = state.modal;
  els.modalTitle.textContent = "游戏3：大小预估";
  els.modalBody.innerHTML = `
    <div class="minigame-stack">
      <p>${player.name} 需要判断下一次两枚骰子的总和，比当前总和更大还是更小。猜对就进入下一关，最多 6 关，可随时退出。</p>
      <div class="duel-dice-stage">
        <div id="miniThreeMount" class="mini-three-stage dice-three-stage"></div>
        <div class="coin-status">${animating ? "双骰正在滚动..." : lastOutcomeText || "等待选择更大或更小"}</div>
      </div>
      <div class="status-pill">当前基准点数 ${initialRevealDone ? lastTotal : "生成中..."}，已解锁奖励 ${formatMoney(earned)}</div>
      <div class="progress-row">
        <strong>6 关奖励</strong>
        <span>${GAME3_REWARDS.map((reward, index) => `${formatMoney(reward)}`).join(" / ")}</span>
      </div>
      <div class="modal-actions">
        <button class="option-btn" data-action="predict" data-guess="higher" ${resolved || step >= GAME3_REWARDS.length || animating || !initialRevealDone || !canControlGameLocally() ? "disabled" : ""}>猜更大</button>
        <button class="option-btn" data-action="predict" data-guess="same" ${resolved || step >= GAME3_REWARDS.length || animating || !initialRevealDone || !canControlGameLocally() ? "disabled" : ""}>猜相等</button>
        <button class="option-btn" data-action="predict" data-guess="lower" ${resolved || step >= GAME3_REWARDS.length || animating || !initialRevealDone || !canControlGameLocally() ? "disabled" : ""}>猜更小</button>
        <button class="primary-btn" data-action="leave" ${(animating && !initialRevealDone) || !canControlGameLocally() ? "disabled" : ""}>${earned > 0 ? `带走 ${formatMoney(earned)}` : "退出小游戏"}</button>
      </div>
    </div>
  `;

  els.modalBody.querySelectorAll("[data-action='predict']").forEach((button) => {
    button.addEventListener("click", async () => {
      if (state.modal.animating) return;
      if (network.roomId && !network.isHost) {
        requestIntent("game3Predict", { guess: button.dataset.guess });
        return;
      }
      const guess = button.dataset.guess;
      state.modal.animating = true;
      state.modal.lastOutcomeText = "";
      state.modal.previewRoll = [randomInt(1, 6), randomInt(1, 6)];
      state.modal.diceSpin = 0;
      renderGame3(player);
      await wait(1000);
      const nextRoll = [randomInt(1, 6), randomInt(1, 6)];
      const nextTotal = nextRoll[0] + nextRoll[1];
      const isCorrect = guess === "higher"
        ? nextTotal > state.modal.lastTotal
        : guess === "lower"
          ? nextTotal < state.modal.lastTotal
          : nextTotal === state.modal.lastTotal;
      state.modal.animating = false;
      state.modal.previewRoll = nextRoll;
      state.modal.lastOutcomeText = `本次点数 ${nextRoll[0]} + ${nextRoll[1]} = ${nextTotal}`;

      if (isCorrect) {
        state.modal.earned = GAME3_REWARDS[state.modal.step];
        state.modal.step += 1;
        addLog(player.name, `游戏3 猜对了，点数从 ${state.modal.lastTotal} 变为 ${nextTotal}，当前奖励 ${formatMoney(state.modal.earned)}。`);
      } else {
        state.modal.earned = 0;
        state.modal.resolved = true;
        addLog(player.name, `游戏3 猜错了，点数从 ${state.modal.lastTotal} 变为 ${nextTotal}。`);
      }

      state.modal.lastTotal = nextTotal;
      if (state.modal.step >= GAME3_REWARDS.length) state.modal.resolved = true;
      renderGame3(player);
    });
  });

  els.modalBody.querySelector("[data-action='leave']").addEventListener("click", () => {
    if (network.roomId && !network.isHost) {
      requestIntent("game3Leave");
      return;
    }
    player.money += state.modal.earned;
    if (state.modal.earned > 0) addLog(player.name, `在游戏3中结算了 ${formatMoney(state.modal.earned)}。`);
    closeModal();
    advanceTurn();
  });

  setupMiniGameThreeScene("dice");
  openModal();
  maybeBroadcastState();
}

async function resolveGame2Guess(guess, actorId = getLocalActorId()) {
  if (!canActOnCurrentTurn(actorId)) return;
  const player = getCurrentPlayer();
  if (!player || !state.modal || state.modal.type !== "game2" || state.modal.animating || state.modal.resolved) return;

  const result = Math.random() < 0.5 ? "heads" : "tails";
  state.modal.animating = true;
  state.modal.lastFlipResult = "";
  state.modal.coinTargetAngle += Math.PI * 8 + (result === "heads" ? 0 : Math.PI);
  renderGame2(player);
  await wait(1200);

  if (!state.modal || state.modal.type !== "game2") return;
  state.modal.animating = false;
  state.modal.lastFlipResult = result === "heads" ? "正" : "反";
  state.modal.coinAngle = state.modal.coinTargetAngle;
  if (guess === result) {
    state.modal.progress += 1;
    state.modal.earned += 20000;
    addLog(player.name, `Game2 guessed ${result}, bank ${formatMoney(state.modal.earned)}`);
  } else {
    state.modal.earned = 0;
    state.modal.resolved = true;
    addLog(player.name, "Game2 failed and reward reset.");
  }

  if (state.modal.progress >= 3) state.modal.resolved = true;
  renderGame2(player);
}

function resolveGame2Cashout(actorId = getLocalActorId()) {
  if (!canActOnCurrentTurn(actorId)) return;
  const player = getCurrentPlayer();
  if (!player || !state.modal || state.modal.type !== "game2" || state.modal.animating) return;
  player.money += state.modal.earned;
  if (state.modal.earned > 0) addLog(player.name, `Game2 cashout ${formatMoney(state.modal.earned)}`);
  closeModal();
  advanceTurn();
}

async function resolveGame3Predict(guess, actorId = getLocalActorId()) {
  if (!canActOnCurrentTurn(actorId)) return;
  const player = getCurrentPlayer();
  if (!player || !state.modal || state.modal.type !== "game3" || state.modal.animating || !state.modal.initialRevealDone || state.modal.resolved) return;

  state.modal.animating = true;
  state.modal.lastOutcomeText = "";
  state.modal.previewRoll = [randomInt(1, 6), randomInt(1, 6)];
  state.modal.diceSpin = 0;
  renderGame3(player);
  await wait(1000);

  if (!state.modal || state.modal.type !== "game3") return;
  const nextRoll = [randomInt(1, 6), randomInt(1, 6)];
  const nextTotal = nextRoll[0] + nextRoll[1];
  const isCorrect = guess === "higher"
    ? nextTotal > state.modal.lastTotal
    : guess === "lower"
      ? nextTotal < state.modal.lastTotal
      : nextTotal === state.modal.lastTotal;
  state.modal.animating = false;
  state.modal.previewRoll = nextRoll;
  state.modal.lastOutcomeText = `鏈鐐规暟 ${nextRoll[0]} + ${nextRoll[1]} = ${nextTotal}`;

  if (isCorrect) {
    state.modal.earned = GAME3_REWARDS[state.modal.step];
    state.modal.step += 1;
    addLog(player.name, `Game3 cleared a stage, reward ${formatMoney(state.modal.earned)}`);
  } else {
    state.modal.earned = 0;
    state.modal.resolved = true;
    addLog(player.name, "Game3 failed.");
  }

  state.modal.lastTotal = nextTotal;
  if (state.modal.step >= GAME3_REWARDS.length) state.modal.resolved = true;
  renderGame3(player);
}

function resolveGame3Leave(actorId = getLocalActorId()) {
  if (!canActOnCurrentTurn(actorId)) return;
  const player = getCurrentPlayer();
  if (!player || !state.modal || state.modal.type !== "game3") return;
  player.money += state.modal.earned;
  if (state.modal.earned > 0) addLog(player.name, `Game3 cashout ${formatMoney(state.modal.earned)}`);
  closeModal();
  advanceTurn();
}

function showSettlement() {
  const ranking = [...state.players].sort((a, b) => b.money - a.money);
  state.modal = { type: "settlement", allowClose: true };
  els.modalTitle.textContent = "最终结算";
  els.modalBody.innerHTML = `
    <div class="minigame-stack">
      <p>所有玩家已经没有剩余骰子，下面是本局最终奖金排名。</p>
      ${ranking.map((player, index) => `
        <div class="player-card">
          <div class="player-head">
            <strong style="color:${player.color}">${index + 1}. ${player.name}</strong>
            <span class="money">${formatMoney(player.money)}</span>
          </div>
          <div class="player-meta">
            <div class="meta-chip">剩余骰子 ${player.diceRemaining}</div>
            <div class="meta-chip">总放置 ${sumPlacements(player)} 枚</div>
          </div>
        </div>
      `).join("")}
      <div class="modal-actions">
        <button id="restartFromResult" class="primary-btn">再来一局</button>
      </div>
    </div>
  `;
  openModal();
  maybeBroadcastState();

  document.getElementById("restartFromResult").addEventListener("click", () => {
    if (!canManageRoomLocally()) return;
    closeModal();
    startNewGame(Number(els.playerCount.value));
  });
}

function showRulesModal() {
  state.modal = { type: "rules", allowClose: true };
  els.modal.classList.add("rules-modal");
  els.modalTitle.textContent = "游戏规则";
  els.modalBody.innerHTML = `
    <div class="minigame-stack">
      <div class="player-card">
        <div class="player-head"><strong>人数与目标</strong></div>
        <div class="player-meta">
          <div class="meta-chip">支持 2 到 6 名玩家。</div>
          <div class="meta-chip">每位玩家初始拥有 8 枚基础骰子与 2 个重摇筹码。</div>
          <div class="meta-chip">所有玩家骰子用尽后，按区域奖励与剩余筹码兑换金额结算。</div>
        </div>
      </div>
      <div class="player-card">
        <div class="player-head"><strong>回合流程</strong></div>
        <div class="player-meta">
          <div class="meta-chip">轮到自己时点击桌面中央六边形投掷全部剩余骰子。</div>
          <div class="meta-chip">若不满意本次结果，可消耗 1 个重摇筹码重新掷当前剩余骰子。</div>
          <div class="meta-chip">每回合只能选择一个点数，该点数的全部骰子必须一起放入对应区域。</div>
        </div>
      </div>
      <div class="player-card">
        <div class="player-head"><strong>唯一数量规则</strong></div>
        <div class="player-meta">
          <div class="meta-chip">每个区域只认数量唯一的对象。</div>
          <div class="meta-chip">若多个对象数量相同，则这些数量全部作废。</div>
          <div class="meta-chip">最终按有效数量从大到小决定第一名与第二名奖励。</div>
        </div>
      </div>
      <div class="player-card">
        <div class="player-head"><strong>区域奖励</strong></div>
        <div class="player-meta">
          <div class="meta-chip">1 点 浑水摸鱼：40000 / 40000</div>
          <div class="meta-chip">2 点 猜正反：50000 / 30000</div>
          <div class="meta-chip">3 点 猜大小：50000 / 30000</div>
          <div class="meta-chip">4 点 基础区：90000 / 40000</div>
          <div class="meta-chip">5 点 基础区：80000 / 30000</div>
          <div class="meta-chip">6 点 基础区：50000 / 50000</div>
        </div>
      </div>
      <div class="player-card">
        <div class="player-head"><strong>小游戏</strong></div>
        <div class="player-meta">
          <div class="meta-chip">浑水摸鱼：从 [2,2,3,1,1,2] 中选择一堆干扰骰子拖入任意区域。干扰骰子归为虚拟对象“干扰骰子”，只参与数量冲突判定，不参与最终排名和奖励结算。</div>
          <div class="meta-chip">猜正反：最多猜 3 次，每次猜中获得 20000，猜错则当前小游戏奖励清零，可随时离场结算。</div>
          <div class="meta-chip">猜大小：可猜更大、更小或相同。奖励顺序为 [5000, 80000, 15000, 30000, 50000, 80000]，可随时退出结算。</div>
        </div>
      </div>
      <div class="player-card">
        <div class="player-head"><strong>重摇筹码结算</strong></div>
        <div class="player-meta">
          <div class="meta-chip">每个未使用的重摇筹码在对局结束时可兑换 10000。</div>
        </div>
      </div>
    </div>
  `;
  openModal();
}

function render() {
  const shouldHighlightBoard = Boolean(
    els.boardRollPulse &&
    canControlGameLocally() &&
    !state.gameOver &&
    !state.modal &&
    !state.isRolling &&
    !state.hasRolled &&
    getCurrentPlayer() &&
    getCurrentPlayer().diceRemaining > 0
  );
  els.boardRollPulse?.classList.toggle("active", shouldHighlightBoard);
  syncCenterDiceSceneWithState();
  renderTopMeta();
  renderRollArea();
  renderPlayers();
  renderLog();
  renderZoneMarkersEnhanced();
  renderZoneInfoOverlayEnhanced();
  renderModalFromState();
  els.newGameBtn.disabled = network.roomId && !network.isHost;
  els.playerCount.disabled = network.roomId && !network.isHost;
  if (els.rollBtn) {
    els.rollBtn.disabled = !canControlGameLocally() || state.gameOver || state.isRolling || state.hasRolled || !!state.modal || !getCurrentPlayer() || getCurrentPlayer().diceRemaining <= 0;
    els.rollBtn.textContent = state.isRolling ? "投掷中..." : "投掷骰子";
  }
  maybeBroadcastState();
}

function renderModalFromState() {
  if (!state.modal) {
    destroyMiniGameThreeScene();
    destroyGame1BoardOverlay();
    destroyGame1PileScenes();
    cleanupGame1Drag();
    els.modal.classList.remove("rules-modal");
    els.modal.classList.add("hidden");
    els.modal.setAttribute("aria-hidden", "true");
    return;
  }

  if (state.modal.type === "game1") {
    const player = state.players.find((item) => item.id === state.modal.playerId);
    if (player) renderGame1(player);
    return;
  }

  destroyGame1BoardOverlay();
  destroyGame1PileScenes();
  cleanupGame1Drag();

  if (state.modal.type === "game2") {
    const player = state.players.find((item) => item.id === state.modal.playerId);
    if (player) renderGame2(player);
    return;
  }

  if (state.modal.type === "game3") {
    const player = state.players.find((item) => item.id === state.modal.playerId);
    if (player) renderGame3(player);
    return;
  }

  if (state.modal.type === "settlement") {
    showSettlement();
    return;
  }

  if (state.modal.type === "rules") {
    showRulesModal();
  }
}

function renderZoneInfoOverlayFixed() {
  const positions = [
    { left: "50%", top: "12%" },
    { left: "79%", top: "31%" },
    { left: "79%", top: "69%" },
    { left: "50%", top: "88%" },
    { left: "21%", top: "69%" },
    { left: "21%", top: "31%" },
  ];

  els.zoneInfoOverlay.innerHTML = ZONES.map((zone, index) => {
    const players = state.players
      .filter((player) => player.placements[zone.id] > 0)
      .sort((a, b) => b.placements[zone.id] - a.placements[zone.id]);
    const rankingIds = new Set(getZoneRanking(zone.id).map((entry) => entry.player.id));

    return `
      <div class="zone-info-card ${index === 1 || index === 2 ? "zone-info-card--flip" : ""}" style="left:${positions[index].left}; top:${positions[index].top};">
        <div class="zone-info-title">${zone.id}点 ${zone.name}</div>
        <div class="zone-reward-line">
          <span>第1名 ${formatMoney(zone.rewards[0])}</span>
          <span>第2名 ${formatMoney(zone.rewards[1])}</span>
        </div>
        <div class="zone-info-list">
          ${players.length ? players.map((player) => `
            <div class="zone-info-row ${rankingIds.has(player.id) ? "valid" : "invalid"}">
              <span class="zone-player-dot" style="background:${player.color}"></span>
              <strong style="color:${player.color}">${player.name}</strong>
              <span>${player.placements[zone.id]} 枚</span>
            </div>
          `).join("") : '<div class="zone-info-empty">暂无放置</div>'}
        </div>
      </div>
    `;
  }).join("");
}

function renderTopMeta() {
  const player = getCurrentPlayer();
  els.currentPlayerName.textContent = state.gameOver ? "游戏结束" : player ? player.name : "-";
  els.roundInfo.textContent = `${getRoundNumber()} / 8`;
  els.diceLeftInfo.textContent = player ? `${player.diceRemaining} 枚` : "-";
}

function renderRollArea() {
  updateBoardActionButton();
  if (els.boardActionHint) {
    if (state.isRolling) {
      els.boardActionHint.textContent = "骰子正在中央区域翻滚...";
      return;
    }

    if (!state.hasRolled) {
      if (state.gameOver) {
        els.boardActionHint.textContent = "本局已结束，可开始新游戏。";
        return;
      }
      if (!canControlGameLocally()) {
        els.boardActionHint.textContent = network.roomId ? "当前不是你的操作回合。" : "等待当前玩家操作。";
        return;
      }
      els.boardActionHint.textContent = "点击中央六边形区域投掷骰子。";
      return;
    }

    const options = Object.entries(state.rollCounts)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([faceValue, count]) => `${faceValue}点×${count}`)
      .join(" / ");
    els.boardActionHint.textContent = `点击中央骰子实体来决定放置结果。当前可选：${options}`;
    return;
  }

  if (state.isRolling) {
    els.rollHint.textContent = "3D 骰子正在中央区域滚动，镜头保持俯视锁定。";
    els.groupOptions.innerHTML = "";
    return;
  }

  if (!state.hasRolled) {
    els.rollHint.textContent = state.gameOver ? "本局已结束，可直接开始新游戏。" : "点击“投掷骰子”开始当前玩家回合。";
    els.groupOptions.innerHTML = "";
    return;
  }

  const options = Object.entries(state.rollCounts).sort((a, b) => Number(a[0]) - Number(b[0]));
  els.rollHint.textContent = "每回合只能选择一个点数，该点数的所有骰子会一起进入对应放置区。";
  els.groupOptions.innerHTML = options.map(([faceValue, count]) => `
    <div class="group-option">
      <div>
        <strong>${faceValue} 点</strong>
        <span>共 ${count} 枚，将进入 ${ZONES[Number(faceValue) - 1].name}</span>
      </div>
      <button class="option-btn" data-place="${faceValue}" ${!canControlGameLocally() ? "disabled" : ""}>放置这组骰子</button>
    </div>
  `).join("");

  els.groupOptions.querySelectorAll("[data-place]").forEach((button) => {
    button.addEventListener("click", () => requestIntent("placeDice", { faceValue: Number(button.dataset.place) }));
  });
}

function renderPlayers() {
  els.playersPanel.innerHTML = state.players.map((player, index) => `
    <div class="player-card ${index === state.currentPlayerIndex && !state.gameOver ? "active" : ""}">
      <div class="player-head">
        <div class="player-name-editor">
          <label class="sr-only" for="playerName-${player.id}">玩家姓名</label>
          <input
            id="playerName-${player.id}"
            class="player-name-input"
            type="text"
            maxlength="20"
            value="${escapeHtml(player.name)}"
            data-player-id="${player.id}"
            style="color:${player.color}"
            ${!canEditPlayerNameLocally(player.id) ? "disabled" : ""}
          >
        </div>
        <span class="money">${formatMoney(player.money)}</span>
      </div>
      <div class="player-meta">
        <div class="meta-chip">剩余 ${player.diceRemaining} 枚</div>
        <div class="meta-chip">已放置 ${sumPlacements(player)} 枚</div>
      </div>
    </div>
  `).join("");

  els.playersPanel.querySelectorAll(".player-name-input").forEach((input) => {
    input.addEventListener("change", () => updatePlayerName(Number(input.dataset.playerId), input.value));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        input.blur();
      }
    });
  });

  [...els.playersPanel.querySelectorAll(".player-card")].forEach((card, index) => {
    const player = state.players[index];
    const metaRow = card.querySelector(".player-meta");
    if (!metaRow) return;
    const chip = document.createElement("div");
    chip.className = "meta-chip reroll-chip";
    chip.textContent = `重摇筹码 ${player.rerollTokens || 0}`;
    metaRow.appendChild(chip);
  });

  if (!network.roomId) return;

  const localSeat = getLocalClaimedSeat();
  [...els.playersPanel.querySelectorAll(".player-card")].forEach((card, index) => {
    const player = state.players[index];
    const metaRow = card.querySelector(".player-meta");
    if (metaRow && !card.querySelector(".reroll-chip")) {
      const chip = document.createElement("div");
      chip.className = "meta-chip";
      chip.textContent = `重摇筹码 ${player.rerollTokens || 0}`;
      metaRow.appendChild(chip);
    }
    const owner = state.seatClaims[player.id];
    const ownedByMe = owner === getLocalActorId();
    const occupied = Boolean(owner);
    const canClaim = (!localSeat || ownedByMe) && (!occupied || ownedByMe);
    const seatRow = document.createElement("div");
    seatRow.className = "seat-row";
    seatRow.innerHTML = `
      <span class="seat-badge ${ownedByMe ? "mine" : occupied ? "taken" : "open"}">${ownedByMe ? "我的座位" : occupied ? "已占用" : "空座位"}</span>
      <button class="option-btn seat-action-btn" type="button" data-seat-action="${ownedByMe ? "release" : "claim"}" data-player-id="${player.id}" ${canClaim ? "" : "disabled"}>${ownedByMe ? "离开座位" : "选择座位"}</button>
    `;
    card.appendChild(seatRow);
  });

  els.playersPanel.querySelectorAll("[data-seat-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const playerId = Number(button.dataset.playerId);
      if (button.dataset.seatAction === "release") {
        requestIntent("releaseSeat", { playerId });
        return;
      }
      requestIntent("claimSeat", { playerId });
    });
  });
}

function updatePlayerName(playerId, value) {
  if (!canEditPlayerNameLocally(playerId)) return;
  requestIntent("renamePlayer", { playerId, name: value });
  return;
  const player = state.players.find((item) => item.id === playerId);
  if (!player) return;
  const nextName = normalizeSeatName(value, playerId);
  player.name = nextName;
  persistPlayerNames();
  render();
}

function renderLog() {
  els.logList.innerHTML = state.log.map((entry) => `
    <div class="log-entry">
      <strong>${entry.title}</strong>
      <span>${entry.detail}</span>
    </div>
  `).join("");
}

function renderZoneMarkersFixed() {
  view.zoneObjects.forEach((entry, zoneId) => {
    entry.markerGroup.clear();
    const players = state.players
      .filter((player) => player.placements[zoneId] > 0)
      .sort((a, b) => b.placements[zoneId] - a.placements[zoneId]);

    players.forEach((player, index) => {
      const count = player.placements[zoneId];
      const clusterOriginX = -0.88 + (index % 3) * 0.88;
      const clusterOriginZ = -0.36 + Math.floor(index / 3) * 0.62;
      const clusterCols = 3;

      for (let dieIndex = 0; dieIndex < count; dieIndex += 1) {
        const die = createDieMesh(((dieIndex % 6) + 1), {
          bodyColor: player.color,
          size: 0.24,
        }).mesh;
        const col = dieIndex % clusterCols;
        const row = Math.floor(dieIndex / clusterCols);
        die.position.set(
          clusterOriginX + col * 0.22,
          0.58 + row * 0.16,
          clusterOriginZ + (col % 2) * 0.08
        );
        die.rotation.y = ((dieIndex + index) % 4) * 0.35;
        entry.markerGroup.add(die);
      }
    });
  });
}

function getZoneDisplayEntriesFixed(zoneId) {
  const playerEntries = state.players
    .filter((player) => player.placements[zoneId] > 0)
    .map((player) => ({
      type: "player",
      id: `player-${player.id}`,
      player,
      count: player.placements[zoneId],
      color: player.color,
      label: player.name,
      description: "",
    }));

  const neutralCount = Number(state.neutralPlacements[zoneId] || 0);
  const neutralEntries = neutralCount > 0 ? [{
    type: "neutral",
    id: `neutral-${zoneId}`,
    count: neutralCount,
    color: "#7f7b74",
    label: "干扰骰子",
    description: "",
  }] : [];

  return [...playerEntries, ...neutralEntries].sort((a, b) => b.count - a.count);
}

function buildZoneInfoTooltip(zone, entries) {
  const lines = [
    `${zone.id}点 ${zone.name}`,
    `第1名 ${formatMoney(zone.rewards[0])} / 第2名 ${formatMoney(zone.rewards[1])}`,
  ];

  if (!entries.length) {
    lines.push("暂无放置");
    return lines.join("\n");
  }

  entries.forEach((entry) => {
    const suffix = entry.type === "neutral" ? "（只参与重复数量判定，不参与奖励）" : "";
    lines.push(`${entry.label}：${entry.count} 枚${suffix}`);
  });

  return lines.join("\n");
}

function renderZoneInfoOverlayEnhanced() {
  const positions = [
    { left: "50%", top: "12%" },
    { left: "79%", top: "31%" },
    { left: "79%", top: "69%" },
    { left: "50%", top: "88%" },
    { left: "21%", top: "69%" },
    { left: "21%", top: "31%" },
  ];

  els.zoneInfoOverlay.innerHTML = ZONES.map((zone, index) => {
    const entries = getZoneDisplayEntriesFixed(zone.id);
    const rankingIds = new Set(getZoneRanking(zone.id).map((entry) => `player-${entry.player.id}`));
    return `
      <div class="zone-info-card" style="left:${positions[index].left}; top:${positions[index].top};">
        <div class="zone-info-title">${zone.id}点 ${zone.name}</div>
        <div class="zone-reward-line">
          <span>第1名 ${formatMoney(zone.rewards[0])}</span>
          <span>第2名 ${formatMoney(zone.rewards[1])}</span>
        </div>
        <div class="zone-info-list">
          ${entries.length ? entries.map((entry) => `
            <div class="zone-info-row ${rankingIds.has(entry.id) ? "valid" : "invalid"} ${entry.type === "neutral" ? "neutral" : ""}">
              <span class="zone-player-dot" style="background:${entry.color}"></span>
              <strong style="color:${entry.color}">
                ${entry.label}
                ${entry.type === "neutral" ? '<span class="neutral-badge" title="中立干扰堆只参与重复数量判定，不参与第一名或第二名奖励。">干扰</span>' : ""}
              </strong>
              <span>${entry.count} 枚</span>
            </div>
            ${entry.type === "neutral" ? `<div class="zone-info-note" title="${entry.description}">${entry.description}</div>` : ""}
          `).join("") : '<div class="zone-info-empty">暂无放置</div>'}
        </div>
      </div>
    `;
  }).join("");
}

function renderZoneMarkersEnhanced() {
  view.zoneObjects.forEach((entry, zoneId) => {
    entry.markerGroup.clear();
    const entries = getZoneDisplayEntriesFixed(zoneId);

    entries.forEach((item, index) => {
      const clusterOriginX = -0.88 + (index % 3) * 0.88;
      const clusterOriginZ = -0.36 + Math.floor(index / 3) * 0.62;
      const clusterCols = 3;

      for (let dieIndex = 0; dieIndex < item.count; dieIndex += 1) {
        const die = createDieMesh(((dieIndex % 6) + 1), {
          bodyColor: item.color,
          size: 0.24,
        }).mesh;
        const col = dieIndex % clusterCols;
        const row = Math.floor(dieIndex / clusterCols);
        die.position.set(
          clusterOriginX + col * 0.22,
          0.58 + row * 0.16,
          clusterOriginZ + (col % 2) * 0.08
        );
        die.rotation.y = ((dieIndex + index) % 4) * 0.35;
        if (item.type === "neutral") {
          die.traverse((child) => {
            if (!child.material) return;
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((material) => {
              if ("opacity" in material) {
                material.transparent = true;
                material.opacity = 0.78;
              }
              if ("emissive" in material) {
                material.emissive.set("#4b4945");
                material.emissiveIntensity = 0.18;
              }
            });
          });
        }
        entry.markerGroup.add(die);
      }
    });
  });
}

function getZoneDisplayEntries(zoneId) {
  const playerEntries = state.players
    .filter((player) => player.placements[zoneId] > 0)
    .map((player) => ({
      type: "player",
      id: `player-${player.id}`,
      player,
      count: player.placements[zoneId],
      color: player.color,
      label: player.name,
    }));

  const neutralEntries = (state.neutralPlacements[zoneId] || []).map((count, index) => ({
    type: "neutral",
    id: `neutral-${zoneId}-${index}`,
    count,
    color: "#7f7b74",
    label: "中立干扰堆",
  }));

  return [...playerEntries, ...neutralEntries].sort((a, b) => b.count - a.count);
}

function applyGame1Pollution(pileIndex, zoneId, actorId = getLocalActorId()) {
  if (!canActOnCurrentTurn(actorId)) return;
  const player = getCurrentPlayer();
  if (!player || !state.modal || state.modal.type !== "game1") return;
  const count = POLLUTION_PILES[pileIndex];
  if (!Number.isFinite(count)) return;
  if (!state.neutralPlacements[zoneId]) {
    state.neutralPlacements[zoneId] = [];
  }
  state.neutralPlacements[zoneId].push(count);
  addLog(player.name, `在游戏1中放入 ${count} 枚中立干扰骰子到 ${ZONES[zoneId - 1].name}。`);
  closeModal();
  advanceTurn();
}

function renderZoneInfoOverlay() {
  const positions = [
    { left: "50%", top: "12%" },
    { left: "79%", top: "31%" },
    { left: "79%", top: "69%" },
    { left: "50%", top: "88%" },
    { left: "21%", top: "69%" },
    { left: "21%", top: "31%" },
  ];

  els.zoneInfoOverlay.innerHTML = ZONES.map((zone, index) => {
    const entries = getZoneDisplayEntries(zone.id);
    const rankingIds = new Set(getZoneRanking(zone.id).map((entry) => `player-${entry.player.id}`));

    return `
      <div class="zone-info-card" style="left:${positions[index].left}; top:${positions[index].top};">
        <div class="zone-info-title">${zone.id}点 ${zone.name}</div>
        <div class="zone-reward-line">
          <span>第1名 ${formatMoney(zone.rewards[0])}</span>
          <span>第2名 ${formatMoney(zone.rewards[1])}</span>
        </div>
        <div class="zone-info-list">
          ${entries.length ? entries.map((entry) => `
            <div class="zone-info-row ${rankingIds.has(entry.id) ? "valid" : "invalid"}">
              <span class="zone-player-dot" style="background:${entry.color}"></span>
              <strong style="color:${entry.color}">${entry.label}</strong>
              <span>${entry.count} 枚</span>
            </div>
          `).join("") : '<div class="zone-info-empty">暂无放置</div>'}
        </div>
      </div>
    `;
  }).join("");
}

function renderZoneMarkers() {
  view.zoneObjects.forEach((entry, zoneId) => {
    entry.markerGroup.clear();
    const entries = getZoneDisplayEntries(zoneId);

    entries.forEach((item, index) => {
      const clusterOriginX = -0.88 + (index % 3) * 0.88;
      const clusterOriginZ = -0.36 + Math.floor(index / 3) * 0.62;
      const clusterCols = 3;

      for (let dieIndex = 0; dieIndex < item.count; dieIndex += 1) {
        const die = createDieMesh(((dieIndex % 6) + 1), {
          bodyColor: item.color,
          size: 0.24,
        }).mesh;
        const col = dieIndex % clusterCols;
        const row = Math.floor(dieIndex / clusterCols);
        die.position.set(
          clusterOriginX + col * 0.22,
          0.58 + row * 0.16,
          clusterOriginZ + (col % 2) * 0.08
        );
        die.rotation.y = ((dieIndex + index) % 4) * 0.35;
        if (item.type === "neutral") {
          die.traverse((child) => {
            if (!child.material) return;
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((material) => {
              if ("opacity" in material) {
                material.transparent = true;
                material.opacity = 0.78;
              }
            });
          });
        }
        entry.markerGroup.add(die);
      }
    });
  });
}

function spawnRollingDice(values) {
  clearDiceScene();
  view.centerDiceSyncKey = `rolling:${values.join("-")}`;
  view.rollingDice = values.map((value, index) => {
    const die = createDieMesh(value);
    const angle = (index / Math.max(values.length, 1)) * Math.PI * 2;
    const radius = 1.1 + (index % 3) * 0.45;
    die.mesh.position.set(Math.cos(angle) * radius, 0.55 + (index % 2) * 0.08, Math.sin(angle) * radius);
    die.mesh.rotation.y = angle;
    die.mesh.userData = {
      elapsed: 0,
      spinX: 6 + Math.random() * 5,
      spinZ: 5 + Math.random() * 4,
      driftX: (Math.random() - 0.5) * 0.9,
      driftZ: (Math.random() - 0.5) * 0.9,
      seed: Math.random() * Math.PI * 2,
    };
    view.diceRoot.add(die.mesh);
    return die;
  });
}

function settleDice(values) {
  clearDiceScene();
  view.centerDiceSyncKey = `settled:${values.join("-")}`;
  view.selectableDice = [];
  values.forEach((value, index) => {
    const die = createDieMesh(value);
    const cols = Math.min(4, values.length);
    const x = (index % cols) * 1.05 - ((cols - 1) * 1.05) / 2;
    const z = Math.floor(index / cols) * 1.05 - (Math.floor((values.length - 1) / cols) * 1.05) / 2;
    die.mesh.position.set(x, 0.55, z);
    die.mesh.rotation.y = (index % 2) * 0.3;
    markDieInteractive(die.mesh, value);
    view.diceRoot.add(die.mesh);
    view.selectableDice.push(die.mesh);
  });
  updateSelectableDiceHighlight();
}

function clearDiceScene() {
  view.rollingDice = [];
  view.selectableDice = [];
  view.hoveredDieValue = null;
  view.centerDiceSyncKey = "empty";
  while (view.diceRoot.children.length) {
    const child = view.diceRoot.children.pop();
    view.diceRoot.remove(child);
  }
}

function syncCenterDiceSceneWithState() {
  const nextKey = state.isRolling && state.roll.length
    ? `rolling:${state.roll.join("-")}`
    : state.hasRolled && state.roll.length
      ? `settled:${state.roll.join("-")}`
      : "empty";

  if (view.centerDiceSyncKey === nextKey) return;

  if (nextKey === "empty") {
    clearDiceScene();
    return;
  }

  if (state.isRolling) {
    spawnRollingDice(state.roll);
    return;
  }

  if (state.hasRolled) {
    settleDice(state.roll);
    return;
  }

  clearDiceScene();
}

function markDieInteractive(mesh, value) {
  mesh.userData.dieValue = value;
  mesh.userData.highlightable = true;
  mesh.traverse((child) => {
    child.userData.dieValue = value;
    child.userData.highlightable = true;
  });
}

function setHoveredDieValue(value) {
  if (view.hoveredDieValue === value) return;
  view.hoveredDieValue = value ?? null;
  updateSelectableDiceHighlight();
}

function updateSelectableDiceHighlight() {
  view.selectableDice.forEach((die) => {
    const selected = view.hoveredDieValue && die.userData.dieValue === view.hoveredDieValue;
    die.scale.setScalar(selected ? 1.12 : 1);
    die.position.y = selected ? 0.72 : 0.55;
    die.traverse((child) => {
      if (!child.material) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (!("emissive" in material)) return;
        material.emissive.set(selected ? "#ffd66b" : "#000000");
        material.emissiveIntensity = selected ? 0.65 : 0;
      });
    });
  });
}

function createDieMesh(value, options = {}) {
  const {
    bodyColor = "#f8f2e7",
    faceColor = "#fffaf0",
    pipColor = "#2b2018",
    size = 0.82,
  } = options;
  const group = new THREE.Group();
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(bodyColor), roughness: 0.68, metalness: 0.04 })
  );
  cube.position.y = 0;
  group.add(cube);

  const topPlate = new THREE.Mesh(
    new THREE.PlaneGeometry(size * 0.71, size * 0.71),
    new THREE.MeshBasicMaterial({ map: createPipTexture(value, faceColor, pipColor), transparent: true })
  );
  topPlate.rotation.x = -Math.PI / 2;
  topPlate.position.y = size * 0.506;
  group.add(topPlate);

  return { mesh: group, value };
}

function createPipTexture(value, faceColor = "#fffaf0", pipColor = "#2b2018") {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = faceColor;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = pipColor;
  const r = 18;
  const points = {
    tl: [64, 64],
    tc: [128, 64],
    tr: [192, 64],
    ml: [64, 128],
    mc: [128, 128],
    mr: [192, 128],
    bl: [64, 192],
    bc: [128, 192],
    br: [192, 192],
  };
  const layouts = {
    1: ["mc"],
    2: ["tl", "br"],
    3: ["tl", "mc", "br"],
    4: ["tl", "tr", "bl", "br"],
    5: ["tl", "tr", "mc", "bl", "br"],
    6: ["tl", "tr", "ml", "mr", "bl", "br"],
  };
  layouts[value].forEach((key) => {
    const [x, y] = points[key];
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function animate() {
  requestAnimationFrame(animate);

  view.rollingDice.forEach((die) => {
    die.mesh.userData.elapsed += 0.03;
    const t = die.mesh.userData.elapsed;
    die.mesh.rotation.x = t * die.mesh.userData.spinX;
    die.mesh.rotation.z = t * die.mesh.userData.spinZ;
    die.mesh.position.x += Math.sin(t * 2.2 + die.mesh.userData.seed) * 0.01 + die.mesh.userData.driftX * 0.002;
    die.mesh.position.z += Math.cos(t * 1.8 + die.mesh.userData.seed) * 0.01 + die.mesh.userData.driftZ * 0.002;
    die.mesh.position.y = 0.58 + Math.abs(Math.sin(t * 6)) * 0.12;
  });

  animateMiniGameThree();
  animateGame1PileScenes();
  view.renderer.render(view.scene, view.camera);
}

function animateGame1PileScenes() {
  view.game1PileScenes.forEach((entry, index) => {
    entry.root.rotation.y += 0.004 + index * 0.0005;
    entry.renderer.render(entry.scene, entry.camera);
  });
}

function startGame1Drag(event, player, pileIndex, sourceEl) {
  if (!state.modal || state.modal.type !== "game1") return;
  event.preventDefault();
  state.modal.draggedPileIndex = pileIndex;
  sourceEl.classList.add("dragging");
  view.game1DraggedEl = sourceEl;
  const rect = sourceEl.getBoundingClientRect();
  sourceEl.style.position = "fixed";
  sourceEl.style.left = `${rect.left}px`;
  sourceEl.style.top = `${rect.top}px`;
  sourceEl.style.width = `${rect.width}px`;
  sourceEl.style.height = `${rect.height}px`;
  sourceEl.dataset.dragOriginLeft = String(rect.left);
  sourceEl.dataset.dragOriginTop = String(rect.top);
  sourceEl.dataset.dragOffsetX = String(event.clientX - rect.left);
  sourceEl.dataset.dragOffsetY = String(event.clientY - rect.top);
  moveDraggedPile(event.clientX, event.clientY);
  highlightGame1DropZone(event.clientX, event.clientY);

  const onMove = (moveEvent) => {
    moveDraggedPile(moveEvent.clientX, moveEvent.clientY);
    highlightGame1DropZone(moveEvent.clientX, moveEvent.clientY);
  };

  const onUp = (upEvent) => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    sourceEl.classList.remove("dragging");
    const zoneId = getGame1ZoneUnderPointer(upEvent.clientX, upEvent.clientY);
    cleanupGame1Drag();
    if (zoneId) {
      if (network.roomId && !network.isHost) {
        requestIntent("game1Pollution", { pileIndex, zoneId });
        closeModal();
        return;
      }
      applyGame1PollutionFixed(pileIndex, zoneId);
    }
  };

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
}

function moveDraggedPile(x, y) {
  if (!view.game1DraggedEl) return;
  const offsetX = Number(view.game1DraggedEl.dataset.dragOffsetX || 0);
  const offsetY = Number(view.game1DraggedEl.dataset.dragOffsetY || 0);
  const nextLeft = x - offsetX;
  const nextTop = y - offsetY;
  view.game1DraggedEl.style.left = `${nextLeft}px`;
  view.game1DraggedEl.style.top = `${nextTop}px`;
  view.game1DraggedEl.style.transform = "rotate(-6deg) scale(1.03)";
}

function createGame1BoardOverlay() {
  destroyGame1BoardOverlay();
  const boardRect = els.threeMount.getBoundingClientRect();
  const overlay = document.createElement("div");
  overlay.className = "game1-board-overlay";
  const positions = [
    { x: 0.5, y: 0.15 },
    { x: 0.77, y: 0.32 },
    { x: 0.77, y: 0.68 },
    { x: 0.5, y: 0.85 },
    { x: 0.23, y: 0.68 },
    { x: 0.23, y: 0.32 },
  ];

  ZONES.forEach((zone, index) => {
    const zoneEntries = getZoneDisplayEntries(zone.id);
    const hotspot = document.createElement("div");
    hotspot.className = "game1-zone-hotspot";
    hotspot.dataset.zoneId = String(zone.id);
    hotspot.innerHTML = `
      <span class="game1-zone-name">${zone.id} 点 ${zone.name}</span>
      <div class="game1-zone-mini-list">
        ${zoneEntries.length ? zoneEntries.map((entry) => `
          <div class="game1-zone-mini-row">
            <span class="game1-zone-mini-dot" style="background:${entry.color}"></span>
            <strong>${entry.label}</strong>
            <span>${entry.count}</span>
          </div>
        `).join("") : '<div class="game1-zone-empty">暂无</div>'}
      </div>
    `;
    hotspot.style.left = `${boardRect.left + boardRect.width * positions[index].x}px`;
    hotspot.style.top = `${boardRect.top + boardRect.height * positions[index].y}px`;
    overlay.appendChild(hotspot);
  });

  document.body.appendChild(overlay);
  view.game1Overlay = overlay;
}

function destroyGame1BoardOverlay() {
  if (view.game1Overlay?.parentNode) {
    view.game1Overlay.parentNode.removeChild(view.game1Overlay);
  }
  view.game1Overlay = null;
}

function setupGame1PileScenes() {
  destroyGame1PileScenes();
  const mounts = [...els.modalBody.querySelectorAll("[data-pile-three]")];
  mounts.forEach((mount) => {
    const width = mount.clientWidth || 150;
    const height = mount.clientHeight || 150;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 100);
    camera.position.set(0, 3.7, 5.6);
    camera.lookAt(0, 0.5, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 1.45);
    const key = new THREE.DirectionalLight(0xfff3dc, 1.8);
    key.position.set(3, 6, 4);
    scene.add(ambient, key);

    const root = new THREE.Group();
    const pileCount = Number(mount.dataset.pileCount);
    for (let i = 0; i < pileCount; i += 1) {
      const die = createDieMesh(((i % 6) + 1)).mesh;
      die.position.set((i % 2) * 0.55 - 0.27 + Math.floor(i / 2) * 0.07, 0.42 + Math.floor(i / 2) * 0.26, (i % 2) * 0.18 - 0.08);
      die.rotation.y = (i % 2 === 0 ? -0.4 : 0.35);
      root.add(die);
    }
    scene.add(root);
    view.game1PileScenes.push({ mount, scene, camera, renderer, root });
  });
}

function destroyGame1PileScenes() {
  view.game1PileScenes.forEach((entry) => {
    entry.renderer.dispose();
    if (entry.renderer.domElement.parentNode) {
      entry.renderer.domElement.parentNode.removeChild(entry.renderer.domElement);
    }
  });
  view.game1PileScenes = [];
}

function highlightGame1DropZone(x, y) {
  if (!view.game1Overlay) return;
  const zoneId = getGame1ZoneUnderPointer(x, y);
  view.game1Overlay.querySelectorAll(".game1-zone-hotspot").forEach((node) => {
    node.classList.toggle("active", Number(node.dataset.zoneId) === zoneId);
  });
}

function getGame1ZoneUnderPointer(x, y) {
  if (!view.game1Overlay) return null;
  const hotspots = [...view.game1Overlay.querySelectorAll(".game1-zone-hotspot")];
  const hit = hotspots.find((node) => {
    const rect = node.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  });
  return hit ? Number(hit.dataset.zoneId) : null;
}

function cleanupGame1Drag() {
  if (view.game1DraggedEl) {
    view.game1DraggedEl.style.transform = "";
    view.game1DraggedEl.style.position = "";
    view.game1DraggedEl.style.left = "";
    view.game1DraggedEl.style.top = "";
    view.game1DraggedEl.style.width = "";
    view.game1DraggedEl.style.height = "";
    view.game1DraggedEl.classList.remove("dragging");
    delete view.game1DraggedEl.dataset.dragOriginLeft;
    delete view.game1DraggedEl.dataset.dragOriginTop;
    delete view.game1DraggedEl.dataset.dragOffsetX;
    delete view.game1DraggedEl.dataset.dragOffsetY;
  }
  view.game1DraggedEl = null;
  if (view.game1Overlay) {
    view.game1Overlay.querySelectorAll(".game1-zone-hotspot").forEach((node) => node.classList.remove("active"));
  }
  if (state.modal?.type === "game1") {
    state.modal.draggedPileIndex = null;
  }
}

function handleResize() {
  const width = els.threeMount.clientWidth || 900;
  const height = els.threeMount.clientHeight || 900;
  view.camera.aspect = width / height;
  view.camera.updateProjectionMatrix();
  view.renderer.setSize(width, height);

  if (view.modalThree) {
    const modalWidth = view.modalThree.mount.clientWidth || 320;
    const modalHeight = view.modalThree.mount.clientHeight || 220;
    view.modalThree.camera.aspect = modalWidth / modalHeight;
    view.modalThree.camera.updateProjectionMatrix();
    view.modalThree.renderer.setSize(modalWidth, modalHeight);
  }

  view.game1PileScenes.forEach((entry) => {
    const width = entry.mount.clientWidth || 150;
    const height = entry.mount.clientHeight || 150;
    entry.camera.aspect = width / height;
    entry.camera.updateProjectionMatrix();
    entry.renderer.setSize(width, height);
  });

  if (state.modal?.type === "game1") {
    createGame1BoardOverlay();
  }
}

function updatePointerFromEvent(event) {
  const rect = view.renderer.domElement.getBoundingClientRect();
  view.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  view.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function intersectBoardObjects(event, objects) {
  if (!view.renderer) return [];
  const targets = objects.filter(Boolean);
  if (!targets.length) return [];
  updatePointerFromEvent(event);
  view.raycaster.setFromCamera(view.pointer, view.camera);
  return view.raycaster.intersectObjects(targets, true);
}

function getDieValueFromIntersection(intersections) {
  const hit = intersections.find((entry) => entry.object?.userData?.dieValue || entry.object?.parent?.userData?.dieValue);
  if (!hit) return null;
  return hit.object.userData.dieValue || hit.object.parent?.userData?.dieValue || null;
}

function handleBoardPointerMove(event) {
  if (!view.renderer?.domElement) return;
  let cursor = "default";
  if (!state.modal && !state.gameOver && !state.isRolling) {
    if (state.hasRolled) {
      const dieHit = getDieValueFromIntersection(intersectBoardObjects(event, view.selectableDice));
      setHoveredDieValue(dieHit);
      if (dieHit) cursor = "pointer";
    } else if (intersectBoardObjects(event, [view.centerHitMesh]).length && canControlGameLocally()) {
      setHoveredDieValue(null);
      cursor = "pointer";
    } else {
      setHoveredDieValue(null);
    }
  } else {
    setHoveredDieValue(null);
  }
  view.renderer.domElement.style.cursor = cursor;
}

function handleBoardClick(event) {
  if (state.modal || state.gameOver || state.isRolling) return;
  if (state.hasRolled) {
    const faceValue = getDieValueFromIntersection(intersectBoardObjects(event, view.selectableDice));
    if (faceValue) {
      requestIntent("placeDice", { faceValue });
    }
    return;
  }

  if (!canControlGameLocally()) return;
  if (intersectBoardObjects(event, [view.centerHitMesh]).length) {
    requestIntent("roll");
  }
}

function sumPlacements(player) {
  return Object.values(player.placements).reduce((sum, value) => sum + value, 0);
}

function addLog(title, detail) {
  state.log.unshift({ title, detail });
  state.log = state.log.slice(0, 18);
}

function openModal() {
  els.modal.classList.remove("rules-modal");
  els.modal.classList.remove("hidden");
  els.modal.setAttribute("aria-hidden", "false");
}

function closeModal(silent = false) {
  destroyMiniGameThreeScene();
  destroyGame1BoardOverlay();
  destroyGame1PileScenes();
  cleanupGame1Drag();
  state.modal = null;
  els.modal.classList.remove("rules-modal");
  els.modal.classList.add("hidden");
  els.modal.setAttribute("aria-hidden", "true");
  if (!silent) render();
}

function getCurrentPlayer() {
  return state.players[state.currentPlayerIndex];
}

function getRoundNumber() {
  const totalPlaced = state.players.reduce((sum, player) => sum + (8 - player.diceRemaining), 0);
  return Math.min(8, Math.floor(totalPlaced / state.players.length) + 1);
}

function countValues(values) {
  return values.reduce((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function rollTwoDice() {
  return randomInt(1, 6) + randomInt(1, 6);
}

function getOrCreateParticipantId() {
  try {
    const existing = window.localStorage.getItem(PARTICIPANT_ID_STORAGE_KEY);
    if (existing) return existing;
    const created = createParticipantId();
    window.localStorage.setItem(PARTICIPANT_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return createParticipantId();
  }
}

function normalizeNeutralPlacements(raw) {
  const normalized = Object.fromEntries(ZONES.map((zone) => [zone.id, 0]));
  if (!raw || typeof raw !== "object") return normalized;

  ZONES.forEach((zone) => {
    const value = raw[zone.id];
    if (Array.isArray(value)) {
      normalized[zone.id] = value.reduce((sum, count) => sum + Number(count || 0), 0);
      return;
    }
    normalized[zone.id] = Number(value || 0);
  });

  return normalized;
}

function renameZoneDisplayNames() {
  const zone1 = ZONES.find((zone) => zone.id === 1);
  const zone2 = ZONES.find((zone) => zone.id === 2);
  const zone3 = ZONES.find((zone) => zone.id === 3);
  if (zone1) zone1.name = "浑水摸鱼";
  if (zone2) zone2.name = "猜正反";
  if (zone3) zone3.name = "猜大小";
}

function createParticipantId() {
  const randomApi = globalThis.crypto?.getRandomValues?.bind(globalThis.crypto);
  if (randomApi) {
    const bytes = new Uint8Array(12);
    randomApi(bytes);
    return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("").slice(0, 12);
  }

  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.slice(0, 12);
}

function createRoomId() {
  return createParticipantId().replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function formatMoney(value) {
  return `${value.toLocaleString("zh-CN")} 元`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function persistPlayerNames() {
  const names = state.players.map((player) => player.name);
  window.localStorage.setItem(PLAYER_NAMES_STORAGE_KEY, JSON.stringify(names));
}

function loadPersistedPlayerNames() {
  try {
    const raw = window.localStorage.getItem(PLAYER_NAMES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function getDefaultPlayerName(playerId) {
  return `玩家 ${playerId}`;
}

function normalizeSeatName(value, playerId) {
  return value.trim() || getDefaultPlayerName(playerId);
}

function renderPileDice(count) {
  return Array.from({ length: count }, (_, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = col * 28 + row * 6;
    const y = row * 20;
    return `
      <span class="pile-die" style="--dx:${x}px; --dy:${y}px;">
        <span class="pile-die-face top"></span>
        <span class="pile-die-face side"></span>
        <span class="pile-die-face front"></span>
      </span>
    `;
  }).join("");
}

function setupMiniGameThreeScene(kind) {
  destroyMiniGameThreeScene();
  const mount = document.getElementById("miniThreeMount");
  if (!mount) return;

  const width = mount.clientWidth || 320;
  const height = mount.clientHeight || 220;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  mount.appendChild(renderer.domElement);

  const ambient = new THREE.AmbientLight(0xffffff, 1.6);
  const key = new THREE.DirectionalLight(0xfff0d9, 2);
  key.position.set(3, 5, 4);
  scene.add(ambient, key);

  const root = new THREE.Group();
  scene.add(root);

  if (kind === "coin") {
    camera.position.set(0, 1.8, 4.8);
    camera.lookAt(0, 0, 0);
    const coin = createCoinMesh();
    root.add(coin);
    view.modalThree = { kind, mount, scene, camera, renderer, root, coin };
    return;
  }

  camera.position.set(0, 4.8, 5.8);
  camera.lookAt(0, 0, 0);
  const leftDie = createDieMesh(state.modal?.previewRoll?.[0] || 1).mesh;
  const rightDie = createDieMesh(state.modal?.previewRoll?.[1] || 1).mesh;
  leftDie.position.set(-0.9, 0.5, 0);
  rightDie.position.set(0.9, 0.5, 0);
  leftDie.rotation.y = -0.35;
  rightDie.rotation.y = 0.35;
  root.add(leftDie, rightDie);
  view.modalThree = { kind, mount, scene, camera, renderer, root, dice: [leftDie, rightDie], lastSettledKey: `${state.modal?.previewRoll?.join("-")}` };
}

function destroyMiniGameThreeScene() {
  if (!view.modalThree) return;
  view.modalThree.renderer.dispose();
  if (view.modalThree.renderer.domElement.parentNode) {
    view.modalThree.renderer.domElement.parentNode.removeChild(view.modalThree.renderer.domElement);
  }
  view.modalThree = null;
}

function createCoinMesh() {
  const group = new THREE.Group();
  const edge = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.1, 0.16, 48),
    new THREE.MeshStandardMaterial({ color: 0xc9952d, metalness: 0.85, roughness: 0.28 })
  );
  edge.rotation.x = Math.PI / 2;
  group.add(edge);

  const frontFace = new THREE.Mesh(
    new THREE.CircleGeometry(1.08, 48),
    new THREE.MeshStandardMaterial({ map: createCoinFaceTexture("portrait"), metalness: 0.78, roughness: 0.28 })
  );
  frontFace.position.z = 0.082;
  group.add(frontFace);

  const backFace = new THREE.Mesh(
    new THREE.CircleGeometry(1.08, 48),
    new THREE.MeshStandardMaterial({ map: createCoinFaceTexture("crest"), metalness: 0.78, roughness: 0.28 })
  );
  backFace.rotation.y = Math.PI;
  backFace.position.z = -0.082;
  group.add(backFace);

  return group;
}

function createCoinFaceTexture(kind) {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size * 0.35, size * 0.3, size * 0.1, size * 0.5, size * 0.5, size * 0.48);
  gradient.addColorStop(0, "#fff6cf");
  gradient.addColorStop(1, "#cb8f22");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#f6d377";
  ctx.lineWidth = 20;
  ctx.stroke();

  if (kind === "portrait") {
    ctx.fillStyle = "#6f4314";
    ctx.font = "bold 196px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("正", size / 2, size * 0.5);
    ctx.fillStyle = "#8d5c1b";
    ctx.font = "bold 42px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillText("正面", size / 2, size * 0.82);
  } else {
    ctx.strokeStyle = "#6f4314";
    ctx.lineWidth = 12;
    ctx.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const angle = (Math.PI * 2 * i) / 8;
      const x = size / 2 + Math.cos(angle) * size * 0.18;
      const y = size / 2 + Math.sin(angle) * size * 0.18;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = "#6f4314";
    ctx.font = "bold 196px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("反", size / 2, size * 0.5);
    ctx.font = "bold 42px 'Microsoft YaHei', 'PingFang SC', sans-serif";
    ctx.fillText("反面", size / 2, size * 0.82);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function animateMiniGameThree() {
  if (!view.modalThree || !state.modal) return;

  if (view.modalThree.kind === "coin" && state.modal.type === "game2") {
    if (state.modal.animating) {
      view.modalThree.coin.rotation.x += 0.38;
      view.modalThree.coin.rotation.y += 0.04;
    } else {
      const targetX = state.modal.coinAngle;
      view.modalThree.coin.rotation.x += (targetX - view.modalThree.coin.rotation.x) * 0.18;
      view.modalThree.coin.rotation.y += (0.18 - view.modalThree.coin.rotation.y) * 0.12;
    }
  }

  if (view.modalThree.kind === "dice" && state.modal.type === "game3") {
    const values = state.modal.previewRoll || [1, 1];
    if (state.modal.animating) {
      state.modal.diceSpin += 0.22;
      view.modalThree.dice.forEach((die, index) => {
        die.rotation.x += 0.18 + index * 0.03;
        die.rotation.z += 0.16 + index * 0.02;
        die.position.y = 0.5 + Math.abs(Math.sin(state.modal.diceSpin + index)) * 0.18;
      });
    } else {
      const settledKey = values.join("-");
      if (view.modalThree.lastSettledKey !== settledKey) {
        const current = view.modalThree.dice;
        current.forEach((die) => view.modalThree.root.remove(die));
        const leftDie = createDieMesh(values[0]).mesh;
        const rightDie = createDieMesh(values[1]).mesh;
        leftDie.position.set(-0.9, 0.5, 0);
        rightDie.position.set(0.9, 0.5, 0);
        leftDie.rotation.y = -0.35;
        rightDie.rotation.y = 0.35;
        view.modalThree.root.add(leftDie, rightDie);
        view.modalThree.dice = [leftDie, rightDie];
        view.modalThree.lastSettledKey = settledKey;
      }
    }
  }

  view.modalThree.renderer.render(view.modalThree.scene, view.modalThree.camera);
}

copyJoinLink = function copyJoinLinkOverride() {
  if (!network.roomId) return Promise.resolve();
  const joinUrl = getJoinUrl();
  return navigator.clipboard.writeText(joinUrl)
    .then(() => {
      els.networkStatus.textContent = "访客链接已复制";
    })
    .catch(() => {
      els.networkStatus.textContent = joinUrl;
    });
};

renderNetworkPanel = function renderNetworkPanelOverride() {
  const networkPanel = els.createRoomBtn?.closest(".hud-panel");
  if (networkPanel) {
    networkPanel.style.display = network.roomId && !network.isHost ? "none" : "";
  }

  els.roomCodeInfo.textContent = network.roomId || "未创建";
  els.peerCountInfo.textContent = String(network.connectedPeers);
  els.netRoleBadge.textContent = network.roomId ? (network.isHost ? "房主" : "访客") : "单机";
  els.networkStatus.textContent = network.roomId
    ? (network.isHost ? `房主在线 · ${selfId}` : `已加入房间 · ${selfId}`)
    : "未连接";
  els.copyJoinLinkBtn.disabled = !network.roomId || !network.isHost;
  els.createRoomBtn.textContent = network.isHost ? "复制房间链接" : "创建房间";
};

showRulesModal = function showRulesModalOverride() {
  state.modal = { type: "rules", allowClose: true };
  els.modalTitle.textContent = "游戏规则";
  els.modalBody.innerHTML = `
    <div class="minigame-stack rules-stack">
      <div class="player-card">
        <div class="player-head"><strong>人数与目标</strong></div>
        <div class="player-meta">
          <div class="meta-chip">支持 2 到 6 名玩家同局进行。</div>
          <div class="meta-chip">每位玩家初始拥有 8 枚基础骰子与 2 个重摇筹码。</div>
          <div class="meta-chip">当所有玩家的骰子都放完后，对各区域奖励与剩余筹码进行统一结算。</div>
        </div>
      </div>
      <div class="player-card">
        <div class="player-head"><strong>基础流程</strong></div>
        <div class="player-meta">
          <div class="meta-chip">轮到自己时，点击中央投掷区掷出当前剩余的全部骰子。</div>
          <div class="meta-chip">若不满意本次点数，可消耗 1 个重摇筹码重新掷出这批剩余骰子。</div>
          <div class="meta-chip">每回合只能选择一个点数，并把该点数的全部骰子一次性放到对应区域。</div>
        </div>
      </div>
      <div class="player-card">
        <div class="player-head"><strong>唯一数量判定</strong></div>
        <div class="player-meta">
          <div class="meta-chip">每个区域只认数量唯一的对象。</div>
          <div class="meta-chip">若两个或以上对象数量相同，则这些数量全部作废。</div>
          <div class="meta-chip">最后按有效数量从高到低决定第一名与第二名奖励。</div>
        </div>
      </div>
      <div class="player-card">
        <div class="player-head"><strong>区域奖励</strong></div>
        <div class="player-meta">
          <div class="meta-chip">1 点：浑水摸鱼，第一名 40000，第二名 40000。</div>
          <div class="meta-chip">2 点：猜正反，第一名 50000，第二名 30000。</div>
          <div class="meta-chip">3 点：猜大小，第一名 50000，第二名 30000。</div>
          <div class="meta-chip">4 点：基础区，第一名 90000，第二名 40000。</div>
          <div class="meta-chip">5 点：基础区，第一名 80000，第二名 30000。</div>
          <div class="meta-chip">6 点：基础区，第一名 50000，第二名 50000。</div>
        </div>
      </div>
      <div class="player-card">
        <div class="player-head"><strong>小游戏说明</strong></div>
        <div class="player-meta">
          <div class="meta-chip">浑水摸鱼：从 [2, 2, 3, 1, 1, 2] 中拖入一堆干扰骰子到任意区域。它们统一归为“干扰骰子”，只参与重复数量判定，不参与最终排名与奖励。</div>
          <div class="meta-chip">猜正反：最多猜 3 次，每猜中一次获得 20000；若中途猜错，本小游戏已获奖励清零，可随时带着当前奖励离场。</div>
          <div class="meta-chip">猜大小：依据两枚骰子的总和判断下一次会更大还是更小；奖励顺序为 [5000, 80000, 15000, 30000, 50000, 80000]，可随时结算离场。</div>
        </div>
      </div>
      <div class="player-card">
        <div class="player-head"><strong>重摇筹码</strong></div>
        <div class="player-meta">
          <div class="meta-chip">每个未使用的重摇筹码会在对局结束时兑换为 10000。</div>
        </div>
      </div>
    </div>
  `;
  openModal();
};

renderTopMeta = function renderTopMetaOverride() {
  const player = getCurrentPlayer();
  els.currentPlayerName.textContent = state.gameOver ? "游戏结束" : player ? player.name : "-";
  els.roundInfo.textContent = `${getRoundNumber()} / 8`;
  els.diceLeftInfo.textContent = player ? `${player.diceRemaining} 枚` : "-";
};

renderPlayers = function renderPlayersOverride() {
  els.playersPanel.innerHTML = state.players.map((player, index) => `
    <div class="player-card ${index === state.currentPlayerIndex && !state.gameOver ? "active" : ""}">
      <div class="player-head">
        <div class="player-name-editor">
          <label class="sr-only" for="playerName-${player.id}">玩家姓名</label>
          <div class="player-name-row">
            <input
              id="playerName-${player.id}"
              class="player-name-input ${state.editingNamePlayerId === player.id ? "is-editing" : ""}"
              type="text"
              maxlength="20"
              value="${escapeHtml(player.name)}"
              data-player-id="${player.id}"
              style="color:${player.color}"
              ${!(canEditPlayerNameLocally(player.id) && state.editingNamePlayerId === player.id) ? "disabled" : ""}
            >
            <button
              class="name-edit-toggle"
              type="button"
              data-name-toggle="${player.id}"
              ${!canEditPlayerNameLocally(player.id) ? "disabled" : ""}
              title="${state.editingNamePlayerId === player.id ? "保存名称" : "编辑名称"}"
              aria-label="${state.editingNamePlayerId === player.id ? "保存名称" : "编辑名称"}"
            >
              ${getNameEditIcon(state.editingNamePlayerId === player.id ? "save" : "edit")}
            </button>
          </div>
        </div>
        <span class="money">${formatMoney(player.money)}</span>
      </div>
      <div class="player-meta">
        <div class="meta-chip player-stat-chip">
          ${getPlayerStatIcon("dice", "剩余骰子")}
          <strong>${player.diceRemaining}</strong>
        </div>
        <div class="meta-chip player-stat-chip">
          ${getPlayerStatIcon("placed", "已放置骰子")}
          <strong>${sumPlacements(player)}</strong>
        </div>
        <div class="meta-chip player-stat-chip reroll-chip">
          ${getPlayerStatIcon("reroll", "重摇筹码")}
          <strong>${player.rerollTokens || 0}</strong>
        </div>
      </div>
    </div>
  `).join("");

  els.playersPanel.querySelectorAll(".player-name-input").forEach((input) => {
    input.addEventListener("change", () => finishPlayerNameEdit(Number(input.dataset.playerId), input.value));
    input.addEventListener("blur", () => finishPlayerNameEdit(Number(input.dataset.playerId), input.value));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
      if (event.key === "Escape") {
        state.editingNamePlayerId = null;
        render();
      }
    });
  });

  els.playersPanel.querySelectorAll("[data-name-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const playerId = Number(button.dataset.nameToggle);
      togglePlayerNameEdit(playerId);
    });
  });

  if (!network.roomId) return;

  const localSeat = getLocalClaimedSeat();
  [...els.playersPanel.querySelectorAll(".player-card")].forEach((card, index) => {
    const player = state.players[index];
    const owner = state.seatClaims[player.id];
    const ownedByMe = owner === getLocalActorId();
    const occupied = Boolean(owner);
    const canClaim = (!localSeat || ownedByMe) && (!occupied || ownedByMe);
    const seatRow = document.createElement("div");
    seatRow.className = "seat-row";
    seatRow.innerHTML = `
      <span class="seat-badge ${ownedByMe ? "mine" : occupied ? "taken" : "open"}">${ownedByMe ? "我的座位" : occupied ? "已占用" : "空座位"}</span>
      <button class="option-btn seat-action-btn" type="button" data-seat-action="${ownedByMe ? "release" : "claim"}" data-player-id="${player.id}" ${canClaim ? "" : "disabled"}>${ownedByMe ? "离开座位" : "选择座位"}</button>
    `;
    card.appendChild(seatRow);
  });

  els.playersPanel.querySelectorAll("[data-seat-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const playerId = Number(button.dataset.playerId);
      if (button.dataset.seatAction === "release") {
        requestIntent("releaseSeat", { playerId });
        return;
      }
      const player = state.players.find((item) => item.id === playerId);
      const seatName = window.prompt("请输入该座位的玩家名称", player?.name || getDefaultPlayerName(playerId));
      if (seatName === null) return;
      requestIntent("claimSeat", { playerId, name: seatName });
    });
  });
};

formatMoney = function formatMoneyOverride(value) {
  return `${value.toLocaleString("zh-CN")} 元`;
};

function getPlayerStatIcon(type, label) {
  if (type === "dice") {
    return `
      <span class="stat-icon" data-tooltip="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" role="img">
        <svg viewBox="0 0 24 24" focusable="false">
          <rect x="4.5" y="4.5" width="15" height="15" rx="3.2"></rect>
          <circle cx="9" cy="9" r="1.1"></circle>
          <circle cx="15" cy="15" r="1.1"></circle>
        </svg>
      </span>
    `;
  }

  if (type === "placed") {
    return `
      <span class="stat-icon" data-tooltip="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" role="img">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M6 15.5 12 5l6 10.5"></path>
          <path d="M6 15.5h12"></path>
          <path d="M9 19.5h6"></path>
        </svg>
      </span>
    `;
  }

  return `
    <span class="stat-icon" data-tooltip="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" role="img">
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M12 4a8 8 0 1 1-7.2 4.5"></path>
        <path d="M5 4.5v4h4"></path>
        <circle cx="12" cy="12" r="2.2"></circle>
      </svg>
    </span>
  `;
}

function getNameEditIcon(type) {
  if (type === "save") {
    return `
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M5 12.5 9.2 16.7 19 7.5"></path>
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="m4 16.8 8.9-8.9 3.1 3.1-8.9 8.9L4 20z"></path>
      <path d="m11.9 8.9 1.8-1.8a2 2 0 0 1 2.8 0l1.4 1.4a2 2 0 0 1 0 2.8l-1.8 1.8"></path>
    </svg>
  `;
}

openMiniGame = function openMiniGameOverride(gameId, playerId) {
  const player = state.players.find((item) => item.id === playerId);
  if (!player) return;

  if (gameId === 1) {
    if (!getAvailablePollutionPiles().length) {
      addLog(player.name, "浑水摸鱼已没有可用的污染骰堆，本次小游戏跳过。");
      advanceTurn();
      return;
    }
    state.modal = { type: "game1", playerId, allowClose: false, draggedPileIndex: null };
    renderGame1(player);
    return;
  }

  if (gameId === 2) {
    state.modal = { type: "game2", playerId, progress: 0, earned: 0, resolved: false, allowClose: false, animating: false, lastFlipResult: "", coinAngle: 0, coinTargetAngle: 0 };
    renderGame2(player);
    return;
  }

  const initialRoll = [randomInt(1, 6), randomInt(1, 6)];
  state.modal = {
    type: "game3",
    playerId,
    step: 0,
    lastTotal: null,
    earned: 0,
    resolved: false,
    allowClose: false,
    animating: true,
    previewRoll: [randomInt(1, 6), randomInt(1, 6)],
    lastOutcomeText: "正在投掷初始双骰，建立基准点数...",
    diceSpin: 0,
    initialRoll,
    initialRevealDone: false,
  };
  renderGame3(player);
  window.setTimeout(() => {
    if (!state.modal || state.modal.type !== "game3") return;
    state.modal.previewRoll = initialRoll;
    state.modal.lastTotal = initialRoll[0] + initialRoll[1];
    state.modal.animating = false;
    state.modal.initialRevealDone = true;
    state.modal.lastOutcomeText = `初始点数 ${initialRoll[0]} + ${initialRoll[1]} = ${state.modal.lastTotal}`;
    renderGame3(player);
  }, 1100);
};

function togglePlayerNameEdit(playerId) {
  if (!canEditPlayerNameLocally(playerId)) return;

  if (state.editingNamePlayerId === playerId) {
    const input = document.getElementById(`playerName-${playerId}`);
    finishPlayerNameEdit(playerId, input?.value ?? "");
    return;
  }

  state.editingNamePlayerId = playerId;
  render();
  window.requestAnimationFrame(() => {
    const input = document.getElementById(`playerName-${playerId}`);
    if (!input) return;
    input.focus();
    input.select();
  });
}

function finishPlayerNameEdit(playerId, value) {
  if (state.editingNamePlayerId !== playerId) return;
  state.editingNamePlayerId = null;
  updatePlayerName(playerId, value);
  render();
}

setupGame1PileScenes = function setupGame1PileScenesOverride() {
  destroyGame1PileScenes();
  const mounts = [...els.modalBody.querySelectorAll("[data-pile-three]")];
  mounts.forEach((mount) => {
    const width = mount.clientWidth || 160;
    const height = mount.clientHeight || 176;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 100);
    camera.position.set(0, 4.4, 6.8);
    camera.lookAt(0, 0.7, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 1.55);
    const key = new THREE.DirectionalLight(0xfff3dc, 1.9);
    key.position.set(3.2, 6.4, 4.6);
    scene.add(ambient, key);

    const root = new THREE.Group();
    const pileCount = Number(mount.dataset.pileCount);
    const layout = [
      { x: -0.62, y: 0.38, z: -0.06, ry: -0.42 },
      { x: 0.62, y: 0.38, z: 0.08, ry: 0.36 },
      { x: 0, y: 0.94, z: -0.02, ry: -0.08 },
      { x: -0.62, y: 1.5, z: 0.08, ry: -0.34 },
      { x: 0.62, y: 1.5, z: -0.06, ry: 0.3 },
      { x: 0, y: 2.06, z: 0.04, ry: 0.12 },
    ];

    for (let i = 0; i < pileCount; i += 1) {
      const die = createDieMesh(((i % 6) + 1)).mesh;
      const slot = layout[i] || {
        x: (i % 2 === 0 ? -0.56 : 0.56),
        y: 0.38 + Math.floor(i / 2) * 0.58,
        z: i % 2 === 0 ? -0.05 : 0.05,
        ry: i % 2 === 0 ? -0.28 : 0.28,
      };
      die.position.set(slot.x, slot.y, slot.z);
      die.rotation.y = slot.ry;
      root.add(die);
    }

    scene.add(root);
    view.game1PileScenes.push({ mount, scene, camera, renderer, root });
  });
};

updateBoardActionButton = function updateBoardActionButtonOverride() {
  if (!els.boardActionBtn) return;
  const player = getCurrentPlayer();
  const canReroll = Boolean(
    player &&
    canControlGameLocally() &&
    state.hasRolled &&
    !state.isRolling &&
    !state.modal &&
    !state.gameOver &&
    (player.rerollTokens || 0) > 0
  );

  els.boardActionBtn.classList.toggle("hidden", !canReroll);
  els.boardActionBtn.disabled = !canReroll;
  if (canReroll) {
    els.boardActionBtn.innerHTML = `
      <span class="coin-action-face">
        <span class="coin-action-label">重摇</span>
        <strong class="coin-action-count">${player.rerollTokens}</strong>
      </span>
    `;
    els.boardActionBtn.setAttribute("aria-label", `重摇一次，剩余 ${player.rerollTokens} 次`);
    els.boardActionBtn.title = `重摇一次，剩余 ${player.rerollTokens} 次`;
  } else {
    els.boardActionBtn.innerHTML = "";
    els.boardActionBtn.removeAttribute("title");
  }
};

function getAvailablePollutionPiles() {
  return (state.pollutionPiles || []).filter((pile) => !pile.used && pile.count > 0);
}

function getPollutionPileById(pileId) {
  return (state.pollutionPiles || []).find((pile) => pile.id === pileId) || null;
}

function buildGame1MirrorZoneMarkup(zone) {
  const entries = getZoneDisplayEntriesFixed(zone.id);
  return `
    <div class="game1-drop-zone" data-game1-drop-zone="${zone.id}">
      <div class="game1-drop-zone-head">
        <strong>${zone.id} 点 ${zone.name}</strong>
        <span>${formatMoney(zone.rewards[0])} / ${formatMoney(zone.rewards[1])}</span>
      </div>
      <div class="game1-drop-zone-list">
        ${entries.length ? entries.map((entry) => `
          <div class="game1-drop-zone-row ${entry.type === "neutral" ? "neutral" : ""}">
            <span class="game1-zone-mini-dot" style="background:${entry.color}"></span>
            <strong>${entry.label}</strong>
            <span>${entry.count}</span>
          </div>
        `).join("") : '<div class="game1-drop-zone-empty">暂无放置</div>'}
      </div>
    </div>
  `;
}

function queueGame1PileSceneSetup() {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      if (!state.modal || state.modal.type !== "game1") return;
      setupGame1PileScenes();
    });
  });
}

function getGame1ModalZoneUnderPointer(x, y) {
  const zones = [...els.modalBody.querySelectorAll("[data-game1-drop-zone]")];
  const hit = zones.find((node) => {
    const rect = node.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  });
  return hit ? Number(hit.dataset.game1DropZone) : null;
}

function highlightGame1ModalDropZone(x, y) {
  const zoneId = getGame1ModalZoneUnderPointer(x, y);
  els.modalBody.querySelectorAll("[data-game1-drop-zone]").forEach((node) => {
    node.classList.toggle("active", Number(node.dataset.game1DropZone) === zoneId);
  });
}

renderGame1 = function renderGame1MirrorModal(player) {
  const availablePiles = getAvailablePollutionPiles();
  destroyMiniGameThreeScene();
  destroyGame1BoardOverlay();
  destroyGame1PileScenes();
  cleanupGame1Drag();
  els.modalTitle.textContent = "浑水摸鱼：污染区域";
  els.modalBody.innerHTML = `
    <div class="minigame-stack game1-modal game1-modal-grid">
      <div class="game1-panel game1-piles-panel">
        <div class="game1-panel-head">
          <strong>污染骰堆</strong>
          <span>拖动 3D 骰堆到右侧目标区</span>
        </div>
        <div class="pollution-piles pure-piles">
          ${availablePiles.length ? availablePiles.map((pile) => `
            <div class="draggable-pile pile-three-card" data-pile="${pile.id}">
              <div class="pile-three-mount" data-pile-three="${pile.id}" data-pile-count="${pile.count}"></div>
              <div class="pile-count-badge">${pile.count}</div>
            </div>
          `).join("") : `
            <div class="game1-empty-state">
              <strong>污染骰堆已用完</strong>
              <span>本局后续再次触发浑水摸鱼时会直接跳过。</span>
            </div>
          `}
        </div>
      </div>
      <div class="game1-panel game1-zones-panel">
        <div class="game1-panel-head">
          <strong>镜像放置区</strong>
          <span>实时显示当前区域放置信息</span>
        </div>
        <div class="game1-drop-grid">
          ${ZONES.map((zone) => buildGame1MirrorZoneMarkup(zone)).join("")}
        </div>
      </div>
    </div>
  `;

  openModal();

  els.modalBody.querySelectorAll(".draggable-pile").forEach((pile) => {
    if (!canActOnCurrentTurn()) {
      pile.classList.add("disabled");
      return;
    }
    pile.addEventListener("pointerdown", (event) => {
      startGame1Drag(event, player, Number(pile.dataset.pile), pile);
    });
  });

  queueGame1PileSceneSetup();
  maybeBroadcastState();
};

startGame1Drag = function startGame1DragInsideModal(event, player, pileIndex, sourceEl) {
  if (!state.modal || state.modal.type !== "game1") return;
  event.preventDefault();
  state.modal.draggedPileIndex = pileIndex;
  sourceEl.classList.add("dragging");
  view.game1DraggedEl = sourceEl;
  const rect = sourceEl.getBoundingClientRect();
  sourceEl.style.position = "fixed";
  sourceEl.style.left = `${rect.left}px`;
  sourceEl.style.top = `${rect.top}px`;
  sourceEl.style.width = `${rect.width}px`;
  sourceEl.style.height = `${rect.height}px`;
  sourceEl.style.zIndex = "30";
  sourceEl.dataset.dragOriginLeft = String(rect.left);
  sourceEl.dataset.dragOriginTop = String(rect.top);
  sourceEl.dataset.dragOffsetX = String(event.clientX - rect.left);
  sourceEl.dataset.dragOffsetY = String(event.clientY - rect.top);
  moveDraggedPile(event.clientX, event.clientY);
  highlightGame1ModalDropZone(event.clientX, event.clientY);

  const onMove = (moveEvent) => {
    moveDraggedPile(moveEvent.clientX, moveEvent.clientY);
    highlightGame1ModalDropZone(moveEvent.clientX, moveEvent.clientY);
  };

  const onUp = (upEvent) => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    sourceEl.classList.remove("dragging");
    const zoneId = getGame1ModalZoneUnderPointer(upEvent.clientX, upEvent.clientY);
    cleanupGame1Drag();
    if (!zoneId) return;
    if (network.roomId && !network.isHost) {
      requestIntent("game1Pollution", { pileIndex, zoneId });
      closeModal();
      return;
    }
    applyGame1PollutionFixed(pileIndex, zoneId);
  };

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
};

cleanupGame1Drag = function cleanupGame1DragOverride() {
  if (view.game1DraggedEl) {
    view.game1DraggedEl.style.transform = "";
    view.game1DraggedEl.style.position = "";
    view.game1DraggedEl.style.left = "";
    view.game1DraggedEl.style.top = "";
    view.game1DraggedEl.style.width = "";
    view.game1DraggedEl.style.height = "";
    view.game1DraggedEl.style.zIndex = "";
    view.game1DraggedEl.classList.remove("dragging");
    delete view.game1DraggedEl.dataset.dragOriginLeft;
    delete view.game1DraggedEl.dataset.dragOriginTop;
    delete view.game1DraggedEl.dataset.dragOffsetX;
    delete view.game1DraggedEl.dataset.dragOffsetY;
  }
  view.game1DraggedEl = null;
  if (els.modalBody) {
    els.modalBody.querySelectorAll("[data-game1-drop-zone]").forEach((node) => node.classList.remove("active"));
  }
  if (view.game1Overlay) {
    view.game1Overlay.querySelectorAll(".game1-zone-hotspot").forEach((node) => node.classList.remove("active"));
  }
  if (state.modal?.type === "game1") {
    state.modal.draggedPileIndex = null;
  }
};

setupGame1PileScenes = function setupGame1PileScenesStableOverride() {
  destroyGame1PileScenes();
  const mounts = [...els.modalBody.querySelectorAll("[data-pile-three]")];
  mounts.forEach((mount) => {
    mount.innerHTML = "";
    const rect = mount.getBoundingClientRect();
    const width = Math.max(160, Math.round(rect.width || mount.clientWidth || 160));
    const height = Math.max(176, Math.round(rect.height || mount.clientHeight || 176));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 100);
    camera.position.set(0, 4.4, 6.8);
    camera.lookAt(0, 0.85, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 1.7);
    const key = new THREE.DirectionalLight(0xfff3dc, 2.05);
    key.position.set(3.4, 6.6, 4.8);
    scene.add(ambient, key);

    const root = new THREE.Group();
    const pileCount = Number(mount.dataset.pileCount);
    const layout = [
      { x: -0.78, y: 0.34, z: -0.14, ry: -0.44 },
      { x: 0, y: 0.34, z: 0.04, ry: 0.08 },
      { x: 0.78, y: 0.34, z: 0.14, ry: 0.38 },
      { x: -0.42, y: 0.96, z: 0.08, ry: -0.28 },
      { x: 0.42, y: 0.96, z: -0.04, ry: 0.24 },
      { x: 0, y: 1.58, z: 0.02, ry: 0.16 },
    ];

    for (let i = 0; i < pileCount; i += 1) {
      const die = createDieMesh(((i % 6) + 1)).mesh;
      const slot = layout[i] || {
        x: (i % 3) * 0.64 - 0.64,
        y: 0.34 + Math.floor(i / 3) * 0.62,
        z: ((i % 2) - 0.5) * 0.12,
        ry: (i % 2 === 0 ? -0.22 : 0.22),
      };
      die.position.set(slot.x, slot.y, slot.z);
      die.rotation.y = slot.ry;
      root.add(die);
    }

    scene.add(root);
    renderer.render(scene, camera);
    view.game1PileScenes.push({ mount, scene, camera, renderer, root });
  });
};

handleResize = function handleResizeOverride() {
  const width = els.threeMount.clientWidth || 900;
  const height = els.threeMount.clientHeight || 900;
  view.camera.aspect = width / height;
  view.camera.updateProjectionMatrix();
  view.renderer.setSize(width, height);

  if (view.modalThree) {
    const modalWidth = view.modalThree.mount.clientWidth || 320;
    const modalHeight = view.modalThree.mount.clientHeight || 220;
    view.modalThree.camera.aspect = modalWidth / modalHeight;
    view.modalThree.camera.updateProjectionMatrix();
    view.modalThree.renderer.setSize(modalWidth, modalHeight);
  }

  view.game1PileScenes.forEach((entry) => {
    const rect = entry.mount.getBoundingClientRect();
    const sceneWidth = Math.max(160, Math.round(rect.width || entry.mount.clientWidth || 160));
    const sceneHeight = Math.max(176, Math.round(rect.height || entry.mount.clientHeight || 176));
    entry.camera.aspect = sceneWidth / sceneHeight;
    entry.camera.updateProjectionMatrix();
    entry.renderer.setSize(sceneWidth, sceneHeight);
  });
};

applyGame1PollutionFixed = function applyGame1PollutionFixedOverride(pileIndex, zoneId, actorId = getLocalActorId()) {
  if (!canActOnCurrentTurn(actorId)) return;
  const player = getCurrentPlayer();
  if (!player || !state.modal || state.modal.type !== "game1") return;
  const pile = getPollutionPileById(pileIndex);
  if (!pile || pile.used) return;
  const count = Number(pile.count);
  if (!Number.isFinite(count) || count <= 0) return;
  pile.used = true;
  state.neutralPlacements[zoneId] = Number(state.neutralPlacements[zoneId] || 0) + count;
  addLog(player.name, `在游戏1中把 ${count} 枚无效骰子拖入 ${ZONES[zoneId - 1].name}。`);
  closeModal();
  advanceTurn();
};

renderZoneInfoOverlayEnhanced = function renderZoneInfoOverlayEnhancedHoverCard() {
  const positions = [
    { left: "50%", top: "12%" },
    { left: "79%", top: "31%" },
    { left: "79%", top: "69%" },
    { left: "50%", top: "88%" },
    { left: "21%", top: "69%" },
    { left: "21%", top: "31%" },
  ];

  els.zoneInfoOverlay.innerHTML = ZONES.map((zone, index) => {
    const entries = getZoneDisplayEntriesFixed(zone.id);
    const rankingIds = new Set(getZoneRanking(zone.id).map((entry) => `player-${entry.player.id}`));

    return `
      <div class="zone-info-card" style="left:${positions[index].left}; top:${positions[index].top};">
        <div class="zone-info-title">${zone.id}点 ${zone.name}</div>
        <div class="zone-reward-line">
          <span>第1名 ${formatMoney(zone.rewards[0])}</span>
          <span>第2名 ${formatMoney(zone.rewards[1])}</span>
        </div>
        <div class="zone-info-list">
          ${entries.length ? entries.map((entry) => `
            <div class="zone-info-row ${rankingIds.has(entry.id) ? "valid" : "invalid"} ${entry.type === "neutral" ? "neutral" : ""}">
              <span class="zone-player-dot" style="background:${entry.color}"></span>
              <strong style="color:${entry.color}">
                ${entry.label}
                ${entry.type === "neutral" ? '<span class="neutral-badge" title="中立干扰堆只参与重复数量判定，不参与第一名或第二名奖励。">干扰</span>' : ""}
              </strong>
              <span>${entry.count} 枚</span>
            </div>
            ${entry.type === "neutral" ? `<div class="zone-info-note" title="${entry.description}">${entry.description}</div>` : ""}
          `).join("") : '<div class="zone-info-empty">暂无放置</div>'}
        </div>
        <div class="zone-hover-card">
          <div class="zone-hover-title">${zone.id}点 ${zone.name}</div>
          <div class="zone-hover-reward">第1名 ${formatMoney(zone.rewards[0])} / 第2名 ${formatMoney(zone.rewards[1])}</div>
          <div class="zone-hover-list">
            ${entries.length ? entries.map((entry) => `
              <div class="zone-hover-row ${entry.type === "neutral" ? "neutral" : ""}">
                <span class="zone-player-dot" style="background:${entry.color}"></span>
                <strong>${entry.label}</strong>
                <span>${entry.count} 枚</span>
              </div>
              ${entry.type === "neutral" ? `<div class="zone-hover-note">${entry.description || "只参与重复数量判定，不参与奖励。"}</div>` : ""}
            `).join("") : '<div class="zone-hover-empty">暂无放置</div>'}
          </div>
        </div>
      </div>
    `;
  }).join("");
};

renderZoneInfoOverlayEnhanced = function renderZoneInfoOverlayEnhancedRestore() {
  const positions = [
    { left: "50%", top: "12%" },
    { left: "79%", top: "31%" },
    { left: "79%", top: "69%" },
    { left: "50%", top: "88%" },
    { left: "21%", top: "69%" },
    { left: "21%", top: "31%" },
  ];

  els.zoneInfoOverlay.innerHTML = ZONES.map((zone, index) => {
    const entries = getZoneDisplayEntriesFixed(zone.id);
    const rankingIds = new Set(getZoneRanking(zone.id).map((entry) => `player-${entry.player.id}`));

    return `
      <div class="zone-info-card" style="left:${positions[index].left}; top:${positions[index].top};">
        <div class="zone-info-title">${zone.id}点 ${zone.name}</div>
        <div class="zone-reward-line">
          <span>第1名 ${formatMoney(zone.rewards[0])}</span>
          <span>第2名 ${formatMoney(zone.rewards[1])}</span>
        </div>
        <div class="zone-info-list">
          ${entries.length ? entries.map((entry) => `
            <div class="zone-info-row ${rankingIds.has(entry.id) ? "valid" : "invalid"} ${entry.type === "neutral" ? "neutral" : ""}">
              <span class="zone-player-dot" style="background:${entry.color}"></span>
              <strong style="color:${entry.color}">
                ${entry.label}
                ${entry.type === "neutral" ? '<span class="neutral-badge" title="中立干扰堆只参与重复数量判定，不参与第一名或第二名奖励。">干扰</span>' : ""}
              </strong>
              <span>${entry.count} 枚</span>
            </div>
            ${entry.type === "neutral" ? `<div class="zone-info-note" title="${entry.description}">${entry.description}</div>` : ""}
          `).join("") : '<div class="zone-info-empty">暂无放置</div>'}
        </div>
      </div>
    `;
  }).join("");
};
