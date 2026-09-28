const { parentPort, workerData } = require('node:worker_threads');
const mammoth = require('mammoth');

// Plain text only: document links/markup never become executable HTML. Buffer
// input keeps external files inaccessible; conversion runs in a bounded worker.
mammoth.extractRawText({ buffer: Buffer.from(workerData) }).then(result => {
    parentPort.postMessage({ text: result.value.slice(0, 500000), truncated: result.value.length > 500000 });
}).catch(() => parentPort.postMessage({ error: true }));
