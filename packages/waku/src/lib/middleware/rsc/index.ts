import { AsyncGeneratorCall } from "async-call-rpc/full";
import type { GetBuildConfig } from "../../../server.js";
// only import the types, otherwise it will be included in the bundle
import type { WorkerImplementation } from "./worker.js";
import { RenderRequest } from "./worker-api.js";

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

export async function renderRSC(
  rr: RenderRequest,
) {
  const copied = { ...rr };
  delete copied.stream;
  delete copied.moduleIdCallback;
  const generator = rpc.render({
    ...copied,
    hasModuleIdCallback: !!rr.moduleIdCallback,
  })
  for await (const mesg of generator) {
    switch (mesg.type) {
      case "start":
        if (rr.moduleIdCallback) {
          rr.moduleIdCallback(mesg.moduleId);
        }
        break;
      case "buf":
        rr.stream.push(Buffer.from(mesg.buf, mesg.offset, mesg.len));
        break;
      case "end":
        rr.stream.push(null);
        break;
      case "err":
        rr.stream.emit("error", mesg.err);
        break;
    }
  }
}
