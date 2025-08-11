import { EventEmitter } from 'node:events';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { JSONRPCNotification } from '@modelcontextprotocol/sdk/types.js';
import type { NeovimClient } from 'neovim';
import { diff, getClient } from './neovim.js';

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
