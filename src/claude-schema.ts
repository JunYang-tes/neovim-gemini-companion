import { z } from 'zod';

// Protocol Constants
export const LATEST_PROTOCOL_VERSION = '2025-06-18';
export const DEFAULT_NEGOTIATED_PROTOCOL_VERSION = '2025-03-26';
export const SUPPORTED_PROTOCOL_VERSIONS = [
  LATEST_PROTOCOL_VERSION,
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
];
export const JSONRPC_VERSION = '2.0';

// Basic JSON-RPC Schemas
export const ProgressTokenSchema = z.union([z.string(), z.number().int()]);
export const CursorSchema = z.string();

const RequestMetaSchema = z
  .object({ progressToken: z.optional(ProgressTokenSchema) })
  .passthrough();

const BaseRequestParamsSchema = z.object({ _meta: z.optional(RequestMetaSchema) }).passthrough();

export const RequestSchema = z.object({
  method: z.string(),
  params: z.optional(BaseRequestParamsSchema),
});

const BaseNotificationParamsSchema = z
  .object({ _meta: z.optional(z.object({}).passthrough()) })
  .passthrough();

export const NotificationSchema = z.object({
  method: z.string(),
  params: z.optional(BaseNotificationParamsSchema),
});

export const ResultSchema = z
  .object({ _meta: z.optional(z.object({}).passthrough()) })
  .passthrough();

export const RequestIdSchema = z.union([z.string(), z.number().int()]);

export const JSONRPCRequestSchema = z
  .object({ jsonrpc: z.literal(JSONRPC_VERSION), id: RequestIdSchema })
  .merge(RequestSchema)
  .strict();

export const isJSONRPCRequest = (thing: unknown): thing is z.infer<typeof JSONRPCRequestSchema> =>
  JSONRPCRequestSchema.safeParse(thing).success;

export const JSONRPCNotificationSchema = z
  .object({ jsonrpc: z.literal(JSONRPC_VERSION) })
  .merge(NotificationSchema)
  .strict();

export const isJSONRPCNotification = (thing: unknown): thing is z.infer<typeof JSONRPCNotificationSchema> =>
  JSONRPCNotificationSchema.safeParse(thing).success;

export const JSONRPCResponseSchema = z
  .object({
    jsonrpc: z.literal(JSONRPC_VERSION),
    id: RequestIdSchema,
    result: ResultSchema,
  })
  .strict();

export const isJSONRPCResponse = (thing: unknown): thing is z.infer<typeof JSONRPCResponseSchema> =>
  JSONRPCResponseSchema.safeParse(thing).success;

export enum ErrorCode {
  ConnectionClosed = -32000,
  RequestTimeout = -32001,
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
}

export const JSONRPCErrorSchema = z
  .object({
    jsonrpc: z.literal(JSONRPC_VERSION),
    id: RequestIdSchema,
    error: z.object({
      code: z.nativeEnum(ErrorCode),
      message: z.string(),
      data: z.optional(z.unknown()),
    }),
  })
  .strict();

export const isJSONRPCError = (thing: unknown): thing is z.infer<typeof JSONRPCErrorSchema> =>
  JSONRPCErrorSchema.safeParse(thing).success;

export const JSONRPCMessageSchema = z.union([
  JSONRPCRequestSchema,
  JSONRPCNotificationSchema,
  JSONRPCResponseSchema,
  JSONRPCErrorSchema,
]);

// General Schemas
export const EmptyResultSchema = ResultSchema.strict();

export const CancelledNotificationSchema = NotificationSchema.extend({
  method: z.literal('notifications/cancelled'),
  params: BaseNotificationParamsSchema.extend({
    requestId: RequestIdSchema,
    reason: z.string().optional(),
  }),
});

export const BaseMetadataSchema = z
  .object({ name: z.string(), title: z.optional(z.string()) })
  .passthrough();

export const ImplementationSchema = BaseMetadataSchema.extend({
  version: z.string(),
});

export const ClientCapabilitiesSchema = z
  .object({
    experimental: z.optional(z.object({}).passthrough()),
    sampling: z.optional(z.object({}).passthrough()),
    elicitation: z.optional(z.object({}).passthrough()),
    roots: z.optional(
      z.object({ listChanged: z.optional(z.boolean()) }).passthrough(),
    ),
  })
  .passthrough();

export const InitializeRequestSchema = RequestSchema.extend({
  method: z.literal('initialize'),
  params: BaseRequestParamsSchema.extend({
    protocolVersion: z.string(),
    capabilities: ClientCapabilitiesSchema,
    clientInfo: ImplementationSchema,
  }),
});

export const isInitializeRequest = (thing: unknown): thing is z.infer<typeof InitializeRequestSchema> =>
  InitializeRequestSchema.safeParse(thing).success;

export const ServerCapabilitiesSchema = z
  .object({
    experimental: z.optional(z.object({}).passthrough()),
    logging: z.optional(z.object({}).passthrough()),
    completions: z.optional(z.object({}).passthrough()),
    prompts: z.optional(
      z.object({ listChanged: z.optional(z.boolean()) }).passthrough(),
    ),
    resources: z.optional(
      z
        .object({
          subscribe: z.optional(z.boolean()),
          listChanged: z.optional(z.boolean()),
        })
        .passthrough(),
    ),
    tools: z.optional(
      z.object({ listChanged: z.optional(z.boolean()) }).passthrough(),
    ),
  })
  .passthrough();

export const InitializeResultSchema = ResultSchema.extend({
  protocolVersion: z.string(),
  capabilities: ServerCapabilitiesSchema,
  serverInfo: ImplementationSchema,
  instructions: z.optional(z.string()),
});

export const InitializedNotificationSchema = NotificationSchema.extend({
  method: z.literal('notifications/initialized'),
});

export const isInitializedNotification = (thing: unknown): thing is z.infer<typeof InitializedNotificationSchema> =>
  InitializedNotificationSchema.safeParse(thing).success;

export const PingRequestSchema = RequestSchema.extend({ method: z.literal('ping') });

export const ProgressSchema = z
  .object({
    progress: z.number(),
    total: z.optional(z.number()),
    message: z.optional(z.string()),
  })
  .passthrough();

export const ProgressNotificationSchema = NotificationSchema.extend({
  method: z.literal('notifications/progress'),
  params: BaseNotificationParamsSchema
    .merge(ProgressSchema)
    .extend({ progressToken: ProgressTokenSchema }),
});

export const PaginatedRequestSchema = RequestSchema.extend({
  params: BaseRequestParamsSchema.extend({ cursor: z.optional(CursorSchema) }).optional(),
});

export const PaginatedResultSchema = ResultSchema.extend({
  nextCursor: z.optional(CursorSchema),
});

// Resource Schemas
export const ResourceContentsSchema = z
  .object({
    uri: z.string(),
    mimeType: z.optional(z.string()),
    _meta: z.optional(z.object({}).passthrough()),
  })
  .passthrough();

export const TextResourceContentsSchema = ResourceContentsSchema.extend({
  text: z.string(),
});

export const BlobResourceContentsSchema = ResourceContentsSchema.extend({
  blob: z.string().base64(),
});

export const ResourceSchema = BaseMetadataSchema.extend({
  uri: z.string(),
  description: z.optional(z.string()),
  mimeType: z.optional(z.string()),
  _meta: z.optional(z.object({}).passthrough()),
});

export const ResourceTemplateSchema = BaseMetadataSchema.extend({
  uriTemplate: z.string(),
  description: z.optional(z.string()),
  mimeType: z.optional(z.string()),
  _meta: z.optional(z.object({}).passthrough()),
});

export const ListResourcesRequestSchema = PaginatedRequestSchema.extend({
  method: z.literal('resources/list'),
});

export const ListResourcesResultSchema = PaginatedResultSchema.extend({
  resources: z.array(ResourceSchema),
});

export const ListResourceTemplatesRequestSchema = PaginatedRequestSchema.extend({
  method: z.literal('resources/templates/list'),
});

export const ListResourceTemplatesResultSchema = PaginatedResultSchema.extend({
  resourceTemplates: z.array(ResourceTemplateSchema),
});

export const ReadResourceRequestSchema = RequestSchema.extend({
  method: z.literal('resources/read'),
  params: BaseRequestParamsSchema.extend({ uri: z.string() }),
});

export const ReadResourceResultSchema = ResultSchema.extend({
  contents: z.array(
    z.union([TextResourceContentsSchema, BlobResourceContentsSchema]),
  ),
});

export const ResourceListChangedNotificationSchema = NotificationSchema.extend({
  method: z.literal('notifications/resources/list_changed'),
});

export const SubscribeRequestSchema = RequestSchema.extend({
  method: z.literal('resources/subscribe'),
  params: BaseRequestParamsSchema.extend({ uri: z.string() }),
});

export const UnsubscribeRequestSchema = RequestSchema.extend({
  method: z.literal('resources/unsubscribe'),
  params: BaseRequestParamsSchema.extend({ uri: z.string() }),
});

export const ResourceUpdatedNotificationSchema = NotificationSchema.extend({
  method: z.literal('notifications/resources/updated'),
  params: BaseNotificationParamsSchema.extend({ uri: z.string() }),
});

// Prompt Schemas
export const PromptArgumentSchema = z
  .object({
    name: z.string(),
    description: z.optional(z.string()),
    required: z.optional(z.boolean()),
  })
  .passthrough();

export const PromptSchema = BaseMetadataSchema.extend({
  description: z.optional(z.string()),
  arguments: z.optional(z.array(PromptArgumentSchema)),
  _meta: z.optional(z.object({}).passthrough()),
});

export const ListPromptsRequestSchema = PaginatedRequestSchema.extend({
  method: z.literal('prompts/list'),
});

export const ListPromptsResultSchema = PaginatedResultSchema.extend({
  prompts: z.array(PromptSchema),
});

export const GetPromptRequestSchema = RequestSchema.extend({
  method: z.literal('prompts/get'),
  params: BaseRequestParamsSchema.extend({
    name: z.string(),
    arguments: z.optional(z.record(z.string())),
  }),
});

export const TextContentSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
    _meta: z.optional(z.object({}).passthrough()),
  })
  .passthrough();

export const ImageContentSchema = z
  .object({
    type: z.literal('image'),
    data: z.string().base64(),
    mimeType: z.string(),
    _meta: z.optional(z.object({}).passthrough()),
  })
  .passthrough();

export const AudioContentSchema = z
  .object({
    type: z.literal('audio'),
    data: z.string().base64(),
    mimeType: z.string(),
    _meta: z.optional(z.object({}).passthrough()),
  })
  .passthrough();

export const EmbeddedResourceSchema = z
  .object({
    type: z.literal('resource'),
    resource: z.union([
      TextResourceContentsSchema,
      BlobResourceContentsSchema,
    ]),
    _meta: z.optional(z.object({}).passthrough()),
  })
  .passthrough();

export const ResourceLinkSchema = ResourceSchema.extend({
  type: z.literal('resource_link'),
});

export const ContentBlockSchema = z.union([
  TextContentSchema,
  ImageContentSchema,
  AudioContentSchema,
  ResourceLinkSchema,
  EmbeddedResourceSchema,
]);

export const PromptMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: ContentBlockSchema,
  })
  .passthrough();

export const GetPromptResultSchema = ResultSchema.extend({
  description: z.optional(z.string()),
  messages: z.array(PromptMessageSchema),
});

export const PromptListChangedNotificationSchema = NotificationSchema.extend({
  method: z.literal('notifications/prompts/list_changed'),
});

// Tool Schemas
export const ToolAnnotationsSchema = z
  .object({
    title: z.optional(z.string()),
    readOnlyHint: z.optional(z.boolean()),
    destructiveHint: z.optional(z.boolean()),
    idempotentHint: z.optional(z.boolean()),
    openWorldHint: z.optional(z.boolean()),
  })
  .passthrough();

export const ToolSchema = BaseMetadataSchema.extend({
  description: z.optional(z.string()),
  inputSchema: z
    .object({
      type: z.literal('object'),
      properties: z.optional(z.object({}).passthrough()),
      required: z.optional(z.array(z.string())),
    })
    .passthrough(),
  outputSchema: z.optional(
    z
      .object({
        type: z.literal('object'),
        properties: z.optional(z.object({}).passthrough()),
        required: z.optional(z.array(z.string())),
      })
      .passthrough(),
  ),
  annotations: z.optional(ToolAnnotationsSchema),
  _meta: z.optional(z.object({}).passthrough()),
});

export const ListToolsRequestSchema = PaginatedRequestSchema.extend({
  method: z.literal('tools/list'),
});

export const ListToolsResultSchema = PaginatedResultSchema.extend({
  tools: z.array(ToolSchema),
});

export const CallToolResultSchema = ResultSchema.extend({
  content: z.array(ContentBlockSchema).default([]),
  structuredContent: z.object({}).passthrough().optional(),
  isError: z.optional(z.boolean()),
});

export const CompatibilityCallToolResultSchema = CallToolResultSchema.or(
  ResultSchema.extend({ toolResult: z.unknown() }),
);

export const CallToolRequestSchema = RequestSchema.extend({
  method: z.literal('tools/call'),
  params: BaseRequestParamsSchema.extend({
    name: z.string(),
    arguments: z.optional(z.record(z.unknown())),
  }),
});

export const ToolListChangedNotificationSchema = NotificationSchema.extend({
  method: z.literal('notifications/tools/list_changed'),
});

// Logging Schemas
export const LoggingLevelSchema = z.enum([
  'debug',
  'info',
  'notice',
  'warning',
  'error',
  'critical',
  'alert',
  'emergency',
]);

export const SetLevelRequestSchema = RequestSchema.extend({
  method: z.literal('logging/setLevel'),
  params: BaseRequestParamsSchema.extend({ level: LoggingLevelSchema }),
});

export const LoggingMessageNotificationSchema = NotificationSchema.extend({
  method: z.literal('notifications/message'),
  params: BaseNotificationParamsSchema.extend({
    level: LoggingLevelSchema,
    logger: z.optional(z.string()),
    data: z.unknown(),
  }),
});

// Sampling Schemas
export const ModelHintSchema = z
  .object({ name: z.string().optional() })
  .passthrough();

export const ModelPreferencesSchema = z
  .object({
    hints: z.optional(z.array(ModelHintSchema)),
    costPriority: z.optional(z.number().min(0).max(1)),
    speedPriority: z.optional(z.number().min(0).max(1)),
    intelligencePriority: z.optional(z.number().min(0).max(1)),
  })
  .passthrough();

export const SamplingMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: z.union([
      TextContentSchema,
      ImageContentSchema,
      AudioContentSchema,
    ]),
  })
  .passthrough();

export const CreateMessageRequestSchema = RequestSchema.extend({
  method: z.literal('sampling/createMessage'),
  params: BaseRequestParamsSchema.extend({
    messages: z.array(SamplingMessageSchema),
    systemPrompt: z.optional(z.string()),
    includeContext: z.optional(
      z.enum(['none', 'thisServer', 'allServers']),
    ),
    temperature: z.optional(z.number()),
    maxTokens: z.number().int(),
    stopSequences: z.optional(z.array(z.string())),
    metadata: z.optional(z.object({}).passthrough()),
    modelPreferences: z.optional(ModelPreferencesSchema),
  }),
});

export const CreateMessageResultSchema = ResultSchema.extend({
  model: z.string(),
  stopReason: z.optional(
    z.enum(['endTurn', 'stopSequence', 'maxTokens']).or(z.string()),
  ),
  role: z.enum(['user', 'assistant']),
  content: z.discriminatedUnion('type', [
    TextContentSchema,
    ImageContentSchema,
    AudioContentSchema,
  ]),
});

// Elicitation Schemas
export const BooleanSchemaSchema = z
  .object({
    type: z.literal('boolean'),
    title: z.optional(z.string()),
    description: z.optional(z.string()),
    default: z.optional(z.boolean()),
  })
  .passthrough();

export const StringSchemaSchema = z
  .object({
    type: z.literal('string'),
    title: z.optional(z.string()),
    description: z.optional(z.string()),
    minLength: z.optional(z.number()),
    maxLength: z.optional(z.number()),
    format: z.optional(z.enum(['email', 'uri', 'date', 'date-time'])),
  })
  .passthrough();

export const NumberSchemaSchema = z
  .object({
    type: z.enum(['number', 'integer']),
    title: z.optional(z.string()),
    description: z.optional(z.string()),
    minimum: z.optional(z.number()),
    maximum: z.optional(z.number()),
  })
  .passthrough();

export const EnumSchemaSchema = z
  .object({
    type: z.literal('string'),
    title: z.optional(z.string()),
    description: z.optional(z.string()),
    enum: z.array(z.string()),
    enumNames: z.optional(z.array(z.string())),
  })
  .passthrough();

export const PrimitiveSchemaDefinitionSchema = z.union([
  BooleanSchemaSchema,
  StringSchemaSchema,
  NumberSchemaSchema,
  EnumSchemaSchema,
]);

export const ElicitRequestSchema = RequestSchema.extend({
  method: z.literal('elicitation/create'),
  params: BaseRequestParamsSchema.extend({
    message: z.string(),
    requestedSchema: z
      .object({
        type: z.literal('object'),
        properties: z.record(
          z.string(),
          PrimitiveSchemaDefinitionSchema,
        ),
        required: z.optional(z.array(z.string())),
      })
      .passthrough(),
  }),
});

export const ElicitResultSchema = ResultSchema.extend({
  action: z.enum(['accept', 'decline', 'cancel']),
  content: z.optional(z.record(z.string(), z.unknown())),
});

// Reference Schemas
export const ResourceTemplateReferenceSchema = z
  .object({ type: z.literal('ref/resource'), uri: z.string() })
  .passthrough();

export const ResourceReferenceSchema = ResourceTemplateReferenceSchema;

export const PromptReferenceSchema = z
  .object({ type: z.literal('ref/prompt'), name: z.string() })
  .passthrough();

// Completion Schemas
export const CompleteRequestSchema = RequestSchema.extend({
  method: z.literal('completion/complete'),
  params: BaseRequestParamsSchema.extend({
    ref: z.union([
      PromptReferenceSchema,
      ResourceTemplateReferenceSchema,
    ]),
    argument: z
      .object({ name: z.string(), value: z.string() })
      .passthrough(),
    context: z.optional(
      z.object({
        arguments: z.optional(z.record(z.string(), z.string())),
      }),
    ),
  }),
});

export const CompleteResultSchema = ResultSchema.extend({
  completion: z
    .object({
      values: z.array(z.string()).max(100),
      total: z.optional(z.number().int()),
      hasMore: z.optional(z.boolean()),
    })
    .passthrough(),
});

// Root Schemas
export const RootSchema = z
  .object({
    uri: z.string().startsWith('file://'),
    name: z.optional(z.string()),
    _meta: z.optional(z.object({}).passthrough()),
  })
  .passthrough();

export const ListRootsRequestSchema = RequestSchema.extend({
  method: z.literal('roots/list'),
});

export const ListRootsResultSchema = ResultSchema.extend({
  roots: z.array(RootSchema),
});

export const RootsListChangedNotificationSchema = NotificationSchema.extend({
  method: z.literal('notifications/roots/list_changed'),
});

// Client/Server Union Schemas
export const ClientRequestSchema = z.union([
  PingRequestSchema,
  InitializeRequestSchema,
  CompleteRequestSchema,
  SetLevelRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  CallToolRequestSchema,
  ListToolsRequestSchema,
]);

export const ClientNotificationSchema = z.union([
  CancelledNotificationSchema,
  ProgressNotificationSchema,
  InitializedNotificationSchema,
  RootsListChangedNotificationSchema,
]);

export const ClientResultSchema = z.union([
  EmptyResultSchema,
  CreateMessageResultSchema,
  ElicitResultSchema,
  ListRootsResultSchema,
]);

export const ServerRequestSchema = z.union([
  PingRequestSchema,
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  ListRootsRequestSchema,
]);

export const ServerNotificationSchema = z.union([
  CancelledNotificationSchema,
  ProgressNotificationSchema,
  LoggingMessageNotificationSchema,
  ResourceUpdatedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
]);

export const ServerResultSchema = z.union([
  EmptyResultSchema,
  InitializeResultSchema,
  CompleteResultSchema,
  GetPromptResultSchema,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesResultSchema,
  ReadResourceResultSchema,
  CallToolResultSchema,
  ListToolsResultSchema,
]);

// Exported types
export type ProgressToken = z.infer<typeof ProgressTokenSchema>;
export type Cursor = z.infer<typeof CursorSchema>;
export type Request = z.infer<typeof RequestSchema>;
export type Notification = z.infer<typeof NotificationSchema>;
export type Result = z.infer<typeof ResultSchema>;
export type RequestId = z.infer<typeof RequestIdSchema>;
export type JSONRPCRequest = z.infer<typeof JSONRPCRequestSchema>;
export type JSONRPCNotification = z.infer<typeof JSONRPCNotificationSchema>;
export type JSONRPCResponse = z.infer<typeof JSONRPCResponseSchema>;
export type JSONRPCError = z.infer<typeof JSONRPCErrorSchema>;
export type JSONRPCMessage = z.infer<typeof JSONRPCMessageSchema>;
export type EmptyResult = z.infer<typeof EmptyResultSchema>;
export type CancelledNotification = z.infer<typeof CancelledNotificationSchema>;
export type BaseMetadata = z.infer<typeof BaseMetadataSchema>;
export type Implementation = z.infer<typeof ImplementationSchema>;
export type ClientCapabilities = z.infer<typeof ClientCapabilitiesSchema>;
export type InitializeRequest = z.infer<typeof InitializeRequestSchema>;
export type ServerCapabilities = z.infer<typeof ServerCapabilitiesSchema>;
export type InitializeResult = z.infer<typeof InitializeResultSchema>;
export type InitializedNotification = z.infer<typeof InitializedNotificationSchema>;
export type PingRequest = z.infer<typeof PingRequestSchema>;
export type Progress = z.infer<typeof ProgressSchema>;
export type ProgressNotification = z.infer<typeof ProgressNotificationSchema>;
export type PaginatedRequest = z.infer<typeof PaginatedRequestSchema>;
export type PaginatedResult = z.infer<typeof PaginatedResultSchema>;
export type ResourceContents = z.infer<typeof ResourceContentsSchema>;
export type TextResourceContents = z.infer<typeof TextResourceContentsSchema>;
export type BlobResourceContents = z.infer<typeof BlobResourceContentsSchema>;
export type Resource = z.infer<typeof ResourceSchema>;
export type ResourceTemplate = z.infer<typeof ResourceTemplateSchema>;
export type ListResourcesRequest = z.infer<typeof ListResourcesRequestSchema>;
export type ListResourcesResult = z.infer<typeof ListResourcesResultSchema>;
export type ListResourceTemplatesRequest = z.infer<typeof ListResourceTemplatesRequestSchema>;
export type ListResourceTemplatesResult = z.infer<typeof ListResourceTemplatesResultSchema>;
export type ReadResourceRequest = z.infer<typeof ReadResourceRequestSchema>;
export type ReadResourceResult = z.infer<typeof ReadResourceResultSchema>;
export type ResourceListChangedNotification = z.infer<typeof ResourceListChangedNotificationSchema>;
export type SubscribeRequest = z.infer<typeof SubscribeRequestSchema>;
export type UnsubscribeRequest = z.infer<typeof UnsubscribeRequestSchema>;
export type ResourceUpdatedNotification = z.infer<typeof ResourceUpdatedNotificationSchema>;
export type PromptArgument = z.infer<typeof PromptArgumentSchema>;
export type Prompt = z.infer<typeof PromptSchema>;
export type ListPromptsRequest = z.infer<typeof ListPromptsRequestSchema>;
export type ListPromptsResult = z.infer<typeof ListPromptsResultSchema>;
export type GetPromptRequest = z.infer<typeof GetPromptRequestSchema>;
export type TextContent = z.infer<typeof TextContentSchema>;
export type ImageContent = z.infer<typeof ImageContentSchema>;
export type AudioContent = z.infer<typeof AudioContentSchema>;
export type EmbeddedResource = z.infer<typeof EmbeddedResourceSchema>;
export type ResourceLink = z.infer<typeof ResourceLinkSchema>;
export type ContentBlock = z.infer<typeof ContentBlockSchema>;
export type PromptMessage = z.infer<typeof PromptMessageSchema>;
export type GetPromptResult = z.infer<typeof GetPromptResultSchema>;
export type PromptListChangedNotification = z.infer<typeof PromptListChangedNotificationSchema>;
export type ToolAnnotations = z.infer<typeof ToolAnnotationsSchema>;
export type Tool = z.infer<typeof ToolSchema>;
export type ListToolsRequest = z.infer<typeof ListToolsRequestSchema>;
export type ListToolsResult = z.infer<typeof ListToolsResultSchema>;
export type CallToolResult = z.infer<typeof CallToolResultSchema>;
export type CompatibilityCallToolResult = z.infer<typeof CompatibilityCallToolResultSchema>;
export type CallToolRequest = z.infer<typeof CallToolRequestSchema>;
export type ToolListChangedNotification = z.infer<typeof ToolListChangedNotificationSchema>;
export type LoggingLevel = z.infer<typeof LoggingLevelSchema>;
export type SetLevelRequest = z.infer<typeof SetLevelRequestSchema>;
export type LoggingMessageNotification = z.infer<typeof LoggingMessageNotificationSchema>;
export type ModelHint = z.infer<typeof ModelHintSchema>;
export type ModelPreferences = z.infer<typeof ModelPreferencesSchema>;
export type SamplingMessage = z.infer<typeof SamplingMessageSchema>;
export type CreateMessageRequest = z.infer<typeof CreateMessageRequestSchema>;
export type CreateMessageResult = z.infer<typeof CreateMessageResultSchema>;
export type BooleanSchema = z.infer<typeof BooleanSchemaSchema>;
export type StringSchema = z.infer<typeof StringSchemaSchema>;
export type NumberSchema = z.infer<typeof NumberSchemaSchema>;
export type EnumSchema = z.infer<typeof EnumSchemaSchema>;
export type PrimitiveSchemaDefinition = z.infer<typeof PrimitiveSchemaDefinitionSchema>;
export type ElicitRequest = z.infer<typeof ElicitRequestSchema>;
export type ElicitResult = z.infer<typeof ElicitResultSchema>;
export type ResourceTemplateReference = z.infer<typeof ResourceTemplateReferenceSchema>;
export type ResourceReference = z.infer<typeof ResourceReferenceSchema>;
export type PromptReference = z.infer<typeof PromptReferenceSchema>;
export type CompleteRequest = z.infer<typeof CompleteRequestSchema>;
export type CompleteResult = z.infer<typeof CompleteResultSchema>;
export type Root = z.infer<typeof RootSchema>;
export type ListRootsRequest = z.infer<typeof ListRootsRequestSchema>;
export type ListRootsResult = z.infer<typeof ListRootsResultSchema>;
export type RootsListChangedNotification = z.infer<typeof RootsListChangedNotificationSchema>;
export type ClientRequest = z.infer<typeof ClientRequestSchema>;
export type ClientNotification = z.infer<typeof ClientNotificationSchema>;
export type ClientResult = z.infer<typeof ClientResultSchema>;
export type ServerRequest = z.infer<typeof ServerRequestSchema>;
export type ServerNotification = z.infer<typeof ServerNotificationSchema>;
export type ServerResult = z.infer<typeof ServerResultSchema>;