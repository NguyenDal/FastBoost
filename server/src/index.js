require("dotenv").config();

const http = require("http");
const app = require("./app");
const { initSocket } = require("./socket");

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

// Initialize Socket.IO for live chat
initSocket(server);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});