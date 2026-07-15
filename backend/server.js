require("dotenv").config();
const express = require("express");
const cors = require("cors");

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

// Health check — pings Ollama Cloud
app.get("/health", async (req, res) => {
  try {
    const headers = {};
    if (OLLAMA_API_KEY) headers.Authorization = OLLAMA_API_KEY; // no Bearer prefix

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

// Chat endpoint
app.post("/chat", async (req, res) => {
  console.log("🔍 FULL BODY:", JSON.stringify(req.body));

  const message = req.body.message;
  const modelType = req.body.modelType || "glm-5.2";
  const temperature = req.body.temperature || 0.7;
  const history = req.body.messages || [];

  console.log("🔍 modelType from frontend:", modelType);
  console.log("🔍 message:", message);
  console.log("🔍 history count:", history.length);

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

    const messages =
      Array.isArray(history) && history.length > 0
        ? [...history, { role: "user", content: message.trim() }]
        : [{ role: "user", content: message.trim() }];

    console.log("🚀 Sending model to Ollama Cloud:", model);

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
            res.write(
              `data: ${JSON.stringify({ type: "chunk", text: content })}\n\n`
            );
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
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          text: err.message || "Processing failed",
        })}\n\n`
      );
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
