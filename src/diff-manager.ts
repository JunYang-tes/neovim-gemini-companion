import { EventEmitter } from 'node:events';
import { promises as fs } from 'fs';

import * as path from 'path';
import type { JSONRPCNotification } from '@modelcontextprotocol/sdk/types.js';
import type { NeovimClient } from 'neovim';
import { activeLastTermBuffer, diff, findBuffer, nvim } from './neovim.js';
import { match } from 'ts-pattern'
import logger from './log.js';

export class DiffManager extends EventEmitter {
    private activeDiffs: Map<string, {
        oldFilePath: string
        newFilePath: string
    }> = new Map();

    constructor() {
        super();
    }

    async showDiff(filePath: string, newContent: string) {
        const newFilePath = path.join(path.dirname(filePath), `✻ [New] ${path.basename(filePath)}`);
        await fs.writeFile(newFilePath, newContent);

        this.activeDiffs.set(filePath, { oldFilePath: filePath, newFilePath: newFilePath });

        return diff(filePath, newFilePath).then(async (result) => {
            const tempContent = await fs.readFile(newFilePath, 'utf-8');
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
                            nvim.command(`checktime ${b.id}`);
                        }
                    })

            }, 500)
            activeLastTermBuffer();

            fs.unlink(newFilePath)
                .catch(e => {
                    logger.err(e)
                })

            this.activeDiffs.delete(filePath);
            return {
                type: result,
                content: tempContent
            }
        });
    }

    async closeDiff(filePath: string) {
        const diffInfo = this.activeDiffs.get(filePath);
        if (!diffInfo) {
            return;
        }

        const windows = await nvim.windows;
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
