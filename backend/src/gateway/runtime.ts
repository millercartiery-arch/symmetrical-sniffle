import { DispatchEngine } from "./dispatch-engine.js";

export const dispatchEngine = new DispatchEngine();

let started = false;
export const ensureDispatchEngineStarted = async () => {
  if (started) return;
  started = true;
  await dispatchEngine.start();
};

