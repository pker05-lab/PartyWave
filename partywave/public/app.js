let ws = null;
let myId = null;
let hostId = null;
let isHost = false;
let partyCode = null;
let player = null;
let provider = "youtube";
let youtubeReady = false;
let hostCapture = null;
let remoteAudio = document.getElementById("remoteAudio");
const peers = new Map();
const members = new Map();

const $ = id => document.getElementById(id);
const show = id => document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === id));
const toast = msg => {
  $("toast").textContent = msg; $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2200);
};

window.onYouTubeIframeAPIReady = () => { youtubeReady = true; };

$("createBtn").onclick = () => show("create");
$("joinBtn").onclick = () => show("join");
document.querySelectorAll("[data-back]").forEach(b => b.onclick = () => show("home"));

$("confirmCreate").onclick = async () => {
  const name = $("hostName").value.trim() || "Host";
  const res = await fetch("/api/create", { method:"POST" });
  const data = await res.json();
  connect(data.code, name, true);
};

$("confirmJoin").onclick = () => {
  const code = $("partyCode").value.trim().toUpperCase();
  const name = $("guestName").value.trim() || "Guest";
  if (!/^[A-Z2-9]{8}$/.test(code)) return toast("Enter a valid 8-character code.");
  connect(code, name, false);
};

function connect(code, name, host) {
  partyCode = code;
  isHost = host;
  show("room");
  $("roomCode").textContent = code;
  $("roleBadge").textContent = host ? "HOST" : "GUEST";
  $("hostControls").classList.toggle("hidden", !host);
  $("guestNote").classList.toggle("hidden", host);
  $("connectionText").textContent = "Connecting…";
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/${code}`);
  ws.onopen = () => {
    $("connectionText").textContent = "Connected";
    $("connectionText").parentElement.classList.add("online");
  };
  ws.onclose = () => {
    $("connectionText").textContent = "Disconnected";
    $("connectionText").parentElement.classList.remove("online");
  };
  ws.onerror = () => toast("Could not connect to this party.");
  ws.onmessage = async e => {
    const msg = JSON.parse(e.data);
    await handleMessage(msg, name, host);
  };
}

async function handleMessage(msg, name, host) {
  if (msg.type === "welcome") {
    myId = msg.id;
    hostId = msg.hostId;
    send({ type:"set-name", name });
    if (host) send({ type:"claim-host" });
    if (msg.state) applyState(msg.state);
    return;
  }
  if (msg.type === "host-claimed") {
    hostId = msg.id;
    isHost = true;
    $("roleBadge").textContent = "HOST";
    $("hostControls").classList.remove("hidden");
    $("guestNote").classList.add("hidden");
    return;
  }
  if (msg.type === "host-changed") {
    hostId = msg.hostId;
    if (hostId !== myId) {
      isHost = false;
      $("roleBadge").textContent = "GUEST";
      $("hostControls").classList.add("hidden");
      $("guestNote").classList.remove("hidden");
    }
    return;
  }
  if (msg.type === "member") {
    members.set(msg.id, msg.name || "Guest");
    renderMembers(msg.count);
    return;
  }
  if (msg.type === "count") {
    renderMembers(msg.count);
    return;
  }
  if (msg.type === "state") {
    applyState(msg.state);
    return;
  }
  if (msg.type === "signal") {
    await handleSignal(msg.from, msg.data);
    return;
  }
  if (msg.type === "host-left") {
    toast("The host left. The room is now inactive.");
    return;
  }
  if (msg.type === "kicked") {
    toast("You were removed from the party.");
    leave();
  }
}

function send(obj) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function renderMembers(count) {
  $("memberCount").textContent = count ?? members.size;
  const list = $("memberList");
  list.innerHTML = "";
  members.forEach((name, id) => {
    const el = document.createElement("div");
    el.className = "member";
    el.innerHTML = `<span class="avatar">${escapeHtml((name[0]||"?").toUpperCase())}</span><span>${escapeHtml(name)}</span>`;
    list.appendChild(el);
  });
  if (isHost && myId && !members.has(myId)) {
    const el = document.createElement("div");
    el.className = "member";
    el.innerHTML = `<span class="avatar">H</span><span>${escapeHtml($("hostName").value || "Host")} · host</span>`;
    list.prepend(el);
  }
}

function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}

function applyState(state) {
  if (!state) return;
  $("roomTitle").textContent = state.title || "Untitled Party";
  $("nowTitle").textContent = state.title || "No source selected";
  $("providerLabel").textContent = (state.provider || "youtube").replace("-", " ").toUpperCase();
  provider = state.provider || "youtube";

  if (provider === "youtube" && state.source) {
    $("videoWrap").classList.remove("hidden");
    $("sourceEmpty").classList.add("hidden");
    ensureYouTube(state.source);
  } else {
    $("videoWrap").classList.add("hidden");
    $("sourceEmpty").classList.remove("hidden");
    $("emptyText").textContent = provider === "spotify"
      ? "Spotify metadata can be selected here, but Spotify does not permit this app to rebroadcast or synchronize its recordings."
      : provider === "youtube-music"
        ? "Use a YouTube URL in the YouTube tab for browser playback. YouTube Music itself does not provide a general party-broadcast API."
        : "The host hasn't started a source yet.";
  }
}

function youtubeId(input) {
  if (!input) return null;
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0];
    if (u.hostname.includes("youtube.com")) return u.searchParams.get("v") || u.pathname.split("/").pop();
  } catch {}
  return null;
}

function ensureYouTube(videoId) {
  if (!youtubeReady) return setTimeout(() => ensureYouTube(videoId), 250);
  if (!player) {
    player = new YT.Player("youtubePlayer", {
      videoId,
      playerVars:{playsinline:1,controls:1,rel:0},
      events:{onReady:()=>syncYouTube()}
    });
  } else {
    player.loadVideoById(videoId);
  }
}

function syncYouTube() {
  if (!player) return;
  const state = window.__partyState;
  if (!state) return;
  if (state.currentTime != null) player.seekTo(state.currentTime, true);
  if (state.playing) player.playVideo(); else player.pauseVideo();
}

$("playBtn").onclick = () => {
  if (!isHost) return toast("Only the host can control playback.");
  const playing = player && player.getPlayerState?.() === YT.PlayerState.PLAYING;
  const currentTime = player?.getCurrentTime?.() || 0;
  sendState({ playing: !playing, currentTime });
};

$("loadSourceBtn").onclick = () => {
  if (!isHost) return;
  const input = $("sourceInput").value.trim();
  if (provider === "youtube") {
    const id = youtubeId(input);
    if (!id) return toast("Paste a valid YouTube URL or 11-character video ID.");
    sendState({
      provider:"youtube",
      source:id,
      title:"YouTube source",
      currentTime:0,
      playing:false
    });
  } else {
    sendState({
      provider,
      source:input || null,
      title: provider === "spotify" ? "Spotify source" : "YouTube Music source",
      currentTime:0,
      playing:false
    });
  }
};

document.querySelectorAll(".provider").forEach(btn => btn.onclick = () => {
  document.querySelectorAll(".provider").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active");
  provider = btn.dataset.provider;
  $("sourceInput").placeholder = provider === "youtube" ? "Paste a YouTube URL or video ID" : "Paste a provider URL / URI";
  $("providerNotice").textContent = provider === "spotify"
    ? "Spotify: Web Playback requires Premium and Spotify's policies prohibit broadcasting/non-interactive synchronized streaming. This prototype intentionally does not relay Spotify audio."
    : provider === "youtube-music"
      ? "YouTube Music: use the YouTube provider for embedded playback. Audio broadcast can still use browser tab capture."
      : "YouTube: embedded playback is supported. For multi-phone audio, start host audio broadcast and share tab audio.";
});

function sendState(partial) {
  window.__partyState = {...(window.__partyState||{}), ...partial};
  send({type:"state",state:window.__partyState});
  applyState(window.__partyState);
}

setInterval(() => {
  if (isHost && player && player.getCurrentTime) {
    const state = window.__partyState;
    if (state?.playing) send({type:"state",state:{...state,currentTime:player.getCurrentTime()}});
  }
}, 2500);

async function startCapture() {
  if (!isHost) return;
  try {
    hostCapture = await navigator.mediaDevices.getDisplayMedia({
      video:true,
      audio:true
    });
    const audioTracks = hostCapture.getAudioTracks();
    if (!audioTracks.length) {
      hostCapture.getTracks().forEach(t=>t.stop());
      hostCapture = null;
      return toast("No tab/window audio was shared. Choose a source and enable Share tab audio.");
    }
    $("captureBtn").disabled = true;
    $("stopCaptureBtn").disabled = false;
    $("audioState").textContent = "Broadcasting host audio";
    for (const [id] of peers) {
      const pc = peers.get(id);
      const sender = pc.getSenders().find(s => s.track?.kind === "audio");
      if (sender) await sender.replaceTrack(audioTracks[0]);
      else pc.addTrack(audioTracks[0], hostCapture);
    }
    audioTracks[0].onended = stopCapture;
    toast("Host audio broadcast started.");
  } catch {
    toast("Screen/audio sharing was cancelled.");
  }
}

async function stopCapture() {
  if (hostCapture) hostCapture.getTracks().forEach(t=>t.stop());
  hostCapture = null;
  $("captureBtn").disabled = false;
  $("stopCaptureBtn").disabled = true;
  $("audioState").textContent = "Host broadcast stopped";
  for (const [,pc] of peers) {
    pc.getSenders().filter(s=>s.track?.kind==="audio").forEach(s=>pc.removeTrack(s));
  }
}

$("captureBtn").onclick = startCapture;
$("stopCaptureBtn").onclick = stopCapture;

$("enableAudioBtn").onclick = async () => {
  try { await remoteAudio.play(); $("audioState").textContent = "Audio enabled"; }
  catch { toast("Tap again after joining."); }
};

async function makePeer(targetId, initiator) {
  if (peers.has(targetId)) return peers.get(targetId);
  const pc = new RTCPeerConnection({
    iceServers:[
      {urls:"stun:stun.l.google.com:19302"},
      {urls:"stun:stun.cloudflare.com:3478"}
    ]
  });
  peers.set(targetId, pc);

  if (isHost && hostCapture) {
    const track = hostCapture.getAudioTracks()[0];
    if (track) pc.addTrack(track, hostCapture);
  }

  pc.onicecandidate = e => {
    if (e.candidate) send({type:"signal",target:targetId,data:{candidate:e.candidate}});
  };
  pc.ontrack = e => {
    if (e.streams[0]) {
      remoteAudio.srcObject = e.streams[0];
      remoteAudio.play().catch(()=>{});
      $("audioState").textContent = "Receiving host audio";
    }
  };
  pc.onconnectionstatechange = () => {
    if (["failed","closed","disconnected"].includes(pc.connectionState)) {
      peers.delete(targetId);
    }
  };

  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({type:"signal",target:targetId,data:{description:pc.localDescription}});
  }
  return pc;
}

async function handleSignal(from, data) {
  let pc = peers.get(from);

  // If we're the host and the guest sends us an offer,
  // create the peer connection as the receiver.
  if (!pc) {
    pc = await makePeer(from, false);
  }

  if (data.description) {
    await pc.setRemoteDescription(data.description);

    if (data.description.type === "offer") {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      send({
        type: "signal",
        target: from,
        data: {
          description: pc.localDescription
        }
      });
    }
  }

  if (data.candidate) {
    try {
      await pc.addIceCandidate(data.candidate);
    } catch (err) {
      console.warn("ICE candidate error:", err);
    }
  }
}

function connectPeerForGuest() {
  if (!isHost && hostId && hostId !== myId) makePeer(hostId, false);
}

// Server does not explicitly broadcast a roster. Guests initiate a lightweight ping
// to the known host once they receive host-changed; the host sees their signal.
setInterval(connectPeerForGuest, 1000);

$("copyCode").onclick = async () => {
  await navigator.clipboard?.writeText(partyCode);
  toast("Party code copied.");
};

$("shareBtn").onclick = async () => {
  const url = `${location.origin}/?party=${partyCode}`;
  if (navigator.share) {
    await navigator.share({title:"Join my PartyWave",text:`Join my party with code ${partyCode}`,url});
  } else {
    await navigator.clipboard?.writeText(`${partyCode} — ${url}`);
    toast("Invite copied.");
  }
};

$("leaveBtn").onclick = leave;

function leave() {
  stopCapture();
  peers.forEach(pc=>pc.close());
  peers.clear();
  ws?.close();
  ws = null; partyCode=null; myId=null; hostId=null; isHost=false;
  show("home");
  $("connectionText").textContent = "Offline";
  $("connectionText").parentElement.classList.remove("online");
}

const params = new URLSearchParams(location.search);
if (params.get("party")) {
  $("partyCode").value = params.get("party").toUpperCase().slice(0,8);
  show("join");
}
