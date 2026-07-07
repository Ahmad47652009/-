import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;
const STATS_FILE = path.join(process.cwd(), "stats.json");

// Middleware to parse JSON
app.use(express.json());

// Load or initialize persistent stats data
interface StatsData {
  totalVisitors: number;
  visitedSessions: string[];
}

const DEFAULT_STATS: StatsData = {
  totalVisitors: 342912, // High-quality starting base count
  visitedSessions: []
};

function readStats(): StatsData {
  try {
    if (fs.existsSync(STATS_FILE)) {
      const content = fs.readFileSync(STATS_FILE, "utf-8");
      return JSON.parse(content);
    }
  } catch (error) {
    console.error("Error reading stats file, using defaults:", error);
  }
  return { ...DEFAULT_STATS };
}

function writeStats(data: StatsData) {
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("Error writing stats file:", error);
  }
}

// In-memory registry of active sessions: { sessionId: lastSeenTimestamp }
const activeSessions = new Map<string, number>();

// Cleanup inactive sessions periodically (older than 20 seconds)
setInterval(() => {
  const now = Date.now();
  for (const [sessId, lastSeen] of activeSessions.entries()) {
    if (now - lastSeen > 20000) {
      activeSessions.delete(sessId);
    }
  }
}, 5000);

// API Routes
app.post("/api/heartbeat", (req, res) => {
  const { sessionId, isNew } = req.body;

  if (!sessionId || typeof sessionId !== "string") {
    res.status(400).json({ error: "Invalid sessionId" });
    return;
  }

  // Record this session as active
  activeSessions.set(sessionId, Date.now());

  // Load current stats
  const stats = readStats();

  let statsChanged = false;

  // If this session is declared new or not in our database of visited sessions, register it
  if (isNew || !stats.visitedSessions.includes(sessionId)) {
    if (!stats.visitedSessions.includes(sessionId)) {
      stats.visitedSessions.push(sessionId);
      // Keep visitedSessions array from growing indefinitely in memory
      // We can cap it at the last 50,000 unique sessions to preserve file size
      if (stats.visitedSessions.length > 50000) {
        stats.visitedSessions.shift();
      }
    }
    stats.totalVisitors += 1;
    statsChanged = true;
  }

  if (statsChanged) {
    writeStats(stats);
  }

  res.json({
    onlinePlayers: activeSessions.size,
    totalVisitors: stats.totalVisitors,
  });
});

app.get("/api/stats", (req, res) => {
  const stats = readStats();
  res.json({
    onlinePlayers: activeSessions.size,
    totalVisitors: stats.totalVisitors,
  });
});

// Vite Middleware Setup
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
