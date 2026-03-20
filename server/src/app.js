const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "API is running" });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Server is healthy" });
});

module.exports = app;