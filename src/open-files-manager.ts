import { EventEmitter } from 'node:events';
import { promises as fs } from 'fs';
import type { NeovimClient } from 'neovim';
import { getClient, registerAutocmd } from './neovim.js';

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

    registerAutocmd(['BufWritePost', 'BufDelete'], {}, async () => {
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
