import type { NeovimClient, Buffer } from 'neovim';
import { fileURLToPath } from 'url';
import logger from './log.js';
import { attach } from 'neovim'
import { isSameFile } from './fs.js';

export interface NeovimSession {
  client: NeovimClient;
  disconnect: () => void;
}

if (!process.env['NVIM_LISTEN_ADDRESS']) {
  logger.error('environment variable NVIM_LISTEN_ADDRESS is not set');
  process.exit(1);
}


export const nvim: NeovimClient = attach({
  socket: process.env['NVIM_LISTEN_ADDRESS'],
  options: {
    logger: logger
  }
})
nvim.on('disconnect', () => {
  logger.error('Neovim disconnected');
  process.exit(1);
})


export async function onNotification(cb: (m: string, args: any[]) => boolean) {
  const notificationHandler = (m: string, args: any[]) => {
    if (cb(m, args)) {
      nvim.off('notification', notificationHandler);
    }
  }
  nvim.on('notification', notificationHandler);
}


export async function findBuffer(
  predict: (b: Buffer) => Promise<boolean> | boolean,
) {
  const buffers = await nvim.buffers;
  for (const buf of buffers) {
    if (await predict(buf)) {
      return buf;
    }
  }
  return null;
}

export async function filterBuffer(
  predict: (b: Buffer) => Promise<boolean> | boolean
) {
  const buffers = await nvim.buffers;
  return (await Promise.all(buffers.map(async b => [b, await predict(b)] as const)))
    .filter(([b, p]) => p)
    .map(([b]) => b);
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

export type DiffResult = 'accepted' | 'rejected'

let diffCounter = 0
export async function diff(oldPath: string, newPath: string) {
  await nvim.command(`tabnew ${newPath}`);
  await nvim.command(`vert diffsplit ${oldPath}`);

  const { promise, resolve } = withResolvers<DiffResult>();

  let resolved = false;

  const doResolve = async (result: DiffResult) => {
    logger.debug("resolve diff " + result)
    if (resolved) {
      return;
    }
    resolved = true;
    await Promise.all([
      findBuffer(async b => {
        const name = await b.name;
        return isSameFile(name, oldPath)
      })
        .then(b => {
          if (b) {
            logger.debug("delete buffer " + oldPath)
            nvim.command(`bdelete! ${b.id}`)
          } else {
            logger.debug("Cannot find buffer corresponding to " + oldPath)
          }
        })
        .catch((e) => {
          logger.err(e, "Failed to delete buffer : " + oldPath)
        }),
      findBuffer(async b => isSameFile(await b.name, newPath))
        .then(async b => {
          if (b) {
            await nvim.request("nvim_win_set_buf", [0, b.id]);
            await nvim.command("w")
            await nvim.command(`bdelete! ${b.id}`)
          } else {
            logger.debug("Cannot find buffer corresponding to " + oldPath)
          }
        })
        .catch(logger.err)
    ])
    resolve(result);
  };

  const acceptId = `diff_accept_${++diffCounter}`;
  const rejectId = `diff_reject_${++diffCounter}`;

  const leaveCallback = () => {
    doResolve("accepted");
    return true; // unregister self
  };

  registerAutocmd("BufWinLeave", { pattern: oldPath }, leaveCallback)
  registerAutocmd("BufWinLeave", { pattern: newPath }, leaveCallback)

  const channelId = await nvim.channelId;
  const method = "diff-keymap";

  const setKeymaps = async (bufnr: number) => {
    const luaCode = `
        print("set keymaps")
        local bufnr, channelId, method, acceptId, rejectId = ...
        vim.keymap.set('n', 'a', function() 
print("a")
            vim.rpcnotify(channelId, method, acceptId)
        end, { buffer = bufnr, nowait = true })
        vim.keymap.set('n', 'r', function() 
print("r")
            vim.rpcnotify(channelId, method, rejectId)
        end, { buffer = bufnr, nowait = true })
      `;
    await nvim.lua(luaCode, [bufnr, channelId, method, acceptId, rejectId]);
  };
  onNotification((m, args) => {
    if (m === method) {
      logger.debug("a or n pressed")
      if (args[0] === acceptId) {
        doResolve("accepted");
      } else if (args[0] === rejectId) {
        doResolve("rejected");
      }
      return true
    }
    return false
  })

  const oldPathBufnr = await nvim.call("bufnr", "%" as any);
  await nvim.command("wincmd w");
  const newPathBufnr = await nvim.call("bufnr", "%" as any);
  await nvim.command("wincmd p"); // return to original window

  await setKeymaps(oldPathBufnr as number);
  await setKeymaps(newPathBufnr as number);

  const nsId = await nvim.request('nvim_create_namespace', ["neovim-ide-companion-diff"]);
  const setVirtualText = async (bufnr: number) => {
    await nvim.request('nvim_buf_set_extmark', [bufnr, nsId, 0, -1, {
      virt_text: [[" a: accept all, r: reject all", "Comment"]],
      virt_text_pos: "overlay",
    }]);
  };

  await setVirtualText(newPathBufnr as number);


  return promise;
}

export async function tempEdit(content: string) {
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

