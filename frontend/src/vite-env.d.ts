/// <reference types="vite/client" />

interface Window {
  __TASK_SOCKET__: any;
  __APP_LOAD_TIMEOUT__?: ReturnType<typeof setTimeout>;
}
