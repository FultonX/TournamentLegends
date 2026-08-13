require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const apiRouter = require("./src/routes/api");
const db = require("./src/db");

const app = express();
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "32kb" }));
app.use("/api", apiRouter);

const clientBuildPath = path.join(__dirname, "client", "dist");
if (fs.existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(clientBuildPath, "index.html"));
  });
}

app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (!error.operational) console.error(error);
  res.status(status).json({ error: status >= 500 && !error.status ? "Internal server error" : error.message });
});

function start(port = Number(process.env.PORT) || 5000) {
  db.runMigrations();
  return app.listen(port, "0.0.0.0", () => {
    console.log(`Tournament Legends listening on http://0.0.0.0:${port}`);
  });
}

if (require.main === module) start();

module.exports = { app, start };
