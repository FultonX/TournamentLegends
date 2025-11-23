// server.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");

const apiRouter = require("./src/routes/api");

const app = express();

// --- Middleware ---
app.use(cors());              // for now, open CORS is fine; you can tighten later
app.use(express.json());      // parse application/json

// --- API routes ---
app.use("/api", apiRouter);

// --- Static React frontend ---
// Adjust this path depending on your build tool:
//  - Vite:  client/dist
//  - CRA:   client/build
const clientBuildPath = path.join(__dirname, "client", "dist"); // or "build"

if (fs.existsSync(clientBuildPath)) {
  console.log("Serving client from:", clientBuildPath);

  // Serve static assets
  app.use(express.static(clientBuildPath));

  // SPA fallback: any non-API route returns index.html
  app.get("*", (req, res) => {
    // Don't steal /api routes
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

  // Simple root route when there's no front-end build yet
  app.get("/", (req, res) => {
    res.send("Tournament API is running. Build the client to get the UI.");
  });
}

// --- Start the server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
