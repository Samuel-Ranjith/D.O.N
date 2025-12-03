// DOM references
const connectBtn = document.getElementById("connect-btn");
const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");
const scenarioSelect = document.getElementById("scenario-select");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const remoteAudio = document.getElementById("remoteAudio");
const logEl = document.getElementById("log");

// Realtime vars
let pc = null;
let dc = null;
let localStream = null;
let micTrack = null;
let isConnected = false;

// Helpers
function appendLog(role, text) {
  const div = document.createElement("div");
  div.classList.add("log-line", role);
  div.textContent = (role === "user" ? "YOU: " : role === "assistant" ? "AI: " : "[system] ") + text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(text, color) {
  statusText.textContent = text;
  statusDot.style.background = color;
}

// -------------------------
// MAIN CONNECT FUNCTION
// -------------------------

async function connectRealtime() {
  if (isConnected) return;

  setStatus("Requesting token...", "#facc15");
  appendLog("system", "Requesting ephemeral key from /api/token...");

  let data;
  try {
    const res = await fetch("/api/token");
    data = await res.json();
    if (!res.ok) throw new Error("Key fetch failed");
  } catch (err) {
    appendLog("system", "Token error: " + err.message);
    setStatus("Error", "#ef4444");
    return;
  }

  const { ephemeralKey, model } = data;
  appendLog("system", "Got ephemeral key. Creating WebRTC connection...");
  await startWebRTC(ephemeralKey, model);
}

// -----------------------------
// START WEBRTC SESSION
// -----------------------------

async function startWebRTC(ephemeralKey, model) {
  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  pc.ontrack = (event) => {
    remoteAudio.srcObject = event.streams[0];
    appendLog("system", "Attached remote audio track.");
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      setStatus("Connected", "#22c55e");
      appendLog("system", "Connected to Realtime API.");
      startBtn.disabled = false;
      stopBtn.disabled = false;
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
  micTrack.enabled = false;
  pc.addTrack(micTrack, localStream);

  // DataChannel
  dc = pc.createDataChannel("oai-events");

  dc.onopen = () => {
    appendLog("system", "DataChannel open.");

    const scenario = scenarioSelect.value;
    const instructions = {
      default: "You are a friendly conversational AI.",
      angry_customer: "Act as an angry customer complaining about service.",
      sales_pitch: "Act as a curious customer evaluating a product.",
      price_resistance: "Act as a customer pushing back on price.",
      service_complaint: "Act as a customer reporting a service issue.",
      landscaping_quote: "Act as a customer unhappy with a landscaping quote."
    }[scenario];

    dc.send(
      JSON.stringify({
        type: "session.update",
        session: {
          voice: "verse",
          modalities: ["audio", "text"],
          instructions,
          input_audio_transcription: { model: "gpt-4o-transcribe" },
          turn_detection: { type: "server_vad" }
        }
      })
    );

    appendLog("system", "Sent session.update.");
  };

  dc.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);

      if (msg.type === "response.output_text.delta") {
        appendLog("assistant", msg.delta);
      }

      if (msg.type === "conversation.item.input_audio_transcription.completed") {
        appendLog("user", msg.transcript);
      }
    } catch (e) {}
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const ans = await fetch(
    `https://api.openai.com/v1/realtime?model=${model}`,
    {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        "Content-Type": "application/sdp"
      }
    }
  );

  const answerSdp = await ans.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

  isConnected = true;
  appendLog("system", "SDP handshake complete.");
}

// -------------------------
// TALKING CONTROL
// -------------------------

function startTalking() {
  micTrack.enabled = true;
  setStatus("Listening...", "#facc15");
  appendLog("system", "Microphone ON.");
}

function stopTalking() {
  micTrack.enabled = false;
  setStatus("Connected", "#22c55e");
  appendLog("system", "Microphone OFF.");
}

// -------------------------
// EVENT LISTENERS
// -------------------------

connectBtn.onclick = () => {
  if (!isConnected) connectRealtime();
};

startBtn.onclick = startTalking;
stopBtn.onclick = stopTalking;
