import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  isInitializeRequest,
  type JSONRPCNotification,
} from '@modelcontextprotocol/sdk/types.js';
import { Server as HTTPServer } from 'node:http';
import { z } from 'zod';
import { DiffManager } from './diff-manager.js';
import logger from './log.js';
import { OpenFilesManager } from './open-files-manager.js';
import { ClaudeIdeServer} from './claude.js'

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

export class IDEServer {
  private server: HTTPServer | undefined;
  diffManager: DiffManager;
  //openFilesManager: OpenFilesManager;
  claudeIdeServer = new ClaudeIdeServer();

  constructor() {
    this.diffManager = new DiffManager();
    //this.openFilesManager = new OpenFilesManager();
  }

  async start(port: number) {
    //await this.openFilesManager.initialize();

    const sessionsWithInitialNotification = new Set<string>();
    const transports: { [sessionId: string]: StreamableHTTPServerTransport } =
      {};

    const app = express();
    app.use(express.json());
    this.claudeIdeServer.start(app,port);
    const mcpServer = createMcpServer(this.diffManager);

    // this.openFilesManager.on('onDidChange', () => {
    //   for (const transport of Object.values(transports)) {
    //     sendIdeContextUpdateNotification(
    //       transport,
    //       this.openFilesManager,
    //     );
    //   }
    // });

    this.diffManager.on(
      'onDidChange',
      (notification: JSONRPCNotification) => {
        for (const transport of Object.values(transports)) {
          transport.send(notification);
        }
      },
    );

    app.post('/mcp', async (req: Request, res: Response) => {
      const sessionId = req.headers[MCP_SESSION_ID_HEADER] as
        | string
        | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            logger.info(`New session initialized: ${newSessionId}`);
            transports[newSessionId] = transport;
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
            delete transports[transport.sessionId];
          }
        };
        mcpServer.connect(transport);
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

    const handleSessionRequest = async (req: Request, res: Response) => {
      const sessionId = req.headers[MCP_SESSION_ID_HEADER] as
        | string
        | undefined;
      if (!sessionId || !transports[sessionId]) {
        logger.warn('Invalid or missing session ID');
        res.status(400).send('Invalid or missing session ID');
        return;
      }

      const transport = transports[sessionId];
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
        // sendIdeContextUpdateNotification(
        //   transport,
        //   this.openFilesManager,
        // );
        sessionsWithInitialNotification.add(sessionId);
      }
    };

    app.get('/mcp', handleSessionRequest);

    this.server = app.listen(port, () => {
      const address = (this.server as HTTPServer).address();
      if (address && typeof address !== 'string') {
        const port = address.port;
        // Instead of environment variables, just log the port
        logger.info(`IDE server listening on port ${port}`);
      }
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err?: Error) => {
          if (err) {
            logger.error(`Error shutting down IDE server: ${err.message}`);
            return reject(err);
          }
          logger.info(`IDE server shut down`);
          resolve();
        });
      });
      this.server = undefined;
    }
  }
}

const createMcpServer = (diffManager: DiffManager) => {
  const server = new McpServer(
    {
      name: 'gemini-cli-companion-mcp-server',
      version: '1.0.0',
    },
    { capabilities: { logging: {} } },
  );
  server.registerTool(
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
    }) => {
      await diffManager.showDiff(filePath, newContent ?? '');
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
  server.registerTool(
    'closeDiff',
    {
      description: '(IDE Tool) Close an open diff view for a specific file.',
      inputSchema: z.object({
        filePath: z.string(),
      }).shape,
    },
    async ({ filePath }: { filePath: string }) => {
      await diffManager.closeDiff(filePath);
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
  return server;
};
