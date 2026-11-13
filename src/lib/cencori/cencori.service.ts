import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Cencori, RequestOptions, WebhookPayload } from 'cencori';
import type {
  WebExtractResult,
  WebFetchRequest,
  WebSearchRequest,
  WebSearchResponse,
} from 'cencori/web';

/** DI token for the underlying Cencori SDK client (`null` when unconfigured). */
export const CENCORI_CLIENT = Symbol('CENCORI_CLIENT');

/** Typed result of `aiGenerateObject` (the SDK does not export this type). */
export type GenerateObjectResponse<T> = Omit<
  Awaited<ReturnType<Cencori['ai']['generateObject']>>,
  'object'
> & { object: T };

/**
 * NestJS facade over the Cencori SDK (`cencori` npm package).
 *
 * Every public SDK method is exposed as a flat, injectable method named
 * `<namespace><Method>` (e.g. `cencori.ai.chat` → `aiChat`,
 * `cencori.chat.completions.create` → `chatCompletionsCreate`).
 * Signatures are derived from the SDK's own types, so they track SDK upgrades.
 *
 * The method list is generated from the installed SDK's type definitions.
 * Deprecated methods and SDK stubs that always throw ("Coming Soon":
 * compute, workflow, storage) are intentionally excluded. `sdk` exposes the
 * raw client for anything newer than this facade.
 *
 * Provided globally by CencoriModule — inject it in any provider without
 * importing the module.
 *
 * Docs: https://cencori.com/docs
 */
@Injectable()
export class CencoriService {
  constructor(
    @Inject(CENCORI_CLIENT) private readonly cencori: Cencori | null,
  ) {}

  /** True when CENCORI_API_KEY is configured. */
  get isConfigured(): boolean {
    return this.cencori !== null;
  }

  /** Raw SDK client — escape hatch for APIs not wrapped below. */
  get sdk(): Cencori {
    return this.client;
  }

  private get client(): Cencori {
    if (!this.cencori) {
      throw new ServiceUnavailableException(
        'Cencori is not configured: set CENCORI_API_KEY',
      );
    }
    return this.cencori;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Client
  // ──────────────────────────────────────────────────────────────────────

  /** Base URL the client calls. */
  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  /** Current configuration with the API key masked. */
  getConfig(): ReturnType<Cencori['getConfig']> {
    return this.client.getConfig();
  }

  /** Generic authenticated API request with retry and error handling. */
  request<T>(endpoint: string, options: RequestOptions): Promise<T> {
    return this.client.request<T>(endpoint, options);
  }

  // ──────────────────────────────────────────────────────────────────────
  // AI Gateway — chat, completions, embeddings, structured output, images, RAG, Responses API
  // ──────────────────────────────────────────────────────────────────────

  /** Create a chat completion — `cencori.ai.chat` */
  aiChat(
    ...args: Parameters<Cencori['ai']['chat']>
  ): ReturnType<Cencori['ai']['chat']> {
    return this.client.ai.chat(...args);
  }

  /** Stream chat completions — `cencori.ai.chatStream` */
  aiChatStream(
    ...args: Parameters<Cencori['ai']['chatStream']>
  ): ReturnType<Cencori['ai']['chatStream']> {
    return this.client.ai.chatStream(...args);
  }

  /** Create a text completion — `cencori.ai.completions` */
  aiCompletions(
    ...args: Parameters<Cencori['ai']['completions']>
  ): ReturnType<Cencori['ai']['completions']> {
    return this.client.ai.completions(...args);
  }

  /** Create embeddings — `cencori.ai.embeddings` */
  aiEmbeddings(
    ...args: Parameters<Cencori['ai']['embeddings']>
  ): ReturnType<Cencori['ai']['embeddings']> {
    return this.client.ai.embeddings(...args);
  }

  /** Generate structured output with JSON schema — `cencori.ai.generateObject` */
  aiGenerateObject<T = unknown>(
    ...args: Parameters<Cencori['ai']['generateObject']>
  ): Promise<GenerateObjectResponse<T>> {
    return this.client.ai.generateObject<T>(...args);
  }

  /** Generate images from a text prompt — `cencori.ai.generateImage` */
  aiGenerateImage(
    ...args: Parameters<Cencori['ai']['generateImage']>
  ): ReturnType<Cencori['ai']['generateImage']> {
    return this.client.ai.generateImage(...args);
  }

  /** Send a request to the OpenAI-compatible Responses API. — `cencori.ai.responses` */
  aiResponses(
    ...args: Parameters<Cencori['ai']['responses']>
  ): ReturnType<Cencori['ai']['responses']> {
    return this.client.ai.responses(...args);
  }

  /** Stream responses from the Responses API via SSE. — `cencori.ai.responsesStream` */
  aiResponsesStream(
    ...args: Parameters<Cencori['ai']['responsesStream']>
  ): ReturnType<Cencori['ai']['responsesStream']> {
    return this.client.ai.responsesStream(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Chat — OpenAI-compatible chat completions with gateway memory
  // ──────────────────────────────────────────────────────────────────────

  /** Create a chat completion. Include `memory: { userId }` to retrieve — `cencori.chat.completions.create` */
  chatCompletionsCreate(
    ...args: Parameters<Cencori['chat']['completions']['create']>
  ): ReturnType<Cencori['chat']['completions']['create']> {
    return this.client.chat.completions.create(...args);
  }

  /** Stream a chat completion (SSE). Memory writeback still runs after the — `cencori.chat.completions.stream` */
  chatCompletionsStream(
    ...args: Parameters<Cencori['chat']['completions']['stream']>
  ): ReturnType<Cencori['chat']['completions']['stream']> {
    return this.client.chat.completions.stream(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Vision — analyze, describe, OCR and classify images
  // ──────────────────────────────────────────────────────────────────────

  /** General image analysis — provide your own prompt. — `cencori.vision.analyze` */
  visionAnalyze(
    ...args: Parameters<Cencori['vision']['analyze']>
  ): ReturnType<Cencori['vision']['analyze']> {
    return this.client.vision.analyze(...args);
  }

  /** Describe the image in rich detail. — `cencori.vision.describe` */
  visionDescribe(
    ...args: Parameters<Cencori['vision']['describe']>
  ): ReturnType<Cencori['vision']['describe']> {
    return this.client.vision.describe(...args);
  }

  /** Extract all visible text from the image. — `cencori.vision.ocr` */
  visionOcr(
    ...args: Parameters<Cencori['vision']['ocr']>
  ): ReturnType<Cencori['vision']['ocr']> {
    return this.client.vision.ocr(...args);
  }

  /** Return structured tags, objects, and category classification. — `cencori.vision.classify` */
  visionClassify(
    ...args: Parameters<Cencori['vision']['classify']>
  ): ReturnType<Cencori['vision']['classify']> {
    return this.client.vision.classify(...args);
  }

  /** Stream a vision analysis. Yields `{ delta }` chunks as text arrives, then — `cencori.vision.analyzeStream` */
  visionAnalyzeStream(
    ...args: Parameters<Cencori['vision']['analyzeStream']>
  ): ReturnType<Cencori['vision']['analyzeStream']> {
    return this.client.vision.analyzeStream(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Voice — text-to-speech, speech-to-text and diarization
  // ──────────────────────────────────────────────────────────────────────

  /** Text-to-speech. Returns raw audio bytes plus the resolved provider. — `cencori.voice.speak` */
  voiceSpeak(
    ...args: Parameters<Cencori['voice']['speak']>
  ): ReturnType<Cencori['voice']['speak']> {
    return this.client.voice.speak(...args);
  }

  /** Speech-to-text. Provider is inferred from `model` (default `whisper-1`). — `cencori.voice.transcribe` */
  voiceTranscribe(
    ...args: Parameters<Cencori['voice']['transcribe']>
  ): ReturnType<Cencori['voice']['transcribe']> {
    return this.client.voice.transcribe(...args);
  }

  /** Speech-to-text with speaker labels. Convenience wrapper over — `cencori.voice.diarize` */
  voiceDiarize(
    ...args: Parameters<Cencori['voice']['diarize']>
  ): ReturnType<Cencori['voice']['diarize']> {
    return this.client.voice.diarize(...args);
  }

  /** List the available voice models (TTS + STT) with their providers. — `cencori.voice.listModels` */
  voiceListModels(
    ...args: Parameters<Cencori['voice']['listModels']>
  ): ReturnType<Cencori['voice']['listModels']> {
    return this.client.voice.listModels(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Judgment — structured decisions from decision models
  // ──────────────────────────────────────────────────────────────────────

  /** Judge a state against typed questions. Returns one answer per — `cencori.judgment.judge` */
  judgmentJudge(
    ...args: Parameters<Cencori['judgment']['judge']>
  ): ReturnType<Cencori['judgment']['judge']> {
    return this.client.judgment.judge(...args);
  }

  /** List the judgment models with their pricing. No API key required. — `cencori.judgment.listModels` */
  judgmentListModels(
    ...args: Parameters<Cencori['judgment']['listModels']>
  ): ReturnType<Cencori['judgment']['listModels']> {
    return this.client.judgment.listModels(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Documents — extract, summarize and query PDFs / images
  // ──────────────────────────────────────────────────────────────────────

  /** Extract text from a PDF (native, no LLM) or image (via Vision OCR). — `cencori.documents.extract` */
  documentsExtract(
    ...args: Parameters<Cencori['documents']['extract']>
  ): ReturnType<Cencori['documents']['extract']> {
    return this.client.documents.extract(...args);
  }

  /** Extract then summarize the document with a chat model. — `cencori.documents.summarize` */
  documentsSummarize(
    ...args: Parameters<Cencori['documents']['summarize']>
  ): ReturnType<Cencori['documents']['summarize']> {
    return this.client.documents.summarize(...args);
  }

  /** Extract then answer a question about the document. — `cencori.documents.query` */
  documentsQuery(
    ...args: Parameters<Cencori['documents']['query']>
  ): ReturnType<Cencori['documents']['query']> {
    return this.client.documents.query(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Agents — create and manage AI agents
  // ──────────────────────────────────────────────────────────────────────

  /** Calls `cencori.agents.create`. — `cencori.agents.create` */
  agentsCreate(
    ...args: Parameters<Cencori['agents']['create']>
  ): ReturnType<Cencori['agents']['create']> {
    return this.client.agents.create(...args);
  }

  /** Calls `cencori.agents.list`. — `cencori.agents.list` */
  agentsList(
    ...args: Parameters<Cencori['agents']['list']>
  ): ReturnType<Cencori['agents']['list']> {
    return this.client.agents.list(...args);
  }

  /** Calls `cencori.agents.get`. — `cencori.agents.get` */
  agentsGet(
    ...args: Parameters<Cencori['agents']['get']>
  ): ReturnType<Cencori['agents']['get']> {
    return this.client.agents.get(...args);
  }

  /** Calls `cencori.agents.updateConfig`. — `cencori.agents.updateConfig` */
  agentsUpdateConfig(
    ...args: Parameters<Cencori['agents']['updateConfig']>
  ): ReturnType<Cencori['agents']['updateConfig']> {
    return this.client.agents.updateConfig(...args);
  }

  /** Calls `cencori.agents.delete`. — `cencori.agents.delete` */
  agentsDelete(
    ...args: Parameters<Cencori['agents']['delete']>
  ): ReturnType<Cencori['agents']['delete']> {
    return this.client.agents.delete(...args);
  }

  /** Calls `cencori.agents.createKey`. — `cencori.agents.createKey` */
  agentsCreateKey(
    ...args: Parameters<Cencori['agents']['createKey']>
  ): ReturnType<Cencori['agents']['createKey']> {
    return this.client.agents.createKey(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Memory — vector storage, conversation history, semantic search, user memory graph
  // ──────────────────────────────────────────────────────────────────────

  /** Write a scoped memory for an end user (or session). — `cencori.memory.write` */
  memoryWrite(
    ...args: Parameters<Cencori['memory']['write']>
  ): ReturnType<Cencori['memory']['write']> {
    return this.client.memory.write(...args);
  }

  /** Semantic search over an end user's memories. — `cencori.memory.searchUser` */
  memorySearchUser(
    ...args: Parameters<Cencori['memory']['searchUser']>
  ): ReturnType<Cencori['memory']['searchUser']> {
    return this.client.memory.searchUser(...args);
  }

  /** Forget a memory by id — a hard delete, not an annotation. — `cencori.memory.forget` */
  memoryForget(
    ...args: Parameters<Cencori['memory']['forget']>
  ): ReturnType<Cencori['memory']['forget']> {
    return this.client.memory.forget(...args);
  }

  /** List an end user's memories (paginated). — `cencori.memory.list` */
  memoryList(
    ...args: Parameters<Cencori['memory']['list']>
  ): ReturnType<Cencori['memory']['list']> {
    return this.client.memory.list(...args);
  }

  /** Suggest memories worth forgetting — stale, low-strength, long-idle — `cencori.memory.forgetSuggestions` */
  memoryForgetSuggestions(
    ...args: Parameters<Cencori['memory']['forgetSuggestions']>
  ): ReturnType<Cencori['memory']['forgetSuggestions']> {
    return this.client.memory.forgetSuggestions(...args);
  }

  /** Extract entities + relations from an exchange and add them to the user's — `cencori.memory.rememberGraph` */
  memoryRememberGraph(
    ...args: Parameters<Cencori['memory']['rememberGraph']>
  ): ReturnType<Cencori['memory']['rememberGraph']> {
    return this.client.memory.rememberGraph(...args);
  }

  /** Traverse the memory graph outward from an entity, returning connected — `cencori.memory.graph` */
  memoryGraph(
    ...args: Parameters<Cencori['memory']['graph']>
  ): ReturnType<Cencori['memory']['graph']> {
    return this.client.memory.graph(...args);
  }

  /** List the entities in a user's memory graph (most-mentioned first). — `cencori.memory.entities` */
  memoryEntities(
    ...args: Parameters<Cencori['memory']['entities']>
  ): ReturnType<Cencori['memory']['entities']> {
    return this.client.memory.entities(...args);
  }

  /** Recall — search a user's memories and return an inject-ready system — `cencori.memory.recall` */
  memoryRecall(
    ...args: Parameters<Cencori['memory']['recall']>
  ): ReturnType<Cencori['memory']['recall']> {
    return this.client.memory.recall(...args);
  }

  /** Fetch one scoped memory's full content by id — the "pull the full note" — `cencori.memory.fetch` */
  memoryFetch(
    ...args: Parameters<Cencori['memory']['fetch']>
  ): ReturnType<Cencori['memory']['fetch']> {
    return this.client.memory.fetch(...args);
  }

  /** Remember — hand us a completed {user, assistant} exchange and we extract — `cencori.memory.remember` */
  memoryRemember(
    ...args: Parameters<Cencori['memory']['remember']>
  ): ReturnType<Cencori['memory']['remember']> {
    return this.client.memory.remember(...args);
  }

  /** Write up to 50 memories in one call — one quota check, one embedding — `cencori.memory.writeBatch` */
  memoryWriteBatch(
    ...args: Parameters<Cencori['memory']['writeBatch']>
  ): ReturnType<Cencori['memory']['writeBatch']> {
    return this.client.memory.writeBatch(...args);
  }

  /** Forget memories by filter — a hard delete, audit-logged. At least a — `cencori.memory.forgetByFilter` */
  memoryForgetByFilter(
    ...args: Parameters<Cencori['memory']['forgetByFilter']>
  ): ReturnType<Cencori['memory']['forgetByFilter']> {
    return this.client.memory.forgetByFilter(...args);
  }

  /** GDPR export — a portable dump of everything stored about a scope key. — `cencori.memory.export` */
  memoryExport(
    ...args: Parameters<Cencori['memory']['export']>
  ): ReturnType<Cencori['memory']['export']> {
    return this.client.memory.export(...args);
  }

  /** Confirm an async chat writeback. The chat response carries — `cencori.memory.writeStatus` */
  memoryWriteStatus(
    ...args: Parameters<Cencori['memory']['writeStatus']>
  ): ReturnType<Cencori['memory']['writeStatus']> {
    return this.client.memory.writeStatus(...args);
  }

  /** Create a new memory namespace — `cencori.memory.createNamespace` */
  memoryCreateNamespace(
    ...args: Parameters<Cencori['memory']['createNamespace']>
  ): ReturnType<Cencori['memory']['createNamespace']> {
    return this.client.memory.createNamespace(...args);
  }

  /** List all namespaces for the project — `cencori.memory.listNamespaces` */
  memoryListNamespaces(
    ...args: Parameters<Cencori['memory']['listNamespaces']>
  ): ReturnType<Cencori['memory']['listNamespaces']> {
    return this.client.memory.listNamespaces(...args);
  }

  /** Store a memory in a namespace — `cencori.memory.store` */
  memoryStore(
    ...args: Parameters<Cencori['memory']['store']>
  ): ReturnType<Cencori['memory']['store']> {
    return this.client.memory.store(...args);
  }

  /** Semantic search across memories — `cencori.memory.search` */
  memorySearch(
    ...args: Parameters<Cencori['memory']['search']>
  ): ReturnType<Cencori['memory']['search']> {
    return this.client.memory.search(...args);
  }

  /** Get a memory by ID — `cencori.memory.get` */
  memoryGet(
    ...args: Parameters<Cencori['memory']['get']>
  ): ReturnType<Cencori['memory']['get']> {
    return this.client.memory.get(...args);
  }

  /** Delete a memory by ID — `cencori.memory.delete` */
  memoryDelete(
    ...args: Parameters<Cencori['memory']['delete']>
  ): ReturnType<Cencori['memory']['delete']> {
    return this.client.memory.delete(...args);
  }

  /** Store multiple memories in batch — `cencori.memory.storeBatch` */
  memoryStoreBatch(
    ...args: Parameters<Cencori['memory']['storeBatch']>
  ): ReturnType<Cencori['memory']['storeBatch']> {
    return this.client.memory.storeBatch(...args);
  }

  /** Delete all memories in a namespace matching a filter — `cencori.memory.deleteByFilter` */
  memoryDeleteByFilter(
    ...args: Parameters<Cencori['memory']['deleteByFilter']>
  ): ReturnType<Cencori['memory']['deleteByFilter']> {
    return this.client.memory.deleteByFilter(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Sessions — durable agent execution with pause / resume and event sourcing
  // ──────────────────────────────────────────────────────────────────────

  /** Calls `cencori.sessions.create`. — `cencori.sessions.create` */
  sessionsCreate(
    ...args: Parameters<Cencori['sessions']['create']>
  ): ReturnType<Cencori['sessions']['create']> {
    return this.client.sessions.create(...args);
  }

  /** Calls `cencori.sessions.list`. — `cencori.sessions.list` */
  sessionsList(
    ...args: Parameters<Cencori['sessions']['list']>
  ): ReturnType<Cencori['sessions']['list']> {
    return this.client.sessions.list(...args);
  }

  /** Calls `cencori.sessions.get`. — `cencori.sessions.get` */
  sessionsGet(
    ...args: Parameters<Cencori['sessions']['get']>
  ): ReturnType<Cencori['sessions']['get']> {
    return this.client.sessions.get(...args);
  }

  /** Calls `cencori.sessions.delete`. — `cencori.sessions.delete` */
  sessionsDelete(
    ...args: Parameters<Cencori['sessions']['delete']>
  ): ReturnType<Cencori['sessions']['delete']> {
    return this.client.sessions.delete(...args);
  }

  /** Calls `cencori.sessions.submitTurn`. — `cencori.sessions.submitTurn` */
  sessionsSubmitTurn(
    ...args: Parameters<Cencori['sessions']['submitTurn']>
  ): ReturnType<Cencori['sessions']['submitTurn']> {
    return this.client.sessions.submitTurn(...args);
  }

  /** Calls `cencori.sessions.submitTurnStream`. — `cencori.sessions.submitTurnStream` */
  sessionsSubmitTurnStream(
    ...args: Parameters<Cencori['sessions']['submitTurnStream']>
  ): ReturnType<Cencori['sessions']['submitTurnStream']> {
    return this.client.sessions.submitTurnStream(...args);
  }

  /** Calls `cencori.sessions.getEvents`. — `cencori.sessions.getEvents` */
  sessionsGetEvents(
    ...args: Parameters<Cencori['sessions']['getEvents']>
  ): ReturnType<Cencori['sessions']['getEvents']> {
    return this.client.sessions.getEvents(...args);
  }

  /** Calls `cencori.sessions.approve`. — `cencori.sessions.approve` */
  sessionsApprove(
    ...args: Parameters<Cencori['sessions']['approve']>
  ): ReturnType<Cencori['sessions']['approve']> {
    return this.client.sessions.approve(...args);
  }

  /** Calls `cencori.sessions.approveStream`. — `cencori.sessions.approveStream` */
  sessionsApproveStream(
    ...args: Parameters<Cencori['sessions']['approveStream']>
  ): ReturnType<Cencori['sessions']['approveStream']> {
    return this.client.sessions.approveStream(...args);
  }

  /** Calls `cencori.sessions.reject`. — `cencori.sessions.reject` */
  sessionsReject(
    ...args: Parameters<Cencori['sessions']['reject']>
  ): ReturnType<Cencori['sessions']['reject']> {
    return this.client.sessions.reject(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Telemetry — report web traffic to the Cencori dashboard
  // ──────────────────────────────────────────────────────────────────────

  /** Report a web request to the Cencori dashboard. — `cencori.telemetry.reportWebRequest` */
  telemetryReportWebRequest(
    ...args: Parameters<Cencori['telemetry']['reportWebRequest']>
  ): ReturnType<Cencori['telemetry']['reportWebRequest']> {
    return this.client.telemetry.reportWebRequest(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Web — first-party retrieval, extraction, crawling, search and browsing
  // ──────────────────────────────────────────────────────────────────────

  /** Retrieve a bounded text resource. Returned page content is untrusted input. — `cencori.web.fetch` */
  webFetch(
    ...args: Parameters<Cencori['web']['fetch']>
  ): ReturnType<Cencori['web']['fetch']> {
    return this.client.web.fetch(...args);
  }

  /** Retrieve and convert a page into clean text, links, metadata, and evidence spans. — `cencori.web.extract` */
  webExtract(
    ...args: Parameters<Cencori['web']['extract']>
  ): ReturnType<Cencori['web']['extract']> {
    return this.client.web.extract(...args);
  }

  /** Crawl a bounded URL set and add the extracted documents to this project's index. — `cencori.web.crawl` */
  webCrawl(
    ...args: Parameters<Cencori['web']['crawl']>
  ): ReturnType<Cencori['web']['crawl']> {
    return this.client.web.crawl(...args);
  }

  /** Search the public web through Cencori's managed search capability. — `cencori.web.search` */
  webSearch(
    ...args: Parameters<Cencori['web']['search']>
  ): ReturnType<Cencori['web']['search']> {
    return this.client.web.search(...args);
  }

  /** Queue an isolated JavaScript browser exploration on Cencori-owned workers. — `cencori.web.browse` */
  webBrowse(
    ...args: Parameters<Cencori['web']['browse']>
  ): ReturnType<Cencori['web']['browse']> {
    return this.client.web.browse(...args);
  }

  /** Poll an isolated browser exploration until it completes or fails. — `cencori.web.browserJob` */
  webBrowserJob(
    ...args: Parameters<Cencori['web']['browserJob']>
  ): ReturnType<Cencori['web']['browserJob']> {
    return this.client.web.browserJob(...args);
  }

  /** Submit a copyright, privacy, legal, robots, or other removal request. — `cencori.web.requestTakedown` */
  webRequestTakedown(
    ...args: Parameters<Cencori['web']['requestTakedown']>
  ): ReturnType<Cencori['web']['requestTakedown']> {
    return this.client.web.requestTakedown(...args);
  }

  /** Resolve a Cencori web function call emitted from WEB_SEARCH_TOOL or WEB_FETCH_TOOL. — `cencori.web.executeTool` */
  webExecuteTool(
    name: 'web_search',
    args: WebSearchRequest,
  ): Promise<WebSearchResponse>;
  webExecuteTool(
    name: 'web_fetch',
    args: WebFetchRequest,
  ): Promise<WebExtractResult>;
  webExecuteTool(
    name: string,
    args: WebSearchRequest | WebFetchRequest,
  ): Promise<WebSearchResponse | WebExtractResult>;
  webExecuteTool(
    name: string,
    args: WebSearchRequest | WebFetchRequest,
  ): Promise<WebSearchResponse | WebExtractResult> {
    return this.client.web.executeTool(name, args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Embedded Agents: Tenants
  // ──────────────────────────────────────────────────────────────────────

  /** Calls `cencori.tenants.create`. — `cencori.tenants.create` */
  tenantsCreate(
    ...args: Parameters<Cencori['tenants']['create']>
  ): ReturnType<Cencori['tenants']['create']> {
    return this.client.tenants.create(...args);
  }

  /** Calls `cencori.tenants.list`. — `cencori.tenants.list` */
  tenantsList(
    ...args: Parameters<Cencori['tenants']['list']>
  ): ReturnType<Cencori['tenants']['list']> {
    return this.client.tenants.list(...args);
  }

  /** Calls `cencori.tenants.get`. — `cencori.tenants.get` */
  tenantsGet(
    ...args: Parameters<Cencori['tenants']['get']>
  ): ReturnType<Cencori['tenants']['get']> {
    return this.client.tenants.get(...args);
  }

  /** Calls `cencori.tenants.update`. — `cencori.tenants.update` */
  tenantsUpdate(
    ...args: Parameters<Cencori['tenants']['update']>
  ): ReturnType<Cencori['tenants']['update']> {
    return this.client.tenants.update(...args);
  }

  /** Calls `cencori.tenants.remove`. — `cencori.tenants.remove` */
  tenantsRemove(
    ...args: Parameters<Cencori['tenants']['remove']>
  ): ReturnType<Cencori['tenants']['remove']> {
    return this.client.tenants.remove(...args);
  }

  /** Calls `cencori.tenants.exportData`. — `cencori.tenants.exportData` */
  tenantsExportData(
    ...args: Parameters<Cencori['tenants']['exportData']>
  ): ReturnType<Cencori['tenants']['exportData']> {
    return this.client.tenants.exportData(...args);
  }

  /** Calls `cencori.tenants.upsertUser`. — `cencori.tenants.upsertUser` */
  tenantsUpsertUser(
    ...args: Parameters<Cencori['tenants']['upsertUser']>
  ): ReturnType<Cencori['tenants']['upsertUser']> {
    return this.client.tenants.upsertUser(...args);
  }

  /** Calls `cencori.tenants.getUser`. — `cencori.tenants.getUser` */
  tenantsGetUser(
    ...args: Parameters<Cencori['tenants']['getUser']>
  ): ReturnType<Cencori['tenants']['getUser']> {
    return this.client.tenants.getUser(...args);
  }

  /** Calls `cencori.tenants.patchUser`. — `cencori.tenants.patchUser` */
  tenantsPatchUser(
    ...args: Parameters<Cencori['tenants']['patchUser']>
  ): ReturnType<Cencori['tenants']['patchUser']> {
    return this.client.tenants.patchUser(...args);
  }

  /** Calls `cencori.tenants.listUsers`. — `cencori.tenants.listUsers` */
  tenantsListUsers(
    ...args: Parameters<Cencori['tenants']['listUsers']>
  ): ReturnType<Cencori['tenants']['listUsers']> {
    return this.client.tenants.listUsers(...args);
  }

  /** Calls `cencori.tenants.deleteUser`. — `cencori.tenants.deleteUser` */
  tenantsDeleteUser(
    ...args: Parameters<Cencori['tenants']['deleteUser']>
  ): ReturnType<Cencori['tenants']['deleteUser']> {
    return this.client.tenants.deleteUser(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Embedded Agents: Client tokens
  // ──────────────────────────────────────────────────────────────────────

  /** Calls `cencori.clientTokens.mint`. — `cencori.clientTokens.mint` */
  clientTokensMint(
    ...args: Parameters<Cencori['clientTokens']['mint']>
  ): ReturnType<Cencori['clientTokens']['mint']> {
    return this.client.clientTokens.mint(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Embedded Agents: Models
  // ──────────────────────────────────────────────────────────────────────

  /** Calls `cencori.models.list`. — `cencori.models.list` */
  modelsList(
    ...args: Parameters<Cencori['models']['list']>
  ): ReturnType<Cencori['models']['list']> {
    return this.client.models.list(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Embedded Agents: Provider connections (BYOK)
  // ──────────────────────────────────────────────────────────────────────

  /** Calls `cencori.providerConnections.create`. — `cencori.providerConnections.create` */
  providerConnectionsCreate(
    ...args: Parameters<Cencori['providerConnections']['create']>
  ): ReturnType<Cencori['providerConnections']['create']> {
    return this.client.providerConnections.create(...args);
  }

  /** Calls `cencori.providerConnections.list`. — `cencori.providerConnections.list` */
  providerConnectionsList(
    ...args: Parameters<Cencori['providerConnections']['list']>
  ): ReturnType<Cencori['providerConnections']['list']> {
    return this.client.providerConnections.list(...args);
  }

  /** Calls `cencori.providerConnections.get`. — `cencori.providerConnections.get` */
  providerConnectionsGet(
    ...args: Parameters<Cencori['providerConnections']['get']>
  ): ReturnType<Cencori['providerConnections']['get']> {
    return this.client.providerConnections.get(...args);
  }

  /** Calls `cencori.providerConnections.update`. — `cencori.providerConnections.update` */
  providerConnectionsUpdate(
    ...args: Parameters<Cencori['providerConnections']['update']>
  ): ReturnType<Cencori['providerConnections']['update']> {
    return this.client.providerConnections.update(...args);
  }

  /** Calls `cencori.providerConnections.remove`. — `cencori.providerConnections.remove` */
  providerConnectionsRemove(
    ...args: Parameters<Cencori['providerConnections']['remove']>
  ): ReturnType<Cencori['providerConnections']['remove']> {
    return this.client.providerConnections.remove(...args);
  }

  /** Calls `cencori.providerConnections.validate`. — `cencori.providerConnections.validate` */
  providerConnectionsValidate(
    ...args: Parameters<Cencori['providerConnections']['validate']>
  ): ReturnType<Cencori['providerConnections']['validate']> {
    return this.client.providerConnections.validate(...args);
  }

  /** Calls `cencori.providerConnections.test`. — `cencori.providerConnections.test` */
  providerConnectionsTest(
    ...args: Parameters<Cencori['providerConnections']['test']>
  ): ReturnType<Cencori['providerConnections']['test']> {
    return this.client.providerConnections.test(...args);
  }

  /** Calls `cencori.providerConnections.previewSync`. — `cencori.providerConnections.previewSync` */
  providerConnectionsPreviewSync(
    ...args: Parameters<Cencori['providerConnections']['previewSync']>
  ): ReturnType<Cencori['providerConnections']['previewSync']> {
    return this.client.providerConnections.previewSync(...args);
  }

  /** Calls `cencori.providerConnections.getSync`. — `cencori.providerConnections.getSync` */
  providerConnectionsGetSync(
    ...args: Parameters<Cencori['providerConnections']['getSync']>
  ): ReturnType<Cencori['providerConnections']['getSync']> {
    return this.client.providerConnections.getSync(...args);
  }

  /** Calls `cencori.providerConnections.applySync`. — `cencori.providerConnections.applySync` */
  providerConnectionsApplySync(
    ...args: Parameters<Cencori['providerConnections']['applySync']>
  ): ReturnType<Cencori['providerConnections']['applySync']> {
    return this.client.providerConnections.applySync(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Embedded Agents: Agent versions
  // ──────────────────────────────────────────────────────────────────────

  /** Calls `cencori.agentVersions.create`. — `cencori.agentVersions.create` */
  agentVersionsCreate(
    ...args: Parameters<Cencori['agentVersions']['create']>
  ): ReturnType<Cencori['agentVersions']['create']> {
    return this.client.agentVersions.create(...args);
  }

  /** Calls `cencori.agentVersions.list`. — `cencori.agentVersions.list` */
  agentVersionsList(
    ...args: Parameters<Cencori['agentVersions']['list']>
  ): ReturnType<Cencori['agentVersions']['list']> {
    return this.client.agentVersions.list(...args);
  }

  /** Calls `cencori.agentVersions.get`. — `cencori.agentVersions.get` */
  agentVersionsGet(
    ...args: Parameters<Cencori['agentVersions']['get']>
  ): ReturnType<Cencori['agentVersions']['get']> {
    return this.client.agentVersions.get(...args);
  }

  /** Calls `cencori.agentVersions.validate`. — `cencori.agentVersions.validate` */
  agentVersionsValidate(
    ...args: Parameters<Cencori['agentVersions']['validate']>
  ): ReturnType<Cencori['agentVersions']['validate']> {
    return this.client.agentVersions.validate(...args);
  }

  /** Calls `cencori.agentVersions.submit`. — `cencori.agentVersions.submit` */
  agentVersionsSubmit(
    ...args: Parameters<Cencori['agentVersions']['submit']>
  ): ReturnType<Cencori['agentVersions']['submit']> {
    return this.client.agentVersions.submit(...args);
  }

  /** Calls `cencori.agentVersions.review`. — `cencori.agentVersions.review` */
  agentVersionsReview(
    ...args: Parameters<Cencori['agentVersions']['review']>
  ): ReturnType<Cencori['agentVersions']['review']> {
    return this.client.agentVersions.review(...args);
  }

  /** Calls `cencori.agentVersions.publish`. — `cencori.agentVersions.publish` */
  agentVersionsPublish(
    ...args: Parameters<Cencori['agentVersions']['publish']>
  ): ReturnType<Cencori['agentVersions']['publish']> {
    return this.client.agentVersions.publish(...args);
  }

  /** Calls `cencori.agentVersions.test`. — `cencori.agentVersions.test` */
  agentVersionsTest(
    ...args: Parameters<Cencori['agentVersions']['test']>
  ): ReturnType<Cencori['agentVersions']['test']> {
    return this.client.agentVersions.test(...args);
  }

  /** Calls `cencori.agentVersions.deprecate`. — `cencori.agentVersions.deprecate` */
  agentVersionsDeprecate(
    ...args: Parameters<Cencori['agentVersions']['deprecate']>
  ): ReturnType<Cencori['agentVersions']['deprecate']> {
    return this.client.agentVersions.deprecate(...args);
  }

  /** Calls `cencori.agentVersions.retire`. — `cencori.agentVersions.retire` */
  agentVersionsRetire(
    ...args: Parameters<Cencori['agentVersions']['retire']>
  ): ReturnType<Cencori['agentVersions']['retire']> {
    return this.client.agentVersions.retire(...args);
  }

  /** Calls `cencori.agentVersions.catalog`. — `cencori.agentVersions.catalog` */
  agentVersionsCatalog(
    ...args: Parameters<Cencori['agentVersions']['catalog']>
  ): ReturnType<Cencori['agentVersions']['catalog']> {
    return this.client.agentVersions.catalog(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Embedded Agents: Installations
  // ──────────────────────────────────────────────────────────────────────

  /** Calls `cencori.installations.create`. — `cencori.installations.create` */
  installationsCreate(
    ...args: Parameters<Cencori['installations']['create']>
  ): ReturnType<Cencori['installations']['create']> {
    return this.client.installations.create(...args);
  }

  /** Calls `cencori.installations.list`. — `cencori.installations.list` */
  installationsList(
    ...args: Parameters<Cencori['installations']['list']>
  ): ReturnType<Cencori['installations']['list']> {
    return this.client.installations.list(...args);
  }

  /** Calls `cencori.installations.get`. — `cencori.installations.get` */
  installationsGet(
    ...args: Parameters<Cencori['installations']['get']>
  ): ReturnType<Cencori['installations']['get']> {
    return this.client.installations.get(...args);
  }

  /** Calls `cencori.installations.update`. — `cencori.installations.update` */
  installationsUpdate(
    ...args: Parameters<Cencori['installations']['update']>
  ): ReturnType<Cencori['installations']['update']> {
    return this.client.installations.update(...args);
  }

  /** Calls `cencori.installations.remove`. — `cencori.installations.remove` */
  installationsRemove(
    ...args: Parameters<Cencori['installations']['remove']>
  ): ReturnType<Cencori['installations']['remove']> {
    return this.client.installations.remove(...args);
  }

  /** Calls `cencori.installations.upgrade`. — `cencori.installations.upgrade` */
  installationsUpgrade(
    ...args: Parameters<Cencori['installations']['upgrade']>
  ): ReturnType<Cencori['installations']['upgrade']> {
    return this.client.installations.upgrade(...args);
  }

  /** Calls `cencori.installations.rollback`. — `cencori.installations.rollback` */
  installationsRollback(
    ...args: Parameters<Cencori['installations']['rollback']>
  ): ReturnType<Cencori['installations']['rollback']> {
    return this.client.installations.rollback(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Embedded Agents: Runs
  // ──────────────────────────────────────────────────────────────────────

  /** Calls `cencori.runs.create`. — `cencori.runs.create` */
  runsCreate(
    ...args: Parameters<Cencori['runs']['create']>
  ): ReturnType<Cencori['runs']['create']> {
    return this.client.runs.create(...args);
  }

  /** Calls `cencori.runs.history`. — `cencori.runs.history` */
  runsHistory(
    ...args: Parameters<Cencori['runs']['history']>
  ): ReturnType<Cencori['runs']['history']> {
    return this.client.runs.history(...args);
  }

  /** Calls `cencori.runs.get`. — `cencori.runs.get` */
  runsGet(
    ...args: Parameters<Cencori['runs']['get']>
  ): ReturnType<Cencori['runs']['get']> {
    return this.client.runs.get(...args);
  }

  /** Calls `cencori.runs.events`. — `cencori.runs.events` */
  runsEvents(
    ...args: Parameters<Cencori['runs']['events']>
  ): ReturnType<Cencori['runs']['events']> {
    return this.client.runs.events(...args);
  }

  /** Calls `cencori.runs.cancel`. — `cencori.runs.cancel` */
  runsCancel(
    ...args: Parameters<Cencori['runs']['cancel']>
  ): ReturnType<Cencori['runs']['cancel']> {
    return this.client.runs.cancel(...args);
  }

  /** Calls `cencori.runs.delegate`. — `cencori.runs.delegate` */
  runsDelegate(
    ...args: Parameters<Cencori['runs']['delegate']>
  ): ReturnType<Cencori['runs']['delegate']> {
    return this.client.runs.delegate(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Embedded Agents: Actions (human-in-the-loop approvals)
  // ──────────────────────────────────────────────────────────────────────

  /** Calls `cencori.actions.create`. — `cencori.actions.create` */
  actionsCreate(
    ...args: Parameters<Cencori['actions']['create']>
  ): ReturnType<Cencori['actions']['create']> {
    return this.client.actions.create(...args);
  }

  /** Calls `cencori.actions.get`. — `cencori.actions.get` */
  actionsGet(
    ...args: Parameters<Cencori['actions']['get']>
  ): ReturnType<Cencori['actions']['get']> {
    return this.client.actions.get(...args);
  }

  /** Calls `cencori.actions.approve`. — `cencori.actions.approve` */
  actionsApprove(
    ...args: Parameters<Cencori['actions']['approve']>
  ): ReturnType<Cencori['actions']['approve']> {
    return this.client.actions.approve(...args);
  }

  /** Calls `cencori.actions.reject`. — `cencori.actions.reject` */
  actionsReject(
    ...args: Parameters<Cencori['actions']['reject']>
  ): ReturnType<Cencori['actions']['reject']> {
    return this.client.actions.reject(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Embedded Agents: Knowledge bases
  // ──────────────────────────────────────────────────────────────────────

  /** Calls `cencori.knowledge.createBase`. — `cencori.knowledge.createBase` */
  knowledgeCreateBase(
    ...args: Parameters<Cencori['knowledge']['createBase']>
  ): ReturnType<Cencori['knowledge']['createBase']> {
    return this.client.knowledge.createBase(...args);
  }

  /** Calls `cencori.knowledge.listBases`. — `cencori.knowledge.listBases` */
  knowledgeListBases(
    ...args: Parameters<Cencori['knowledge']['listBases']>
  ): ReturnType<Cencori['knowledge']['listBases']> {
    return this.client.knowledge.listBases(...args);
  }

  /** Calls `cencori.knowledge.getBase`. — `cencori.knowledge.getBase` */
  knowledgeGetBase(
    ...args: Parameters<Cencori['knowledge']['getBase']>
  ): ReturnType<Cencori['knowledge']['getBase']> {
    return this.client.knowledge.getBase(...args);
  }

  /** Calls `cencori.knowledge.updateBase`. — `cencori.knowledge.updateBase` */
  knowledgeUpdateBase(
    ...args: Parameters<Cencori['knowledge']['updateBase']>
  ): ReturnType<Cencori['knowledge']['updateBase']> {
    return this.client.knowledge.updateBase(...args);
  }

  /** Calls `cencori.knowledge.removeBase`. — `cencori.knowledge.removeBase` */
  knowledgeRemoveBase(
    ...args: Parameters<Cencori['knowledge']['removeBase']>
  ): ReturnType<Cencori['knowledge']['removeBase']> {
    return this.client.knowledge.removeBase(...args);
  }

  /** Calls `cencori.knowledge.addInlineSource`. — `cencori.knowledge.addInlineSource` */
  knowledgeAddInlineSource(
    ...args: Parameters<Cencori['knowledge']['addInlineSource']>
  ): ReturnType<Cencori['knowledge']['addInlineSource']> {
    return this.client.knowledge.addInlineSource(...args);
  }

  /** Upload a file (PDF, DOCX, Markdown, HTML, CSV, JSON or plain text, up — `cencori.knowledge.addFileSource` */
  knowledgeAddFileSource(
    ...args: Parameters<Cencori['knowledge']['addFileSource']>
  ): ReturnType<Cencori['knowledge']['addFileSource']> {
    return this.client.knowledge.addFileSource(...args);
  }

  /** Calls `cencori.knowledge.listSources`. — `cencori.knowledge.listSources` */
  knowledgeListSources(
    ...args: Parameters<Cencori['knowledge']['listSources']>
  ): ReturnType<Cencori['knowledge']['listSources']> {
    return this.client.knowledge.listSources(...args);
  }

  /** Calls `cencori.knowledge.getSource`. — `cencori.knowledge.getSource` */
  knowledgeGetSource(
    ...args: Parameters<Cencori['knowledge']['getSource']>
  ): ReturnType<Cencori['knowledge']['getSource']> {
    return this.client.knowledge.getSource(...args);
  }

  /** Calls `cencori.knowledge.removeSource`. — `cencori.knowledge.removeSource` */
  knowledgeRemoveSource(
    ...args: Parameters<Cencori['knowledge']['removeSource']>
  ): ReturnType<Cencori['knowledge']['removeSource']> {
    return this.client.knowledge.removeSource(...args);
  }

  /** Calls `cencori.knowledge.syncSource`. — `cencori.knowledge.syncSource` */
  knowledgeSyncSource(
    ...args: Parameters<Cencori['knowledge']['syncSource']>
  ): ReturnType<Cencori['knowledge']['syncSource']> {
    return this.client.knowledge.syncSource(...args);
  }

  /** Calls `cencori.knowledge.listGrants`. — `cencori.knowledge.listGrants` */
  knowledgeListGrants(
    ...args: Parameters<Cencori['knowledge']['listGrants']>
  ): ReturnType<Cencori['knowledge']['listGrants']> {
    return this.client.knowledge.listGrants(...args);
  }

  /** Calls `cencori.knowledge.revokeGrant`. — `cencori.knowledge.revokeGrant` */
  knowledgeRevokeGrant(
    ...args: Parameters<Cencori['knowledge']['revokeGrant']>
  ): ReturnType<Cencori['knowledge']['revokeGrant']> {
    return this.client.knowledge.revokeGrant(...args);
  }

  /** Calls `cencori.knowledge.grant`. — `cencori.knowledge.grant` */
  knowledgeGrant(
    ...args: Parameters<Cencori['knowledge']['grant']>
  ): ReturnType<Cencori['knowledge']['grant']> {
    return this.client.knowledge.grant(...args);
  }

  /** Calls `cencori.knowledge.search`. — `cencori.knowledge.search` */
  knowledgeSearch(
    ...args: Parameters<Cencori['knowledge']['search']>
  ): ReturnType<Cencori['knowledge']['search']> {
    return this.client.knowledge.search(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Embedded Agents: Connections
  // ──────────────────────────────────────────────────────────────────────

  /** Calls `cencori.connections.listConnectors`. — `cencori.connections.listConnectors` */
  connectionsListConnectors(
    ...args: Parameters<Cencori['connections']['listConnectors']>
  ): ReturnType<Cencori['connections']['listConnectors']> {
    return this.client.connections.listConnectors(...args);
  }

  /** Calls `cencori.connections.getConnector`. — `cencori.connections.getConnector` */
  connectionsGetConnector(
    ...args: Parameters<Cencori['connections']['getConnector']>
  ): ReturnType<Cencori['connections']['getConnector']> {
    return this.client.connections.getConnector(...args);
  }

  /** Calls `cencori.connections.create`. — `cencori.connections.create` */
  connectionsCreate(
    ...args: Parameters<Cencori['connections']['create']>
  ): ReturnType<Cencori['connections']['create']> {
    return this.client.connections.create(...args);
  }

  /** Calls `cencori.connections.list`. — `cencori.connections.list` */
  connectionsList(
    ...args: Parameters<Cencori['connections']['list']>
  ): ReturnType<Cencori['connections']['list']> {
    return this.client.connections.list(...args);
  }

  /** Calls `cencori.connections.get`. — `cencori.connections.get` */
  connectionsGet(
    ...args: Parameters<Cencori['connections']['get']>
  ): ReturnType<Cencori['connections']['get']> {
    return this.client.connections.get(...args);
  }

  /** Calls `cencori.connections.update`. — `cencori.connections.update` */
  connectionsUpdate(
    ...args: Parameters<Cencori['connections']['update']>
  ): ReturnType<Cencori['connections']['update']> {
    return this.client.connections.update(...args);
  }

  /** Calls `cencori.connections.remove`. — `cencori.connections.remove` */
  connectionsRemove(
    ...args: Parameters<Cencori['connections']['remove']>
  ): ReturnType<Cencori['connections']['remove']> {
    return this.client.connections.remove(...args);
  }

  /** Calls `cencori.connections.authorize`. — `cencori.connections.authorize` */
  connectionsAuthorize(
    ...args: Parameters<Cencori['connections']['authorize']>
  ): ReturnType<Cencori['connections']['authorize']> {
    return this.client.connections.authorize(...args);
  }

  /** Calls `cencori.connections.test`. — `cencori.connections.test` */
  connectionsTest(
    ...args: Parameters<Cencori['connections']['test']>
  ): ReturnType<Cencori['connections']['test']> {
    return this.client.connections.test(...args);
  }

  /** Calls `cencori.connections.refresh`. — `cencori.connections.refresh` */
  connectionsRefresh(
    ...args: Parameters<Cencori['connections']['refresh']>
  ): ReturnType<Cencori['connections']['refresh']> {
    return this.client.connections.refresh(...args);
  }

  /** Calls `cencori.connections.registerMcpServer`. — `cencori.connections.registerMcpServer` */
  connectionsRegisterMcpServer(
    ...args: Parameters<Cencori['connections']['registerMcpServer']>
  ): ReturnType<Cencori['connections']['registerMcpServer']> {
    return this.client.connections.registerMcpServer(...args);
  }

  /** Calls `cencori.connections.mcpTools`. — `cencori.connections.mcpTools` */
  connectionsMcpTools(
    ...args: Parameters<Cencori['connections']['mcpTools']>
  ): ReturnType<Cencori['connections']['mcpTools']> {
    return this.client.connections.mcpTools(...args);
  }

  /** Calls `cencori.connections.refreshMcpTools`. — `cencori.connections.refreshMcpTools` */
  connectionsRefreshMcpTools(
    ...args: Parameters<Cencori['connections']['refreshMcpTools']>
  ): ReturnType<Cencori['connections']['refreshMcpTools']> {
    return this.client.connections.refreshMcpTools(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Embedded Agents: MCP servers
  // ──────────────────────────────────────────────────────────────────────

  /** Calls `cencori.mcpServers.list`. — `cencori.mcpServers.list` */
  mcpServersList(
    ...args: Parameters<Cencori['mcpServers']['list']>
  ): ReturnType<Cencori['mcpServers']['list']> {
    return this.client.mcpServers.list(...args);
  }

  /** Calls `cencori.mcpServers.get`. — `cencori.mcpServers.get` */
  mcpServersGet(
    ...args: Parameters<Cencori['mcpServers']['get']>
  ): ReturnType<Cencori['mcpServers']['get']> {
    return this.client.mcpServers.get(...args);
  }

  /** Calls `cencori.mcpServers.register`. — `cencori.mcpServers.register` */
  mcpServersRegister(
    ...args: Parameters<Cencori['mcpServers']['register']>
  ): ReturnType<Cencori['mcpServers']['register']> {
    return this.client.mcpServers.register(...args);
  }

  /** Calls `cencori.mcpServers.update`. — `cencori.mcpServers.update` */
  mcpServersUpdate(
    ...args: Parameters<Cencori['mcpServers']['update']>
  ): ReturnType<Cencori['mcpServers']['update']> {
    return this.client.mcpServers.update(...args);
  }

  /** Calls `cencori.mcpServers.remove`. — `cencori.mcpServers.remove` */
  mcpServersRemove(
    ...args: Parameters<Cencori['mcpServers']['remove']>
  ): ReturnType<Cencori['mcpServers']['remove']> {
    return this.client.mcpServers.remove(...args);
  }

  /** Calls `cencori.mcpServers.test`. — `cencori.mcpServers.test` */
  mcpServersTest(
    ...args: Parameters<Cencori['mcpServers']['test']>
  ): ReturnType<Cencori['mcpServers']['test']> {
    return this.client.mcpServers.test(...args);
  }

  /** Calls `cencori.mcpServers.tools`. — `cencori.mcpServers.tools` */
  mcpServersTools(
    ...args: Parameters<Cencori['mcpServers']['tools']>
  ): ReturnType<Cencori['mcpServers']['tools']> {
    return this.client.mcpServers.tools(...args);
  }

  /** Calls `cencori.mcpServers.refreshTools`. — `cencori.mcpServers.refreshTools` */
  mcpServersRefreshTools(
    ...args: Parameters<Cencori['mcpServers']['refreshTools']>
  ): ReturnType<Cencori['mcpServers']['refreshTools']> {
    return this.client.mcpServers.refreshTools(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Embedded Agents: Marketplace
  // ──────────────────────────────────────────────────────────────────────

  /** Calls `cencori.marketplace.list`. — `cencori.marketplace.list` */
  marketplaceList(
    ...args: Parameters<Cencori['marketplace']['list']>
  ): ReturnType<Cencori['marketplace']['list']> {
    return this.client.marketplace.list(...args);
  }

  /** Calls `cencori.marketplace.get`. — `cencori.marketplace.get` */
  marketplaceGet(
    ...args: Parameters<Cencori['marketplace']['get']>
  ): ReturnType<Cencori['marketplace']['get']> {
    return this.client.marketplace.get(...args);
  }

  /** Calls `cencori.marketplace.install`. — `cencori.marketplace.install` */
  marketplaceInstall(
    ...args: Parameters<Cencori['marketplace']['install']>
  ): ReturnType<Cencori['marketplace']['install']> {
    return this.client.marketplace.install(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Embedded Agents: Skills
  // ──────────────────────────────────────────────────────────────────────

  /** Calls `cencori.skills.create`. — `cencori.skills.create` */
  skillsCreate(
    ...args: Parameters<Cencori['skills']['create']>
  ): ReturnType<Cencori['skills']['create']> {
    return this.client.skills.create(...args);
  }

  /** Calls `cencori.skills.list`. — `cencori.skills.list` */
  skillsList(
    ...args: Parameters<Cencori['skills']['list']>
  ): ReturnType<Cencori['skills']['list']> {
    return this.client.skills.list(...args);
  }

  /** Calls `cencori.skills.get`. — `cencori.skills.get` */
  skillsGet(
    ...args: Parameters<Cencori['skills']['get']>
  ): ReturnType<Cencori['skills']['get']> {
    return this.client.skills.get(...args);
  }

  /** Calls `cencori.skills.update`. — `cencori.skills.update` */
  skillsUpdate(
    ...args: Parameters<Cencori['skills']['update']>
  ): ReturnType<Cencori['skills']['update']> {
    return this.client.skills.update(...args);
  }

  /** Calls `cencori.skills.createVersion`. — `cencori.skills.createVersion` */
  skillsCreateVersion(
    ...args: Parameters<Cencori['skills']['createVersion']>
  ): ReturnType<Cencori['skills']['createVersion']> {
    return this.client.skills.createVersion(...args);
  }

  /** Calls `cencori.skills.listVersions`. — `cencori.skills.listVersions` */
  skillsListVersions(
    ...args: Parameters<Cencori['skills']['listVersions']>
  ): ReturnType<Cencori['skills']['listVersions']> {
    return this.client.skills.listVersions(...args);
  }

  /** Calls `cencori.skills.getVersion`. — `cencori.skills.getVersion` */
  skillsGetVersion(
    ...args: Parameters<Cencori['skills']['getVersion']>
  ): ReturnType<Cencori['skills']['getVersion']> {
    return this.client.skills.getVersion(...args);
  }

  /** Calls `cencori.skills.publishVersion`. — `cencori.skills.publishVersion` */
  skillsPublishVersion(
    ...args: Parameters<Cencori['skills']['publishVersion']>
  ): ReturnType<Cencori['skills']['publishVersion']> {
    return this.client.skills.publishVersion(...args);
  }

  /** Calls `cencori.skills.deprecateVersion`. — `cencori.skills.deprecateVersion` */
  skillsDeprecateVersion(
    ...args: Parameters<Cencori['skills']['deprecateVersion']>
  ): ReturnType<Cencori['skills']['deprecateVersion']> {
    return this.client.skills.deprecateVersion(...args);
  }

  /** Delete a skill. — `cencori.skills.remove` */
  skillsRemove(
    ...args: Parameters<Cencori['skills']['remove']>
  ): ReturnType<Cencori['skills']['remove']> {
    return this.client.skills.remove(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Embedded Agents: Skill imports
  // ──────────────────────────────────────────────────────────────────────

  /** Calls `cencori.skillImports.stage`. — `cencori.skillImports.stage` */
  skillImportsStage(
    ...args: Parameters<Cencori['skillImports']['stage']>
  ): ReturnType<Cencori['skillImports']['stage']> {
    return this.client.skillImports.stage(...args);
  }

  /** Calls `cencori.skillImports.get`. — `cencori.skillImports.get` */
  skillImportsGet(
    ...args: Parameters<Cencori['skillImports']['get']>
  ): ReturnType<Cencori['skillImports']['get']> {
    return this.client.skillImports.get(...args);
  }

  /** Calls `cencori.skillImports.publish`. — `cencori.skillImports.publish` */
  skillImportsPublish(
    ...args: Parameters<Cencori['skillImports']['publish']>
  ): ReturnType<Cencori['skillImports']['publish']> {
    return this.client.skillImports.publish(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Embedded Agents: Webhooks
  // ──────────────────────────────────────────────────────────────────────

  /** Calls `cencori.webhooks.create`. — `cencori.webhooks.create` */
  webhooksCreate(
    ...args: Parameters<Cencori['webhooks']['create']>
  ): ReturnType<Cencori['webhooks']['create']> {
    return this.client.webhooks.create(...args);
  }

  /** Calls `cencori.webhooks.update`. — `cencori.webhooks.update` */
  webhooksUpdate(
    ...args: Parameters<Cencori['webhooks']['update']>
  ): ReturnType<Cencori['webhooks']['update']> {
    return this.client.webhooks.update(...args);
  }

  /** Calls `cencori.webhooks.list`. — `cencori.webhooks.list` */
  webhooksList(
    ...args: Parameters<Cencori['webhooks']['list']>
  ): ReturnType<Cencori['webhooks']['list']> {
    return this.client.webhooks.list(...args);
  }

  /** Calls `cencori.webhooks.remove`. — `cencori.webhooks.remove` */
  webhooksRemove(
    ...args: Parameters<Cencori['webhooks']['remove']>
  ): ReturnType<Cencori['webhooks']['remove']> {
    return this.client.webhooks.remove(...args);
  }

  /** Calls `cencori.webhooks.deliveries`. — `cencori.webhooks.deliveries` */
  webhooksDeliveries(
    ...args: Parameters<Cencori['webhooks']['deliveries']>
  ): ReturnType<Cencori['webhooks']['deliveries']> {
    return this.client.webhooks.deliveries(...args);
  }

  /** Calls `cencori.webhooks.replay`. — `cencori.webhooks.replay` */
  webhooksReplay(
    ...args: Parameters<Cencori['webhooks']['replay']>
  ): ReturnType<Cencori['webhooks']['replay']> {
    return this.client.webhooks.replay(...args);
  }

  /** Every webhook event name you can subscribe to. — `cencori.webhooks.events` */
  get webhookEvents(): Cencori['webhooks']['events'] {
    return this.client.webhooks.events;
  }

  /**
   * Check a delivery's `X-Webhook-Signature` against the raw body, so only
   * real Cencori deliveries are trusted. — `cencori.webhooks.verify`
   */
  webhooksVerify(
    ...args: Parameters<Cencori['webhooks']['verify']>
  ): ReturnType<Cencori['webhooks']['verify']> {
    return this.client.webhooks.verify(...args);
  }

  /** Verify and parse a delivery in one step (null if invalid). — `cencori.webhooks.parse` */
  webhooksParse<T = Record<string, unknown>>(
    rawBody: string,
    signature: string | null | undefined,
    secret: string,
    options?: Parameters<Cencori['webhooks']['parse']>[3],
  ): Promise<WebhookPayload<T> | null> {
    return this.client.webhooks.parse<T>(rawBody, signature, secret, options);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Embedded Agents: Usage
  // ──────────────────────────────────────────────────────────────────────

  /** Calls `cencori.usage.summary`. — `cencori.usage.summary` */
  usageSummary(
    ...args: Parameters<Cencori['usage']['summary']>
  ): ReturnType<Cencori['usage']['summary']> {
    return this.client.usage.summary(...args);
  }

  /** Calls `cencori.usage.events`. — `cencori.usage.events` */
  usageEvents(
    ...args: Parameters<Cencori['usage']['events']>
  ): ReturnType<Cencori['usage']['events']> {
    return this.client.usage.events(...args);
  }

  /** Calls `cencori.usage.exportCsv`. — `cencori.usage.exportCsv` */
  usageExportCsv(
    ...args: Parameters<Cencori['usage']['exportCsv']>
  ): ReturnType<Cencori['usage']['exportCsv']> {
    return this.client.usage.exportCsv(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Embedded Agents: End users
  // ──────────────────────────────────────────────────────────────────────

  /** Calls `cencori.endUsers.list`. — `cencori.endUsers.list` */
  endUsersList(
    ...args: Parameters<Cencori['endUsers']['list']>
  ): ReturnType<Cencori['endUsers']['list']> {
    return this.client.endUsers.list(...args);
  }

  /** Calls `cencori.endUsers.upsert`. — `cencori.endUsers.upsert` */
  endUsersUpsert(
    ...args: Parameters<Cencori['endUsers']['upsert']>
  ): ReturnType<Cencori['endUsers']['upsert']> {
    return this.client.endUsers.upsert(...args);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Embedded Agents: Rate plans
  // ──────────────────────────────────────────────────────────────────────

  /** Calls `cencori.ratePlans.list`. — `cencori.ratePlans.list` */
  ratePlansList(
    ...args: Parameters<Cencori['ratePlans']['list']>
  ): ReturnType<Cencori['ratePlans']['list']> {
    return this.client.ratePlans.list(...args);
  }

  /** Calls `cencori.ratePlans.create`. — `cencori.ratePlans.create` */
  ratePlansCreate(
    ...args: Parameters<Cencori['ratePlans']['create']>
  ): ReturnType<Cencori['ratePlans']['create']> {
    return this.client.ratePlans.create(...args);
  }
}
