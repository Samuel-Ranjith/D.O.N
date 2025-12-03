// script.js – Minimal Realtime WebRTC + Push-to-Talk

const connectBtn = document.getElementById("connect-btn");
const micBtn = document.getElementById("mic-btn");
const statusText = document.getElementById("status-text");
const statusDot = document.getElementById("status-dot");
const logEl = document.getElementById("log");

let pc = null; // RTCPeerConnection
let dc = null; // DataChannel "oai-events"
let localStream = null;
let micTrack = null;
let isConnected = false;
let isTalking = false;

function appendLog(role, text) {
  if (!logEl) return;
  const div = document.createElement("div");
  div.classList.add("log-line", role);
  let prefix = "";
  if (role === "user") prefix = "YOU: ";
  if (role === "assistant") prefix = "AI: ";
  if (role === "system") prefix = "[system] ";
  div.textContent = prefix + text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(text, color) {
  statusText.textContent = text;
  if (color && statusDot) statusDot.style.backgroundColor = color;
}

// -------------------------------
// Connection setup
// -------------------------------

async function connectRealtime() {
  if (isConnected) {
    appendLog("system", "Already connected.");
    return;
  }

  setStatus("Requesting token...", "#f97316");
  appendLog("system", "Requesting ephemeral key from /api/token...");

  let ephemeralKey;
  let model;

  try {
    const res = await fetch("/api/token");
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Failed to fetch token");
    }

    ephemeralKey = data.ephemeralKey;
    model = data.model || "gpt-4o-realtime-preview-2024-12-17";

    if (!ephemeralKey) {
      throw new Error("No ephemeralKey returned from /api/token");
    }
  } catch (err) {
    console.error(err);
    appendLog("system", "Error: " + err.message);
    setStatus("Error", "#ef4444");
    return;
  }

  appendLog("system", "Got ephemeral key. Creating WebRTC connection...");

  try {
    await startWebRTC(ephemeralKey, model);
    isConnected = true;
    setStatus("Connected", "#22c55e");
    micBtn.disabled = false;
    appendLog("system", "Connected to Realtime API. Hold the mic button to talk.");
    connectBtn.textContent = "Disconnect";
  } catch (err) {
    console.error(err);
    appendLog("system", "Failed to establish WebRTC connection: " + err.message);
    setStatus("Error", "#ef4444");
  }
}

async function startWebRTC(ephemeralKey, model) {
  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  pc.onconnectionstatechange = () => {
    appendLog("system", "PeerConnection state = " + pc.connectionState);
    if (
      pc.connectionState === "disconnected" ||
      pc.connectionState === "failed" ||
      pc.connectionState === "closed"
    ) {
      setStatus("Disconnected", "#ef4444");
      micBtn.disabled = true;
      isConnected = false;
      connectBtn.textContent = "Connect";
    }
  };

  // Remote audio from model
  const remoteAudio = new Audio();
  remoteAudio.autoplay = true;

  pc.ontrack = (event) => {
    const [stream] = event.streams;
    if (event.track.kind === "audio") {
      appendLog("system", "Received remote audio track.");
      remoteAudio.srcObject = stream;
    }
  };

  // Local mic
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1
    }
  });

  micTrack = localStream.getAudioTracks()[0];
  micTrack.enabled = false; // Only enabled when user holds mic button
  pc.addTrack(micTrack, localStream);

  // DataChannel for events
  dc = pc.createDataChannel("oai-events");

  dc.addEventListener("open", () => {
    appendLog("system", "DataChannel open.");

    const sessionUpdate = {
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        voice: "verse",
        input_audio_transcription: {
          model: "gpt-4o-transcribe"
        },
        turn_detection: {
          type: "server_vad"
        }
      }
    };

    dc.send(JSON.stringify(sessionUpdate));
    appendLog("system", "Sent session.update.");
  });

  dc.addEventListener("close", () => {
    appendLog("system", "DataChannel closed.");
  });

  dc.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleServerEvent(msg);
    } catch (_) {
      // ignore non-JSON
    }
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const response = await fetch(
    `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
    {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        "Content-Type": "application/sdp"
      }
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SDP exchange failed: ${response.status} ${text}`);
  }

  const answerSdp = await response.text();
  await pc.setRemoteDescription({
    type: "answer",
    sdp: answerSdp
  });

  appendLog("system", "SDP handshake complete.");
}

// -------------------------------
// Handling Realtime server events
// -------------------------------

function handleServerEvent(event) {
  switch (event.type) {
    case "response.output_text.delta": {
      const delta = event.delta || "";
      if (delta.trim()) appendAssistantText(delta);
      break;
    }
    case "conversation.item.input_audio_transcription.completed": {
      const transcript = event.transcript || "";
      if (transcript.trim()) appendUserText(transcript);
      break;
    }
    case "response.completed": {
      appendLog("system", "Assistant response completed.");
      break;
    }
    default:
      break;
  }
}

function appendUserText(text) {
  appendLog("user", text);
}

function appendAssistantText(text) {
  appendLog("assistant", text);
}

// -------------------------------
// Push-to-talk controls
// -------------------------------

function startTalking() {
  if (!micTrack || !isConnected) return;
  if (isTalking) return;

  micTrack.enabled = true;
  isTalking = true;
  setStatus("Talking...", "#facc15");
}

function stopTalking() {
  if (!micTrack || !isConnected) return;
  if (!isTalking) return;

  micTrack.enabled = false;
  isTalking = false;
  setStatus("Connected", "#22c55e");
}

// -------------------------------
// Cleanup
// -------------------------------

function cleanup() {
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  if (dc) {
    try {
      dc.close();
    } catch (_) {}
    dc = null;
  }
  if (pc) {
    try {
      pc.close();
    } catch (_) {}
    pc = null;
  }
  isConnected = false;
  isTalking = false;
  micBtn.disabled = true;
  setStatus("Disconnected", "#ef4444");
  connectBtn.textContent = "Connect";
  appendLog("system", "Cleaned up connection.");
}

// -------------------------------
// Wire up UI events
// -------------------------------

connectBtn.addEventListener("click", () => {
  if (!isConnected) {
    connectRealtime();
  } else {
    cleanup();
  }
});

micBtn.addEventListener("mousedown", startTalking);
micBtn.addEventListener("touchstart", (e) => {
  e.preventDefault();
  startTalking();
});

["mouseup", "mouseleave"].forEach((ev) => {
  micBtn.addEventListener(ev, stopTalking);
});

micBtn.addEventListener("touchend", (e) => {
  e.preventDefault();
  stopTalking();
});

window.addEventListener("beforeunload", () => {
  cleanup();
});
