/**
 * Cluster mode entry point for Auleg API.
 * 
 * Forks one worker per CPU core (configurable via CLUSTER_WORKERS).
 * Automatically restarts crashed workers.
 * 
 * Usage: node cluster.js
 * Disable: Set CLUSTER_WORKERS=1 or use node index.js directly.
 */

const cluster = require('node:cluster');
const os = require('node:os');
const path = require('node:path');

const WORKER_COUNT = Number(process.env.CLUSTER_WORKERS) || os.cpus().length;

if (cluster.isPrimary) {
  console.log(`[cluster] Primary PID ${process.pid} — forking ${WORKER_COUNT} workers`);

  const workerRestarts = new Map(); // pid -> restart count

  for (let i = 0; i < WORKER_COUNT; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    const restarts = workerRestarts.get(worker.process.pid) || 0;
    console.error(`[cluster] Worker ${worker.process.pid} died (code=${code}, signal=${signal})`);

    // Avoid restart storm: max 5 restarts per worker in 60s
    if (restarts < 5) {
      console.log('[cluster] Restarting worker...');
      const newWorker = cluster.fork();
      workerRestarts.set(newWorker.process.pid, restarts + 1);
    } else {
      console.error('[cluster] Worker restart limit reached, not restarting');
    }
  });

  // Graceful shutdown of all workers
  function shutdownCluster(signal) {
    console.log(`[cluster] ${signal} received — shutting down all workers`);
    for (const id in cluster.workers) {
      cluster.workers[id].process.kill(signal);
    }
    setTimeout(() => {
      console.error('[cluster] Forced exit after timeout');
      process.exit(1);
    }, 15000).unref();
  }

  process.on('SIGTERM', () => shutdownCluster('SIGTERM'));
  process.on('SIGINT', () => shutdownCluster('SIGINT'));
} else {
  // Workers run the Express app
  require(path.join(__dirname, 'index.js'));
}
