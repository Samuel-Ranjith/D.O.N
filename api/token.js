export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "OPENAI_API_KEY is not set on the server" });
    return;
  }
  try {
    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        voice: "verse",
        instructions:
          "You are a friendly sales-training voice assistant. Keep responses short and conversational.",
        input_audio_transcription: { model: "gpt-4o-transcribe" },
        turn_detection: { type: "server_vad" }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      res.status(500).json({ error: "Failed to create session", details: data });
      return;
    }
    const ephemeralKey = data?.client_secret?.value;
    const model = data?.model;
    res.status(200).json({ ephemeralKey, model });
  } catch (err) {
    res.status(500).json({ error: "Unexpected error" });
  }
}