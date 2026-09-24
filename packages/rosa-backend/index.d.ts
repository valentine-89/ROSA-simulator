/** Runtime package API. JSON definitions are validated by contract.cjs. */
declare const backend: {
  BackendService: new (options: Record<string, unknown>) => any;
  BackendStore: new (options: Record<string, unknown>) => any;
  DatabasePool: new (options?: number | Record<string, unknown>) => any;
  RemotePool: new (endpoints: Array<{ url: string; tokenEnv: string }>) => any;
  [key: string]: any;
};
export = backend;
