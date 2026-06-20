require("dotenv").config();

const http = require("http");
const app = require("./app");
const { initSocket } = require("./socket");
const { cleanupOldUnpaidOrders } = require("./utils/cleanupUnpaidOrders");

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

// Initialize Socket.IO for live chat
initSocket(server);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  cleanupOldUnpaidOrders().catch((error) => {
    console.error("[Cleanup] Failed initial unpaid order cleanup:", error);
  });

  setInterval(() => {
    cleanupOldUnpaidOrders().catch((error) => {
      console.error("[Cleanup] Failed scheduled unpaid order cleanup:", error);
    });
  }, 60 * 60 * 1000);
});