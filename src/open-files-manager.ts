import { EventEmitter } from 'node:events';
import { promises as fs } from 'fs';
import type { NeovimClient } from 'neovim';
import { filterBuffer, findBuffer, nvim, registerAutocmd } from './neovim.js';
import logger from './log.js';
import { match } from 'ts-pattern';

type File = {
  path: string;
  timestamp: number;
  cursor?: {
    line: number;
    character: number;
  } | undefined;
  isActive?: boolean | undefined;
  selectedText?: string | undefined;
}

export const MAX_FILES = 10;
const MAX_SELECTED_TEXT_LENGTH = 16384; // 16 KiB limit



export class OpenFilesManager extends EventEmitter {
  private files: File[]
  private debounceTimer: NodeJS.Timeout | null = null

  constructor() {
    super();
    this.files = []
  }

  async initialize() {
    await this.initFiles();

    registerAutocmd(['BufWritePost', 'BufDelete', 'BufEnter'], {}, async (arg) => {
      logger.debug("Autocmd " + arg.event)
      logger.debug("File " + arg.file)
      match(arg.event as string)
        .with("BufWritePost", async () => {
          await this.addFile(arg.file, arg.buf)
        })
        .with("BufDelete", async () => {
          this.remove(arg.file)
        })
        .with("BufEnter", async () => {
          await this.addFile(arg.file, arg.buf)
        })
        .otherwise(async () => {
          logger.warn("Unknown handled autocmd " + arg.event)
        })
        .then(() => {
          return this.updateActiveFile(arg.file, arg.buf)
        })
        .then(() => {
          if (this.files.length > MAX_FILES) {
            const deleteCnt = this.files.length - MAX_FILES
            this.files.splice(MAX_FILES - 1, deleteCnt)
          }
        })
        .finally(() => {
          this.fireWithDebounce()
        })
      return false
    });
  }
  private fireWithDebounce() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      logger.debug("fireWithDebounce")
      this.emit('onDidChange');
    }, 50); // 50ms
  }


  private async addFile(filePath: string, buf: number) {
    try {
      await fs.access(filePath)
    } catch (e) {
      logger.debug("File does not exist " + filePath)
      const idx = this.files.findIndex(f => f.path === filePath);
      if (idx !== -1) {
        this.files.splice(idx, 1)
      }
      return
    }

    const idx = this.files.findIndex(f => f.path === filePath);
    if (idx !== -1) {
      const file = this.files[idx]!;
      this.files.splice(idx, 1);
      this.files.push(file)
    } else {
      const buffer = await findBuffer(async (b) => b.id === buf);
      if (buffer != null) {
        const buftype = await buffer.getOption('buftype')
        if (buftype === 'nofile') {
          logger.debug("Ignoring nofile buffer")
        } else {
          this.files.push({
            path: filePath,
            timestamp: Date.now(),
          })
        }
      }
    }
  }
  private async updateTimestamp(filePath: string) {
    const idx = this.files.findIndex(f => f.path === filePath);
    if (idx !== -1) {
      const file = this.files[idx]!;
      file.timestamp = Date.now();
    }
  }

  private remove(filePath: string) {
    const idx = this.files.findIndex(f => f.path === filePath);
    if (idx !== -1) {
      this.files.splice(idx, 1)
    }
  }

  private clearActive() {
    this.files.forEach(f => f.isActive = false)
  }

  private async updateActiveFile(filePath: string, buf: number) {
    if (filePath.startsWith("term:")) {
      return
    }
    const currentBuf = await nvim.buffer.id
    if (currentBuf === buf) {
      const getOption = await nvim.buffer.getOption
      if ((await getOption('buftype')) != 'nofile') {
        const idx = this.files.findIndex(f => f.path === filePath);
        if (idx !== -1) {
          this.clearActive()
          const file = this.files[idx]!;
          file.isActive = true;
        } else {
          logger.error("Could not find file in files" + filePath)
        }
      }
    }
  }


  private async initFiles() {
    const buffers = await filterBuffer(async (buf) => {
      const isListed = await buf.getOption('buflisted');
      if (!isListed) return false;
      const name = await buf.name;
      if (name && !name.startsWith('term:')) {
        try {
          // check if file exists
          await fs.access(name);
          return true
        } catch (e) {
          // file doesn't exist, probably a buffer without a file
          return false
        }
      }
      return false
    })
    this.files = (await Promise.all(buffers.map(async (buf) => {
      const name = await buf.name;
      return {
        path: name,
        timestamp: Date.now(),
        isActive: false,
      }
    })))
  }

  get state() {
    logger.debug("Current Opened files")
    this.files.forEach(file => {
      logger.debug(`${file.isActive ? '[Actived]' : ''} ${file.path}`)
    })

    return {
      workspaceState: {
        openFiles: [...this.files],
      },
    }
  }
}
