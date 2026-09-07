declare module 'vitest' {
  export interface ProvidedContext {
    mongoUris: {
      standalone: string;
      replicaSet: string;
    };
  }
}

export {};
