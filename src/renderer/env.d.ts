/// <reference types="vite/client" />
import type { MongoGDesktopApi } from '../shared/ipc/index.js';

declare global {
  interface Window {
    mongog: MongoGDesktopApi;
  }
}

export {};
