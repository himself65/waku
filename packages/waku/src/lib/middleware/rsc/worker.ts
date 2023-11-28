import { MessageRes, RenderRequest } from "waku/lib/middleware/rsc/worker-api";
import { AsyncCall } from "async-call-rpc/full";
import { MainThreadImplementation } from "waku/lib/middleware/rsc/index";
import { PassThrough, Transform } from "node:stream";
import { resolveConfig, viteInlineConfig } from "waku/lib/config";
import {
  defineEntries, GetBuildConfig,
  runWithAsyncLocalStorage as runWithAsyncLocalStorageOrig
} from "waku/server";
import busboy from "busboy";
import path from "node:path";
import url from "node:url";
import { ReactNode } from "react";
import RSDWServer from "react-server-dom-webpack/server";
import { Buffer } from "node:buffer";
import { deepFreeze } from "waku/lib/middleware/rsc/utils";
import { ViteDevServer } from "vite";
import { Server } from "node:http";
import { parentPort } from "node:worker_threads";

const { renderToReadableStream, decodeReply, decodeReplyFromBusboy } =
  RSDWServer;

const IS_NODE_20 = Number(process.versions.node.split(".")[0]) >= 20;
if (IS_NODE_20) {
  const {
    default: { register }
  } = await import("node:module");
  register("waku/node-loader", url.pathToFileURL("./"));
  register("react-server-dom-webpack/node-loader", url.pathToFileURL("./"));
}

export type WorkerImplementation = {
  render: (
    request: {
      hasModuleIdCallback: boolean;
    } & Omit<RenderRequest, "stream" | "moduleIdCallback">
  ) => AsyncGenerator<[
    buffer: ArrayBuffer, offset: number, len: number
  ]>

  getBuildConfig: () => ReturnType<GetBuildConfig>;

  shutdown: () => Promise<void>;
}

type Entries = {
  default: ReturnType<typeof defineEntries>;
  resolveClientPath?: (
    filePath: string,
    invert?: boolean
  ) => string | undefined;
};

const shutdown = async () => {
  if (lastViteServer) {
    await lastViteServer.close();
    lastViteServer = undefined;
  }
  parentPort!.close();
};

const rpc = AsyncCall<MainThreadImplementation>({
    async * render (request) {
      const {
        hasModuleIdCallback,
        ...rest
      } = request;
      const rr: RenderRequest = rest;
      rr.stream = new PassThrough();
      if (hasModuleIdCallback) {
        rr.moduleIdCallback = (moduleId: string) => {
          rpc.onModuleId(moduleId);
        };
      }
      const readableStream = await renderRSC(rr);
      const reader = readableStream.getReader();
      deepFreeze(rr.context);
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (!value) {
            throw new Error("Unexpected null value");
          }
          const buffer = Buffer.from(value);
          yield [buffer.buffer, buffer.byteOffset, buffer.byteLength];
        }
      } finally {
        reader.releaseLock();
      }
    },
    shutdown,
    getBuildConfig: getBuildConfigRSC
  } satisfies WorkerImplementation,
  {
    channel: null!
  }
);

let lastViteServer: ViteDevServer | undefined;
const getViteServer = async () => {
  if (lastViteServer) {
    return lastViteServer;
  }
  const dummyServer = new Server(); // FIXME we hope to avoid this hack
  const { createServer: viteCreateServer } = await import("vite");
  const { rscTransformPlugin } = await import(
    "../../vite-plugin/rsc-transform-plugin.js"
    );
  const { rscReloadPlugin } = await import(
    "../../vite-plugin/rsc-reload-plugin.js"
    );
  const { rscDelegatePlugin } = await import(
    "../../vite-plugin/rsc-delegate-plugin.js"
    );
  const viteServer = await viteCreateServer({
    ...viteInlineConfig(),
    plugins: [
      rscTransformPlugin(),
      rscReloadPlugin((type) => {
        const mesg: MessageRes = { type };
        parentPort!.postMessage(mesg);
      }),
      rscDelegatePlugin((source) => {
        const mesg: MessageRes = { type: "hot-import", source };
        parentPort!.postMessage(mesg);
      })
    ],
    ssr: {
      resolve: {
        conditions: ["react-server"],
        externalConditions: ["react-server"]
      },
      external: ["react", "react-server-dom-webpack", "waku"],
      noExternal: /^(?!node:)/
    },
    appType: "custom",
    server: { middlewareMode: true, hmr: { server: dummyServer } }
  });
  await viteServer.ws.close();
  lastViteServer = viteServer;
  return viteServer;
};

const loadServerFile = async (
  fname: string,
  command: "dev" | "build" | "start"
) => {
  if (command !== "dev") {
    return import(fname);
  }
  const vite = await getViteServer();
  return vite.ssrLoadModule(fname);
};

const getEntriesFile = (
  config: Awaited<ReturnType<typeof resolveConfig>>,
  command: "dev" | "build" | "start"
) => {
  const filePath = path.join(
    config.rootDir,
    command === "dev" ? config.srcDir : config.distDir,
    config.entriesJs
  );
  return command === "dev" ? filePath : url.pathToFileURL(filePath).toString();
};

const resolveClientEntry = (
  filePath: string,
  config: Awaited<ReturnType<typeof resolveConfig>>,
  command: "dev" | "build" | "start",
  resolveClientPath: Entries["resolveClientPath"]
) => {
  if (filePath.startsWith("file://")) {
    filePath = filePath.slice("file://".length);
  }
  filePath = resolveClientPath?.(filePath) || filePath;
  let root = path.join(
    config.rootDir,
    command === "dev" ? config.srcDir : config.distDir
  );
  if (path.sep !== "/") {
    // HACK to support windows filesystem
    root = root.replaceAll(path.sep, "/");
    if (filePath[0] === "/") {
      filePath = filePath.slice(1);
    }
  }
  if (!filePath.startsWith(root)) {
    if (command === "dev") {
      // HACK this relies on Vite's internal implementation detail.
      return config.basePath + "@fs/" + filePath.replace(/^\//, "");
    } else {
      throw new Error(
        "Resolving client module outside root is unsupported for now"
      );
    }
  }
  return config.basePath + path.relative(root, filePath);
};

// HACK Patching stream is very fragile.
const transformRsfId = (prefixToRemove: string) =>
  new Transform({
    transform (chunk, encoding, callback) {
      if (encoding !== ("buffer" as any)) {
        throw new Error("Unknown encoding");
      }
      const data = chunk.toString();
      const lines = data.split("\n");
      let changed = false;
      for (let i = 0; i < lines.length; ++i) {
        const match = lines[i].match(
          new RegExp(
            `^([0-9]+):{"id":"(?:file://)?${prefixToRemove}(.*?)"(.*)$`
          )
        );
        if (match) {
          lines[i] = `${match[1]}:{"id":"${match[2]}"${match[3]}`;
          changed = true;
        }
      }
      callback(null, changed ? Buffer.from(lines.join("\n")) : chunk);
    }
  });

async function renderRSC (rr: RenderRequest): Promise<ReadableStream<ArrayBuffer>> {
  const config = await resolveConfig();

  const { runWithAsyncLocalStorage } = await (loadServerFile(
    "waku/server",
    rr.command
  ) as Promise<{
    runWithAsyncLocalStorage: typeof runWithAsyncLocalStorageOrig;
  }>);

  const entriesFile = getEntriesFile(config, rr.command);
  const {
    default: { renderEntries },
    resolveClientPath
  } = await (loadServerFile(entriesFile, rr.command) as Promise<Entries>);

  const render = async (input: string) => {
    const elements = await renderEntries(input);
    if (elements === null) {
      const err = new Error("No function component found");
      (err as any).statusCode = 404; // HACK our convention for NotFound
      throw err;
    }
    if (Object.keys(elements).some((key) => key.startsWith("_"))) {
      throw new Error("\"_\" prefix is reserved");
    }
    return elements;
  };

  const bundlerConfig = new Proxy(
    {},
    {
      get (_target, encodedId: string) {
        const [filePath, name] = encodedId.split("#") as [string, string];
        const id = resolveClientEntry(
          filePath,
          config,
          rr.command,
          resolveClientPath
        );
        rr?.moduleIdCallback?.(id);
        return { id, chunks: [id], name, async: true };
      }
    }
  );

  if (rr.method === "POST") {
    const actionId = decodeURIComponent(rr.input);
    let args: unknown[] = [];
    const contentType = rr.headers["content-type"];
    if (
      typeof contentType === "string" &&
      contentType.startsWith("multipart/form-data")
    ) {
      const bb = busboy({ headers: rr.headers });
      const reply = decodeReplyFromBusboy(bb);
      rr.stream?.pipe(bb);
      args = await reply;
    } else {
      let body = "";
      for await (const chunk of rr.stream || []) {
        body += chunk;
      }
      if (body) {
        args = await decodeReply(body);
      }
    }
    const [fileId, name] = actionId.split("#");
    const filePath = path.join(config.rootDir, fileId!);
    const fname =
      rr.command === "dev" ? filePath : url.pathToFileURL(filePath).toString();
    const mod = await loadServerFile(fname, rr.command);
    let elements: Promise<Record<string, ReactNode>> = Promise.resolve({});
    const rerender = (input: string) => {
      elements = Promise.all([elements, render(input)]).then(
        ([oldElements, newElements]) => ({ ...oldElements, ...newElements })
      );
    };
    return runWithAsyncLocalStorage(
      {
        getContext: () => rr.context,
        rerender
      },
      async () => {
        const data = await (mod[name!] || mod)(...args);
        return renderToReadableStream(
          { ...(await elements), _value: data },
          bundlerConfig
        ).pipe(transformRsfId(config.rootDir));
      }
    );
  }

  return runWithAsyncLocalStorage(
    {
      getContext: () => rr.context,
      rerender: () => {
        throw new Error("Cannot rerender");
      }
    },
    async () => {
      const elements = await render(rr.input);
      return renderToReadableStream(elements, bundlerConfig).pipe(
        transformRsfId(config.rootDir)
      );
    }
  );
}

async function getBuildConfigRSC () {
  const config = await resolveConfig();

  const entriesFile = getEntriesFile(config, "build");
  const {
    default: { getBuildConfig }
  } = await (loadServerFile(entriesFile, "build") as Promise<Entries>);
  if (!getBuildConfig) {
    console.warn(
      "getBuildConfig is undefined. It's recommended for optimization and sometimes required."
    );
    return {};
  }

  const unstable_collectClientModules = async (
    input: string
  ): Promise<string[]> => {
    const idSet = new Set<string>();
    const stream = await renderRSC({
      input,
      method: "GET",
      headers: {},
      command: "build",
      context: null,
      moduleIdCallback: (id) => idSet.add(id)
    });
    const reader = stream.getReader();
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (!value) {
          throw new Error("Unexpected null value");
        }
        // do nothing
      }
    } finally {
      reader.releaseLock();
    }
    return Array.from(idSet);
  };

  const output = await getBuildConfig(unstable_collectClientModules);
  return output;
}
