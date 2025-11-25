// server.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");

const apiRouter = require("./src/routes/api");
const db = require("./src/db");

const app = express();

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- API routes ---
app.use("/api", apiRouter);

// --- Static React frontend ---
const clientBuildPath = path.join(__dirname, "client", "dist");

if (fs.existsSync(clientBuildPath)) {
  console.log("Serving client from:", clientBuildPath);

  app.use(express.static(clientBuildPath));

  app.get("*", (req, res) => {
    if (req.path.startsWith("/api")) {
      return res.status(404).json({ error: "Not found" });
    }
    res.sendFile(path.join(clientBuildPath, "index.html"));
  });
} else {
  console.warn(
    "Client build folder not found at",
    clientBuildPath,
    "- serving API only."
  );

  app.get("/", (req, res) => {
    res.send("Tournament API is running. Build the client to get the UI.");
  });
}

// --- Start the server ---
const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0';

async function start() {
  try {
    await db.runMigrations();
    app.listen(PORT, HOST, () => {
      console.log(`Server listening on http://${HOST}:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

start();
