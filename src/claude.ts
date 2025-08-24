import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { Express } from 'express';
import logger from './log.js';
import {
  ErrorCode,
  InitializedNotificationSchema,
  InitializeRequestSchema,
  InitializeResultSchema,
  isInitializeRequest,
  isJSONRPCNotification,
  isJSONRPCRequest,
  LATEST_PROTOCOL_VERSION,
  ListToolsRequestSchema,
  type ClientNotification,
  type InitializeResult,
  type JSONRPCError,
  type JSONRPCNotification,
  type JSONRPCRequest,
  type JSONRPCResponse,
  type ListToolsResult,
  type Notification,
  type NotificationSchema
} from './claude-schema.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

type JSONRPCHandler = (request: JSONRPCRequest) => Promise<any>;
type NotificationHanlder = (notification: Notification) => Promise<any>

const mcpServer = new McpServer({
  name: 'neovim-ide-companion',
  version: ''
})

export class ClaudeIdeServer {
  transports: Record<string, SSEServerTransport> = {};

  jsonRPCRequestHandler: Record<string, JSONRPCHandler> = {};
  _notificationHandlers: Record<string, NotificationHanlder> = {};

  _registeredTools: any[] = []

  constructor() {
    mcpServer.server.setRequestHandler(InitializeRequestSchema, async () => {
      logger.debug('initialize')
      const result: InitializeResult = {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {

        },
        serverInfo: {
          name: 'Claude Code Neovim Mcp',
          version: '0.0.1'
        }
      }
      return result
    })
    mcpServer.server.setNotificationHandler(InitializedNotificationSchema, async () => {
      logger.debug('initialized')
    })
  }

  registerRequestHandler(method: string, handler: JSONRPCHandler) {
    this.jsonRPCRequestHandler[method] = handler;
  }

  setNotificationHandler(schema: any, handler: NotificationHanlder) {
    this._notificationHandlers[schema.method] = async (value: any) => handler(schema.parse(value))
  }

  async start(app: Express) {
    app.get('/sse', (req, res) => {
      const transport = new SSEServerTransport('/claude', res);
      mcpServer.connect(transport)
      this.transports[transport.sessionId] = transport;
    });
    app.post('/claude', async (req, res) => {
      logger.debug(JSON.stringify(req.body));
      const sid = req.query.sessionId
      const transport = this.transports[sid as string]
      if (transport) {
        transport.handleMessage(req.body)
          .then(() => {
            res.status(200).send('OK')
          })
          .catch((error) => {
            logger.error(error);
            res.status(400).send('Bad Request:' + error?.message);
          });
      } else {
        res.status(400).send('Invalid session ID');
      }
    });
  }
}

