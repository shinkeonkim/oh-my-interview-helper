import { Hono } from "hono"
import { randomBytes } from "node:crypto"
import { serveStatic } from "hono/bun"
import { bodyLimit } from "hono/body-limit"

import { HEALTH_STATUS } from "@interview-helper/shared"

import { createPreviewRoutes } from "./routes/preview"
import { createJobsRoutes } from "./routes/jobs"
import { createProviderStatusRoutes, createSettingsRoutes } from "./routes/settings"
import { createDisclosureRoutes } from "./routes/disclosures"
import { DisclosureService } from "./disclosures/service"
import { DraftArtifactRepository } from "./artifacts/draft-artifact-repository"
import { CurrentGenerationContextResolver } from "./artifacts/current-generation-context"
import { DraftArtifactService } from "./artifacts/draft-artifact-service"
import { createArtifactRoutes } from "./routes/artifacts"
import { createPersistence, type Persistence } from "./db"
import { ProviderKindSchema } from "./db/operations-repositories"
import {
  defaultPromptTemplateRevisionRegistry,
  type PromptTemplateRevisionRegistry
} from "./prompts/prompt-template-revisions"
import { createJobRegistry, JobRuntime, type JobDefinition } from "./jobs/runtime"
import {
  ProviderKernel,
  ProviderRegistry,
  ToolRegistry,
  createProviderInvokeJobDefinition,
  unavailableProviderRequestSource,
  type ProviderRequestSource
} from "./agents"
import { defaultLocalSecuritySettings, type LocalSecuritySettings } from "./security/config"
import type { PinnedTransport, Resolver } from "./ingest/safe-fetcher"
import { createCsrfProtection, localSecurityMiddleware } from "./security/local-security"
import { createRunnerRoutes } from "./routes/runner"
import type { RunnerPairingService } from "./runner/pairing"
import { DocumentLibraryService } from "./documents/service"
import { createDocumentRoutes } from "./routes/documents"
import { ApplicationService } from "./applications/service"
import { createApplicationRoutes } from "./routes/applications"
import { localEvidenceAnalyzer, type ResearchAnalyzer } from "./research/contracts"
import { ResearchService } from "./research/service"
import type { ResearchSourceDiscoverer } from "./research/service"
import { LocalAgentResearchSourceDiscoverer } from "./research/local-agent-discoverer"
import { createResearchRoutes } from "./routes/research"
import { PreparationWorkflowService, type PreparationExecutor } from "./workflows/service"
import { createChatRoutes, createWorkflowRoutes } from "./routes/workflows"
import { ChatWorkflowService, type ChatExecutor } from "./workflows/chat-service"
import { StrandsPreparationExecutor } from "./workflows/strands-executor"
import { WorkflowSourceContentResolver } from "./workflows/source-content"
import { StrandsChatExecutor } from "./workflows/strands-chat-executor"

export type AppOptions = {
  readonly dataDirectory?: string
  readonly resolver?: Resolver
  readonly security?: LocalSecuritySettings
  readonly transport?: PinnedTransport
  readonly csrfSecret?: Uint8Array
  readonly disclosureSecret?: Uint8Array
  readonly persistence?: Persistence
  readonly jobDefinitions?: readonly JobDefinition[]
  readonly jobRuntime?: JobRuntime
  readonly providerRegistry?: ProviderRegistry
  readonly providerRequests?: ProviderRequestSource
  readonly promptTemplates?: PromptTemplateRevisionRegistry
  readonly runnerPairing?: RunnerPairingService
  readonly revokeRunnerConnection?: (runnerId: string) => void
  readonly researchAnalyzer?: ResearchAnalyzer
  readonly researchSourceDiscoverer?: ResearchSourceDiscoverer
  readonly preparationExecutor?: PreparationExecutor
  readonly chatExecutor?: ChatExecutor
}

export const createApp = ({
  dataDirectory = "./data",
  resolver,
  security = defaultLocalSecuritySettings(),
  transport,
  csrfSecret,
  disclosureSecret,
  persistence: providedPersistence,
  jobDefinitions = [],
  jobRuntime,
  providerRegistry = new ProviderRegistry([]),
  providerRequests = unavailableProviderRequestSource,
  promptTemplates = defaultPromptTemplateRevisionRegistry,
  runnerPairing,
  revokeRunnerConnection,
  researchAnalyzer = localEvidenceAnalyzer,
  researchSourceDiscoverer = new LocalAgentResearchSourceDiscoverer(),
  preparationExecutor,
  chatExecutor
}: AppOptions = {}): Hono => {
  const app = new Hono()
  const csrf = createCsrfProtection(csrfSecret)
  const persistence = providedPersistence ?? createPersistence({ dataDirectory })
  const disclosures = new DisclosureService({
    database: persistence.database,
    providers: providerRegistry,
    secret: disclosureSecret ?? randomBytes(32)
  })
  const kernel = new ProviderKernel({ providers: providerRegistry, tools: new ToolRegistry([]) })
  const providerDefinition = createProviderInvokeJobDefinition({
    kernel,
    providerRuns: persistence.repositories.providerArtifacts,
    jobs: persistence.repositories.jobs,
    requests: providerRequests,
    authorization: { consume: (payload) => disclosures.consumeForProviderRun(payload) }
  })
  const definitions = jobDefinitions.some(
    (definition) => definition.kind === providerDefinition.kind
  )
    ? jobDefinitions
    : [...jobDefinitions, providerDefinition]
  const jobs =
    jobRuntime ?? new JobRuntime(persistence.repositories.jobs, createJobRegistry(definitions))

  app.use("*", localSecurityMiddleware(security, csrf))
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: security.requestBytes,
      onError: (context) => context.json({ error: { code: "REQUEST_TOO_LARGE" } }, 413)
    })
  )
  app.get("/api/health", (context) => context.json(HEALTH_STATUS))
  app.get("/api/security/csrf", csrf.issue)
  app.route(
    "/api/preview",
    createPreviewRoutes({ dataDirectory, limits: security, resolver, transport })
  )
  app.route(
    "/api",
    createApplicationRoutes(
      new ApplicationService(persistence, dataDirectory, security, resolver, transport)
    )
  )
  app.route(
    "/api/research",
    createResearchRoutes(
      new ResearchService(
        persistence,
        security,
        researchAnalyzer,
        resolver,
        transport,
        undefined,
        researchSourceDiscoverer
      )
    )
  )
  app.route("/api/jobs", createJobsRoutes(jobs))
  app.route(
    "/api/settings",
    createSettingsRoutes({
      operations: persistence.repositories.operations,
      providers: providerRegistry
    })
  )
  app.route(
    "/api/providers",
    createProviderStatusRoutes({
      operations: persistence.repositories.operations,
      providers: providerRegistry
    })
  )
  app.route("/api/disclosures", createDisclosureRoutes(disclosures))
  app.route(
    "/api/documents",
    createDocumentRoutes(new DocumentLibraryService(persistence, dataDirectory, security))
  )
  if (runnerPairing !== undefined)
    app.route("/api/runners", createRunnerRoutes(runnerPairing, revokeRunnerConnection))
  const artifacts = new DraftArtifactService(
    new DraftArtifactRepository(persistence.database),
    new CurrentGenerationContextResolver({
      providers: {
        get: (providerId) => {
          const provider = providerRegistry.get(providerId)
          return provider === null
            ? null
            : { descriptor: provider.descriptor, enabled: provider.enabled }
        }
      },
      settings: {
        get: (providerId) =>
          persistence.repositories.operations.getProviderSettings(
            ProviderKindSchema.parse(providerId)
          )
      },
      prompts: promptTemplates
    }),
    persistence.database
  )
  app.route("/api/artifacts", createArtifactRoutes(artifacts))
  const strandsPreparationExecutor = new StrandsPreparationExecutor({
    kernel,
    providers: providerRegistry,
    providerRuns: persistence.repositories.providerArtifacts,
    disclosures,
    sources: new WorkflowSourceContentResolver(persistence.database)
  })
  const activePreparationExecutor = preparationExecutor ?? strandsPreparationExecutor
  app.route(
    "/api/workflows",
    createWorkflowRoutes(
      new PreparationWorkflowService(artifacts, activePreparationExecutor),
      preparationExecutor === undefined ? strandsPreparationExecutor : undefined
    )
  )
  app.route(
    "/api/conversations",
    (() => {
      const strandsChatExecutor = new StrandsChatExecutor({
        kernel,
        providers: providerRegistry,
        providerRuns: persistence.repositories.providerArtifacts,
        disclosures,
        conversations: persistence.repositories.researchConversations,
        sources: new WorkflowSourceContentResolver(persistence.database)
      })
      const activeChatExecutor = chatExecutor ?? strandsChatExecutor
      return createChatRoutes(
        new ChatWorkflowService(
          persistence.repositories.researchConversations,
          activeChatExecutor,
          persistence.database
        ),
        chatExecutor === undefined ? strandsChatExecutor : undefined
      )
    })()
  )
  app.use("/assets/*", serveStatic({ root: "./server/public" }))
  app.get("/", serveStatic({ root: "./server/public" }))
  app.notFound(async (context) => {
    if (context.req.path.startsWith("/api/")) return context.json({ error: "Not found" }, 404)

    const index = Bun.file("./server/public/index.html")
    return new Response(index, { headers: { "content-type": "text/html; charset=UTF-8" } })
  })

  return app
}
