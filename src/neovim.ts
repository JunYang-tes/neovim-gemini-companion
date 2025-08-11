import type { NeovimClient, Buffer } from 'neovim';
import { fileURLToPath } from 'url';

export interface NeovimSession {
  client: NeovimClient;
  disconnect: () => void;
}

let sharedClient: NeovimClient | null = null;

export async function getClient(): Promise<NeovimClient | null> {
  if (sharedClient) {
    return sharedClient;
  }

  if (!process.env['NVIM_LISTEN_ADDRESS']) {
    return null;
  }

  try {
    const attach = await import('neovim').then((m) => m.attach);
    const client = attach({
      socket: process.env['NVIM_LISTEN_ADDRESS'],
    });

    client.on('disconnect', () => {
      sharedClient = null;
    });

    sharedClient = client;
    return sharedClient;
  } catch (e) {
    console.error('Failed to connect to Neovim');
    if ((e as Error).message) {
      console.error(e.message);
    }
    return null;
  }
}
export async function findBuffer(
  predict: (b: Buffer) => Promise<boolean> | boolean,
) {
  const nvim = await getClient();
  if (nvim === null) {
    return null;
  }

  const buffers = await nvim.buffers;
  for (const buf of buffers) {
    if (await predict(buf)) {
      return buf;
    }
  }
  return null;
}


export function withResolvers<T>() {
  let resolve: (v: T | PromiseLike<T>) => void;
  let reject: (r?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve: resolve!,
    reject: reject!,
  };
}

export async function editInNewTab(filepathOrUrl: string) {

  const nvim = await getClient();
  if (!nvim) {
    return null;
  }


  const filepath = filepathOrUrl.startsWith("file://")
    ? fileURLToPath(filepathOrUrl)
    : filepathOrUrl;
  const swap = withResolvers<void>();
  const bufenter = withResolvers<void>();
  const ids: string[] = [];
  ids.push(
    (await registerAutocmd("SwapExists", { pattern: filepath }, (args: { buf: number }) => {
      if (args.buf !== 0) {
        swap.resolve();
        unregisterAutocmd(ids);
      }
    }))!,
  );
  ids.push(
    (await registerAutocmd("BufEnter", { pattern: filepath }, () => {
      bufenter.resolve();
      unregisterAutocmd(ids);
    }))!,
  );

  try {
    await nvim.command(`tabnew ${filepath}`);
  } catch (_e) {
  }
  return Promise.race([swap.promise, bufenter.promise]);
}

const autocmdCallbacks = new Map<
  string,
  // biome-ignore lint/suspicious/noConfusingVoidType: -_-!
  (...args: any[]) => void | boolean | Promise<undefined | boolean>
>();
let callbackIdCounter = 0;

export async function registerAutocmd(
  event: string | string[],
  option: {
    buffer?: number
    pattern?: string
  },
  // biome-ignore lint/suspicious/noConfusingVoidType: -_-!
  callback: (...args: any[]) => void | boolean | Promise<undefined | boolean>,
) {
  const nvim = await getClient();
  if (!nvim) {
    return null;
  }
  const method = "nvim_AUTOCMD_CALLBACK";
  if (callbackIdCounter === 0) {
    nvim.on("notification", (m: string, args: any[]) => {
      if (method === m) {
        const [callbackId, ...rest] = args;
        const cb = autocmdCallbacks.get(callbackId);
        if (cb) {
          // @ts-ignore
          Promise.resolve(cb(...rest)).then((unregister) => {
            if (unregister) {
              unregisterAutocmd(callbackId);
            }
          });
        }
      }
    });
  }

  const callbackId = `autocmd_${++callbackIdCounter}`;
  autocmdCallbacks.set(callbackId, callback);
  const channelId = await nvim.channelId;

  const luaCmd = `
		local event,buffer,pattern,callbackId,channelId,method=...
    local id
    local opt = {
      callback = function(...)
				local ok, err = pcall(vim.rpcnotify, channelId,method, callbackId,...)			
				if not ok then
					vim.api.nvim_del_autocmd(id)
				end
      end
    }
    if buffer >=0 then
      opt.buffer = buffer
    end
    if pattern ~= "" then
      opt.pattern = pattern
    end
	  id=vim.api.nvim_create_autocmd(event, opt)
  `;

  nvim.lua(luaCmd, [event, option.buffer ?? -1, option.pattern ?? "", callbackId, channelId, method]);
  return callbackId;
}
export function unregisterAutocmd(callbackId: string | string[]) {
  if (Array.isArray(callbackId)) {
    for (const id of callbackId) {
      autocmdCallbacks.delete(id);
    }
  } else {
    autocmdCallbacks.delete(callbackId);
  }
}
export async function createTransientBuffer(content: string, ft = "") {
  const buf = await createBuffer(content, ft);
  if (buf) {
    buf.setOption("bufhidden", "wipe");
    buf.setOption("swapfile", false);
  }
  return buf;
}

export async function createBuffer(content: string, ft = "") {

  const nvim = await getClient();
  if (!nvim) {
    return null;
  }
  nvim.command("tabnew");
  let buf = await nvim.createBuffer(false, true);
  if (typeof buf === "number") {
    buf = (await findBuffer(async (b) => b.id === buf))!;
  }

  buf.setLines(content.split("\n"), {
    start: 0,
    end: -1,
  });
  if (ft) {
    buf.setOption("filetype", ft);
  }

  await nvim.request("nvim_win_set_buf", [0, buf.id]);

  return buf;
}


export async function diff(oldPath: string, newPath: string) {
  const nvim = await getClient();
  if (!nvim) {
    return Promise.resolve(false);
  }
  await nvim.command(`tabnew ${newPath}`);
  await nvim.command(`vert diffsplit ${oldPath}`);
  return new Promise<boolean>((res) => {
    registerAutocmd(
      "BufWinLeave",
      { pattern: oldPath },
      (args: {
        buf: number;
      }) => {
        res(true)
        return true;
      },
    );
    registerAutocmd("BufWinLeave", { pattern: newPath }, (args: { buf: number }) => {
      res(true)
      return true;
    });
  })

}

export async function tempEdit(content: string) {
  const nvim = await getClient();
  const buf = await createBuffer(content)
  if (buf == null || nvim == null) {
    return null
  }
  return new Promise<string>((res) => {
    registerAutocmd("BufWinLeave", { buffer: buf.id }, async (args: { buf: number }) => {
      const lines = await buf.getLines({ start: 0, end: -1, strictIndexing: false })
      nvim.command("bdelete! " + buf.id)
      res(lines.join("\n"))
      return true
    })
  })
}

import { EventEmitter } from 'node:events';
import type { JSONRPCNotification } from '@modelcontextprotocol/sdk/types.js';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

export class OpenFilesManager extends EventEmitter {
  private client: NeovimClient | null = null;
  private _state: { visibleFiles: { filePath: string; content: string }[] } = { visibleFiles: [] };

  constructor() {
    super();
  }

  async initialize() {
    this.client = await getClient();
    if (!this.client) {
      console.log("Could not connect to neovim for OpenFilesManager");
      return;
    }
    await this.updateState();

    registerAutocmd(['BufEnter', 'BufWritePost', 'BufDelete'], {}, async () => {
      await this.updateState();
      this.emit('onDidChange');
    });
  }

  private async updateState() {
    if (!this.client) {
      return;
    }
    const buffers = await this.client.buffers;
    const visibleFiles = [];
    for (const buf of buffers) {
      const isListed = await buf.getOption('buflisted');
      if (!isListed) continue;

      const name = await buf.name;
      if (name && !name.startsWith('term:')) {
        try {
          // check if file exists
          await fs.access(name);
          const lines = await buf.getLines();
          visibleFiles.push({
            filePath: name,
            content: lines.join('\n'),
          });
        } catch (e) {
          // file doesn't exist, probably a buffer without a file
        }
      }
    }
    this._state = { visibleFiles };
  }

  get state() {
    return this._state;
  }
}

export class DiffManager extends EventEmitter {
  private activeDiffs: Map<string, { tempPath: string }> = new Map();
  private client: NeovimClient | null = null;

  constructor() {
    super();
  }

  async initialize() {
    this.client = await getClient();
  }

  async showDiff(filePath: string, newContent: string) {
    if (!this.client) {
      console.log("Could not connect to neovim for DiffManager");
      return;
    }
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neovim-ide-'));
    const tempPath = path.join(tempDir, path.basename(filePath));
    await fs.writeFile(tempPath, newContent);

    this.activeDiffs.set(filePath, { tempPath });

    diff(filePath, tempPath).then(async () => {
      const originalContent = await fs.readFile(filePath, 'utf-8').catch(() => '');
      const tempContent = await fs.readFile(tempPath, 'utf-8');

      const notification: JSONRPCNotification = {
        jsonrpc: '2.0',
        method: 'ide/diffUpdate',
        params: {
          filePath,
          status: originalContent === tempContent ? 'accepted' : 'rejected',
        },
      };
      this.emit('onDidChange', notification);

      await fs.unlink(tempPath);
      await fs.rmdir(tempDir).catch(e => console.error(`Could not remove temp dir ${tempDir}`, e));
      this.activeDiffs.delete(filePath);
    });
  }

  async closeDiff(filePath: string) {
    const diffInfo = this.activeDiffs.get(filePath);
    if (!diffInfo || !this.client) {
      return;
    }

    const windows = await this.client.windows;
    for (const win of windows) {
      try {
        const buf = await win.buffer;
        const bufName = await buf.name;
        if (bufName === filePath || bufName === diffInfo.tempPath) {
          await win.close();
        }
      } catch (e) {
        // ignore errors, window might be gone
      }
    }
  }
}

export async function saveServerPort(port: string) {
  const nvimAddr = (process.env['NVIM_LISTEN_ADDRESS'] ?? '')
    .replaceAll('/', '_')
  console.log(nvimAddr)
  const p = path.resolve(
    '/tmp',
    nvimAddr
  )
  await fs.writeFile(p, port)
}
