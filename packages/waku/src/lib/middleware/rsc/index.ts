import { AsyncGeneratorCall } from "async-call-rpc/full";
import type { GetBuildConfig } from "../../../server.js";
// only import the types, otherwise it will be included in the bundle
import type { WorkerImplementation } from "./worker.js";

export type MainThreadImplementation = {
  hotImport: (source: string) => Promise<void>;
  fullReload: () => Promise<void>;
  onModuleId: (id: string) => Promise<void>;
  getBuildConfig: () => Promise<GetBuildConfig>;
}

const rpc = AsyncGeneratorCall<WorkerImplementation>({
  hotImport: (source: string) => {

  }
}, {
  channel: null!
});
