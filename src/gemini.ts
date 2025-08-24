import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { DiffManager } from "./diff-manager.js";
import type { OpenFilesManager } from "./open-files-manager.js";
import { isInitializeRequest, type JSONRPCNotification } from "@modelcontextprotocol/sdk/types.js";
import type { Express } from 'express';
import { randomUUID } from "node:crypto";
import logger from "./log.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from 'zod'

const MCP_SESSION_ID_HEADER = 'mcp-session-id';
function sendIdeContextUpdateNotification(
  transport: StreamableHTTPServerTransport,
  openFilesManager: OpenFilesManager,
) {
  const ideContext = openFilesManager.state;

  const notification: JSONRPCNotification = {
    jsonrpc: '2.0',
    method: 'ide/contextUpdate',
    params: ideContext,
  };
  transport.send(notification);
}

export class GeminiIdeServer {
  diffManager: DiffManager
  transports: { [sessionId: string]: StreamableHTTPServerTransport } =
    {};
  mcpServer: McpServer
  constructor(public openFilesManager: OpenFilesManager) {
    this.diffManager = new DiffManager();
    this.mcpServer = new McpServer(
      {
        name: 'gemini-cli-companion-mcp-server',
        version: '1.0.0',
      },
      { capabilities: { logging: {} } },
    )

    this.mcpServer.registerTool(
      'openDiff',
      {
        description:
          '(IDE Tool) Open a diff view to create or modify a file. Returns a notification once the diff has been accepted or rejcted.',
        inputSchema: z.object({
          filePath: z.string(),
          // TODO(chrstn): determine if this should be required or not.
          newContent: z.string().optional(),
        }).shape,
      },
      async ({
        filePath,
        newContent,
      }: {
        filePath: string;
        newContent?: string
      }, extra) => {
        await this.diffManager.showDiff(filePath, newContent ?? '')
          .then(async (result) => {
            const sid = extra.sessionId
            if (sid) {
              const transport = this.transports[sid]
              if (transport) {
                transport.send(
                  result.type === 'accepted'
                    ? {

                      jsonrpc: '2.0',
                      method: 'ide/diffAccepted',
                      params: {
                        filePath: filePath,
                        content: result.content
                      }
                    } : {

                      jsonrpc: '2.0',
                      method: 'ide/diffClosed',
                      params: {
                        filePath: filePath,
                        content: undefined
                      }
                    }
                )
              }

            }
          })
          ;
        return {
          content: [
            {
              type: 'text',
              text: `Showing diff for ${filePath}`,
            },
          ],
        };
      },
    );
    this.mcpServer.registerTool(
      'closeDiff',
      {
        description: '(IDE Tool) Close an open diff view for a specific file.',
        inputSchema: z.object({
          filePath: z.string(),
        }).shape,
      },
      async ({ filePath }: { filePath: string }) => {
        await this.diffManager.closeDiff(filePath);
        return {
          content: [
            {
              type: 'text',
              text: `Closed diff for ${filePath}`,
            },
          ],
        };
      },
    );

    this.openFilesManager.on('onDidChange', () => {
      for (const transport of Object.values(this.transports)) {
        sendIdeContextUpdateNotification(
          transport,
          this.openFilesManager,
        );
      }
    });
  }
  async start(app: Express) {

    const sessionsWithInitialNotification = new Set<string>();
    app.post('/mcp', async (req, res) => {
      const sessionId = req.headers[MCP_SESSION_ID_HEADER] as
        | string
        | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && this.transports[sessionId]) {
        transport = this.transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            logger.info(`New session initialized: ${newSessionId}`);
            this.transports[newSessionId] = transport;
          },
        });
        const keepAlive = setInterval(() => {
          try {
            transport.send({ jsonrpc: '2.0', method: 'ping' });
          } catch (e) {
            logger.error(
              'Failed to send keep-alive ping, cleaning up interval.' + e,
            );
            clearInterval(keepAlive);
          }
        }, 60000); // 60 sec


        transport.onclose = () => {
          clearInterval(keepAlive);
          if (transport.sessionId) {
            logger.info(`Session closed: ${transport.sessionId}`);
            sessionsWithInitialNotification.delete(transport.sessionId);
            delete this.transports[transport.sessionId];
          }
        };
        this.mcpServer.connect(transport);
      } else {
        logger.warn(
          'Bad Request: No valid session ID provided for non-initialize request.',
        );
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message:
              'Bad Request: No valid session ID provided for non-initialize request.',
          },
          id: null,
        });
        return;
      }

      try {
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Error handling MCP request: ${errorMessage}`);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0' as const,
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          });
        }
      }
    });


    app.get('/mcp',

      async (req, res) => {
        const sessionId = req.headers[MCP_SESSION_ID_HEADER] as
          | string
          | undefined;
        if (!sessionId || !this.transports[sessionId]) {
          logger.warn('Invalid or missing session ID');
          res.status(400).send('Invalid or missing session ID');
          return;
        }

        const transport = this.transports[sessionId];
        try {
          await transport.handleRequest(req, res);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          logger.error(`Error handling session request: ${errorMessage}`);
          if (!res.headersSent) {
            res.status(400).send('Bad Request');
          }
        }

        if (!sessionsWithInitialNotification.has(sessionId)) {
          sendIdeContextUpdateNotification(
            transport,
            this.openFilesManager,
          );
          sessionsWithInitialNotification.add(sessionId);
        }
      })

  }
}
