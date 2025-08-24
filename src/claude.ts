import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { Express } from 'express';
import logger from './log.js';
import {
  ErrorCode,
  InitializeRequestSchema,
  isJSONRPCRequest,
  LATEST_PROTOCOL_VERSION,
  ListToolsRequestSchema,
  type InitializeResult,
  type JSONRPCError,
  type JSONRPCRequest,
  type JSONRPCResponse,
  type ListToolsResult,
} from './claude-schema.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { } from 'zod'

type JSONRPCHandler = (request: JSONRPCRequest) => Promise<any>;

const mcpServer = new McpServer({
  name: 'neovim-ide-companion',
  version: ''
})

export class ClaudeIdeServer {
  transports: Record<string, SSEServerTransport> = {};

  jsonRPCRequestHandler: Record<string, JSONRPCHandler> = {};

  _registeredTools: any[] = []

  constructor() {
    this.registerRequestHandler(
      InitializeRequestSchema.shape.method.value,
      async (req) => {
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
      }
    )
    this.registerRequestHandler(ListToolsRequestSchema.shape.method.value, async (req) => {
      const result: ListToolsResult = {
        // tools: Object.entries(this._registeredTools)
        //   .filter(([, f]) => f.enabled)
        //   .map(([f, v]) => {
        //     let P = {
        //       name: f,
        //       title: v.title,
        //       description: v.description,
        //       inputSchema: v.inputSchema
        //         ? r5.zodToJsonSchema(v.inputSchema, { strictUnions: !0 })
        //         : hD,
        //       annotations: v.annotations,
        //     };
        //     if (v.outputSchema)
        //       P.outputSchema = r5.zodToJsonSchema(v.outputSchema, {
        //         strictUnions: !0,
        //       });
        //     return P;
        //   }),
        tools: []
      }
      return result

    })
  }

  registerRequestHandler(method: string, handler: JSONRPCHandler) {
    this.jsonRPCRequestHandler[method] = handler;
  }

  async start(app: Express) {
    app.get('/sse', (req, res) => {
      const transport = new SSEServerTransport('/claude', res);
      mcpServer.connect(transport)
      transport.start();
      this.transports[transport.sessionId] = transport;
    });
    app.post('/claude', async (req, res) => {
      logger.debug(JSON.stringify(req.body));
      if (isJSONRPCRequest(req.body)) {
        const handler = this.jsonRPCRequestHandler[req.body.method];
        if (handler) {
          try {
            const result = await handler(req.body);
            const response: JSONRPCResponse = {
              jsonrpc: '2.0',
              id: req.body.id,
              result,
            };
            res.json(response);
          } catch (e: any) {
            const errorResponse: JSONRPCError = {
              jsonrpc: '2.0',
              id: req.body.id,
              error: {
                code: ErrorCode.InternalError,
                message: e.message,
              },
            };
            res.status(500).json(errorResponse);
          }
        } else {
          const errorResponse: JSONRPCError = {
            jsonrpc: '2.0',
            id: req.body.id,
            error: {
              code: ErrorCode.MethodNotFound,
              message: `Method not found: ${req.body.method}`,
            },
          };
          res.status(404).json(errorResponse);
        }
      } else {
        res.status(400).send('Invalid request');
      }
      // const sessionId = req.query.sessionId as string
      // if (!sessionId) {
      //   logger.error("Invalid post to /claude: missing sessionId")
      //   res.status(400).send("Invalid post to /claude: missing sessionId")
      // }
      // const transport = this.transports[sessionId]
      // if (!transport) {
      //   logger.error("Invalid post to /claude: unknown sessionId")
      //   res.status(400).send("Invalid post to /claude: unknown sessionId")
      // }
    });
  }
}

