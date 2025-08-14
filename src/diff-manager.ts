import { EventEmitter } from 'node:events';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { JSONRPCNotification } from '@modelcontextprotocol/sdk/types.js';
import type { NeovimClient } from 'neovim';
import { diff, findBuffer, getClient } from './neovim.js';
import { match } from 'ts-pattern'
import logger from './log.js';

export class DiffManager extends EventEmitter {
    private activeDiffs: Map<string, {
        oldFilePath: string
        newFilePath: string
    }> = new Map();
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
        const newFilePath = path.join(tempDir, 'new-' + path.basename(filePath));
        const oldFilePath = path.join(tempDir, 'old-' + path.basename(filePath));
        await Promise.all([
            await fs.writeFile(oldFilePath, await fs.readFile(filePath)),
            await fs.writeFile(newFilePath, newContent)
        ])

        this.activeDiffs.set(filePath, { oldFilePath: oldFilePath, newFilePath: newFilePath });

        diff(oldFilePath, newFilePath).then(async (result) => {
            const originalContent = await fs.readFile(filePath, 'utf-8').catch(() => '');
            const tempContent = await fs.readFile(newFilePath, 'utf-8');
            //TODO: rejected
            const notification: JSONRPCNotification = {
                jsonrpc: '2.0',
                method: 'ide/diffUpdate',
                params: result === 'accepted' ? {
                    filePath,
                    status: 'accepted',
                    content: tempContent
                } : {
                    filePath,
                    status: 'rejected',
                },
            };
            this.emit('onDidChange', match(result)
                .with('accepted', () => ({
                    jsonrpc: '2.0',
                    method: 'ide/diffAccepted',
                    params: {
                        filePath: filePath,
                        content: tempContent
                    }
                }))
                .with('rejected', () => ({
                    jsonrpc: '2.0',
                    method: 'ide/diffClosed',
                    params: {
                        filePath: filePath,
                        content: undefined
                    }
                }))
                .exhaustive()
            );
            setTimeout(() => {
                findBuffer(async b => (await b.name) === filePath)
                    .then(async b => {
                        if (b) {
                            logger.debug('call checktime for ' + filePath);
                            this.client?.command(`checktime ${b.id}`);
                        }
                    })

            }, 500)

            await fs.unlink(newFilePath);
            await fs.unlink(oldFilePath);
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
                if (bufName === diffInfo.oldFilePath || bufName === diffInfo.newFilePath) {
                    await win.close();
                }
            } catch (e) {
                // ignore errors, window might be gone
            }
        }
    }
}
