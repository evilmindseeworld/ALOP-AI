require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;

const fetch = globalThis.fetch;
if (!fetch) {
  console.error("❌ Node 18+ is required for native fetch");
  process.exit(1);
}

const OLLAMA_HOST = (process.env.OLLAMA_HOST || "https://api.ollama.com").replace(/\/$/, "");
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || "";

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);


app.use(express.json({ limit: "20mb" }));

// File upload handler - up to 5 images, 10MB each
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Health check
app.get("/health", async (req, res) => {
  try {
    const headers = {};
    if (OLLAMA_API_KEY) headers.Authorization = OLLAMA_API_KEY;

    const r = await fetch(`${OLLAMA_HOST}/api/tags`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });

    if (!r.ok) throw new Error(`Ollama returned ${r.status}`);

    res.json({
      status: "premium",
      service: "Cloud AI Assistant",
      ollama: OLLAMA_HOST,
    });
  } catch (err) {
    res.json({
      status: "degraded",
      error: err.message || "Ollama Cloud connection failed",
      ollama: OLLAMA_HOST,
    });
  }
});

// API dock endpoint
app.get("/api/dock", (req, res) => {
  res.json({
    active: 0,
    requests: [],
  });
});

// Chat endpoint with file upload support
app.post("/chat", upload.array("files", 5), async (req, res) => {
  const {
    message,
    modelType = "glm-5.2",
    temperature = 0.7,
    messages: history = [],
  } = req.body;

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Valid message required" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no",
  });

  const startTime = Date.now();

  try {
    const model = modelType;

    const systemMessage = {
      role: "system",
      content: `You are ${model}, an AI assistant. Always identify yourself as ${model} when asked about your identity. Never claim to be Gemini, GPT, Claude, or any other model.`
    };

    const trimmedHistory = Array.isArray(history)
      ? history.slice(-10).map(m => ({ role: m.role, content: m.content }))
      : [];

    // Convert uploaded images to base64 for Ollama vision models
    const images = (req.files || [])
      .filter(f => f.mimetype.startsWith("image/"))
      .map(f => f.buffer.toString("base64"));

    const userMessage = {
      role: "user",
      content: message.trim(),
    };

    if (images.length > 0) {
      userMessage.images = images;
    }

    const messages = [systemMessage, ...trimmedHistory, userMessage];

    const headers = {
      "Content-Type": "application/json",
      "User-Agent": "CloudAI-Assistant/1.0",
    };
    if (OLLAMA_API_KEY) headers.Authorization = OLLAMA_API_KEY;

    const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        stream: true,
        options: {
          temperature: parseFloat(temperature) || 0.7,
        },
        messages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Ollama Cloud Error ${response.status}: ${errorText}`);
    }

    if (!response.body) {
      throw new Error("Ollama Cloud response has no body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const data = JSON.parse(trimmed);
          const content = data.message?.content || "";

          if (content) {
            res.write(`data: ${JSON.stringify({ type: "chunk", text: content })}\n\n`);
            if (res.flush) res.flush();
          }
        } catch (parseError) {
          console.warn("⚠️ Could not parse line:", trimmed);
        }
      }
    }

    res.write(
      `data: ${JSON.stringify({
        type: "end",
        stats: {
          duration: Date.now() - startTime,
          model,
        },
      })}\n\n`
    );
    res.end();
  } catch (err) {
    console.error("❌ Request failed:", err);

    if (!res.headersSent) {
      return res.status(500).json({ error: err.message || "Processing failed" });
    }

    try {
      res.write(`data: ${JSON.stringify({ type: "error", text: err.message || "Processing failed" })}\n\n`);
      res.end();
    } catch (writeError) {
      console.error("Failed to send error to client:", writeError);
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Cloud AI Assistant`);
  console.log(`📡 Proxy: http://0.0.0.0:${PORT}`);
  console.log(`☁️ Ollama Cloud host: ${OLLAMA_HOST}`);
  console.log(`🔐 API Key: ${OLLAMA_API_KEY ? "CONFIGURED" : "MISSING"}`);
});
