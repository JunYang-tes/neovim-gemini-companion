import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { Express } from 'express';
import logger from './log.js';
import z from 'zod'
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
import { DiffManager } from './diff-manager.js';
import { writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import path from 'node:path';
import { activeBuffer, findFileBuffer, getDiagnostics, openFile } from './neovim.js';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  diffManager = new DiffManager()

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
    mcpServer.registerTool('openDiff', {
      inputSchema: z.object({
        old_file_path: z.string()
          .describe('Path to the file to show diff for. If not provided, uses active editor.'),
        new_file_path: z.string(),
        new_file_contents: z.string(),
        tab_name: z.string()

      }).shape,
    }, async (param) => {
      logger.debug(`openDiff ${param.old_file_path} ${param.new_file_path} ${param.tab_name}`)
      const r = await this.diffManager.showDiff(param.old_file_path, param.new_file_contents)
      return {
        content: [
          { type: 'text', text: r.type === 'accepted' ? 'FILE_SAVED' : 'DIFF_REJECTED' },
          { type: 'text', text: r.type === 'accepted' ? r.content : param.tab_name }
        ]
      }
    })
    mcpServer.registerTool('closeAllDiffTabs', {}, async () => {
      logger.debug('closeAllDiffTabs')
      return {
        content: [
          {
            type: "text", text: `CLOSED_${0}_DIFF_TABS`
          }
        ]
      }
    })
    mcpServer.registerTool('getDiagnostics', {
      inputSchema: z.object({
        uri: z.string()
          .optional()
          .describe(`Optional file URI to get diagnostics for. If not provided, gets diagnostics for all files.`)
      }).shape
    }, async ({ uri }) => {
      logger.debug("getDiagnostics for " + uri)
      const diagnostics =
        await getDiagnostics(
          uri ?
            fileURLToPath(uri)
            : undefined
        )
      logger.debug(JSON.stringify(diagnostics, null, 2))
      return {
        content: [
          {
            type: 'text', text:
              JSON.stringify(
                diagnostics
              )
          }
        ]
      }
    })
    mcpServer.registerTool(
      'openFile',
      {
        inputSchema: z.object({
          filePath: z.string().describe("Path to the file to open"),
          preview: z
            .boolean()
            .describe("Whether to open the file in preview mode")
            .default(false),
          startText: z
            .string()
            .describe(
              "Text pattern to find the start of the selection range. Selects from the beginning of this match.",
            ),
          endText: z
            .string()
            .describe(
              "Text pattern to find the end of the selection range. Selects up to the end of this match. If not provided, only the startText match will be selected.",
            ),
          selectToEndOfLine: z
            .boolean()
            .describe(
              "If true, selection will extend to the end of the line containing the endText match.",
            )
            .default(!1),
          makeFrontmost: z
            .boolean()
            .describe(
              "Whether to make the file the active editor tab. If false, the file will be opened in the background without changing focus.",
            )
            .default(!0),
        })
          .shape
      },
      async (args) => {
        if (args.preview) {
          logger.debug("open file in preview mode is not supported")
        }
        const buffer = await openFile(args.filePath);
        if (buffer) {
          if (args.makeFrontmost) {
            await activeBuffer(buffer)
            return {
              content: [
                {
                  type: 'text',
                  text: `Opened file: ${args.filePath}`
                }
              ]
            }
          } else {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: !0,
                    filePath: args.filePath,
                    fileUrl: pathToFileURL(args.filePath),
                    message: `Opened file: ${args.filePath}`,
                  })
                }
              ]
            }
          }
        }

        return {
          content: []
        }
      }
    )
    mcpServer.registerTool(
      'checkDocumentDirty',
      {
        inputSchema: z.object({
          filePath: z.string().describe("Path to the file to check")
        })
          .shape
      },
      async ({ filePath }) => {
        const buf = await findFileBuffer(filePath)
        if (buf == null) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false, message: `Document not open: ${filePath}`
                })
              }
            ]
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                filePath: filePath,
                isDirty: await buf.getOption('modified'),
                isUntitled: false,
              })
            }
          ]
        }
      }
    )
  }

  registerRequestHandler(method: string, handler: JSONRPCHandler) {
    this.jsonRPCRequestHandler[method] = handler;
  }

  setNotificationHandler(schema: any, handler: NotificationHanlder) {
    this._notificationHandlers[schema.method] = async (value: any) => handler(schema.parse(value))
  }

  async start(app: Express, port: number) {
    await writeClaudeLock(port)
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


async function writeClaudeLock(port: number) {
  await writeFile(
    path.join(os.homedir(),
      '.claude',
      'ide',
      `${port}.lock`
    ),
    JSON.stringify({
      //pid: process.pid,
      transport: 'sse',
      ideName: 'Neovim',
      workspaceFolders: [
        process.cwd()
      ],
      authToken: ""
    })
  )
}
