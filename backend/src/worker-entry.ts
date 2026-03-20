
import 'dotenv/config';
import { dispatchPending } from './workers/scheduler.js';
import './workers/worker.js';

console.log('Worker processes started');

// Start scheduler loop
setInterval(dispatchPending, 2000);
