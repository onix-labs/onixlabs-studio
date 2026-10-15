import type { TechnologyCategory } from './technology-category';

/**
 * A technology the New Project wizard can offer: from the curated catalogue, or added by the user.
 */
export interface Technology {
  /**
   * Gets its id, unique across the catalogue and local additions.
   */
  readonly id: string;

  /**
   * Gets its name, as the user sees it.
   */
  readonly name: string;

  /**
   * Gets its category.
   */
  readonly category: TechnologyCategory;

  /**
   * Gets a line saying what it is.
   */
  readonly description: string;

  /**
   * Gets other names it is searched by, e.g. "Postgres".
   */
  readonly aliases: readonly string[];

  /**
   * Gets whether the user added it rather than the catalogue shipping it.
   */
  readonly local: boolean;
}

/**
 * One catalogue row: id, name, category, description, and optional aliases.
 */
type Row = readonly [string, string, TechnologyCategory, string, (readonly string[])?];

/**
 * The curated catalogue's rows (#806). Current, mainstream choices; anything else the user adds to
 * their project themselves, under Other.
 */
const ROWS: readonly Row[] = [
  // Languages
  ['csharp', 'C#', 'languages', 'Modern, general-purpose language on .NET', ['csharp', 'c sharp']],
  ['fsharp', 'F#', 'languages', 'Functional-first language on .NET'],
  ['typescript', 'TypeScript', 'languages', 'Typed superset of JavaScript', ['ts']],
  ['javascript', 'JavaScript', 'languages', 'The language of the web', ['js', 'ecmascript']],
  ['python', 'Python', 'languages', 'General-purpose language, strong in data and AI', ['py']],
  ['java', 'Java', 'languages', 'General-purpose language on the JVM'],
  ['kotlin', 'Kotlin', 'languages', 'Concise JVM language, also for Android and multiplatform'],
  ['scala', 'Scala', 'languages', 'Functional and object-oriented JVM language'],
  ['go', 'Go', 'languages', 'Simple, compiled language for services and tools', ['golang']],
  ['rust', 'Rust', 'languages', 'Memory-safe systems language without a garbage collector'],
  ['cpp', 'C++', 'languages', 'High-performance systems and application language', ['c++']],
  ['c', 'C', 'languages', 'Low-level systems language'],
  ['swift', 'Swift', 'languages', "Apple's language for its platforms"],
  ['dart', 'Dart', 'languages', 'Client-optimised language behind Flutter'],
  ['ruby', 'Ruby', 'languages', 'Dynamic language focused on developer happiness'],
  ['php', 'PHP', 'languages', 'Server-side scripting language for the web'],
  ['elixir', 'Elixir', 'languages', 'Functional language on the Erlang VM, built for concurrency'],
  ['zig', 'Zig', 'languages', 'Systems language aiming to replace C'],
  ['sql', 'SQL', 'languages', 'Query language for relational databases'],
  ['bash', 'Bash', 'languages', 'Unix shell scripting', ['shell', 'sh']],
  ['powershell', 'PowerShell', 'languages', 'Cross-platform shell and scripting language'],

  // Frontend
  ['react', 'React', 'frontend', 'Component library for building user interfaces', ['reactjs']],
  ['angular', 'Angular', 'frontend', 'Full frontend framework from Google'],
  ['vue', 'Vue', 'frontend', 'Progressive frontend framework', ['vuejs']],
  ['svelte', 'Svelte', 'frontend', 'Compiler-based UI framework'],
  ['solid', 'SolidJS', 'frontend', 'Fine-grained reactive UI library'],
  ['nextjs', 'Next.js', 'frontend', 'React framework with server rendering and routing', ['next']],
  ['nuxt', 'Nuxt', 'frontend', 'Vue framework with server rendering and routing'],
  ['sveltekit', 'SvelteKit', 'frontend', 'Svelte application framework'],
  ['astro', 'Astro', 'frontend', 'Content-focused web framework with islands'],
  ['remix', 'React Router', 'frontend', 'Full-stack React framework (formerly Remix)', ['remix']],
  ['blazor', 'Blazor', 'frontend', 'Web UI in C# with .NET, on the server or WebAssembly'],
  ['htmx', 'htmx', 'frontend', 'HTML-driven interactivity without a frontend framework'],
  ['tailwind', 'Tailwind CSS', 'frontend', 'Utility-first CSS framework', ['tailwindcss']],
  ['sass', 'Sass', 'frontend', 'CSS with variables, nesting and mixins', ['scss']],
  ['shadcn', 'shadcn/ui', 'frontend', 'Copy-in React components built on Radix'],
  ['mui', 'Material UI', 'frontend', 'React components implementing Material Design', ['material']],
  [
    'tanstack-query',
    'TanStack Query',
    'frontend',
    'Data fetching and caching for web apps',
    ['react query'],
  ],
  ['threejs', 'Three.js', 'frontend', '3D graphics in the browser with WebGL'],
  [
    'webassembly',
    'WebAssembly',
    'frontend',
    'Portable binary format for running code in the browser',
    ['wasm'],
  ],

  // Backend & APIs
  [
    'dotnet',
    '.NET',
    'backend',
    "Microsoft's cross-platform runtime and libraries",
    ['dotnet', 'net'],
  ],
  ['aspnet-core', 'ASP.NET Core', 'backend', 'Web framework for APIs and apps on .NET', ['aspnet']],
  ['nodejs', 'Node.js', 'backend', 'JavaScript runtime for servers and tools', ['node']],
  ['bun', 'Bun', 'backend', 'Fast JavaScript runtime, bundler and package manager'],
  ['deno', 'Deno', 'backend', 'Secure JavaScript and TypeScript runtime'],
  ['express', 'Express', 'backend', 'Minimal web framework for Node.js'],
  ['fastify', 'Fastify', 'backend', 'Fast, low-overhead web framework for Node.js'],
  ['nestjs', 'NestJS', 'backend', 'Structured Node.js framework for server applications'],
  ['hono', 'Hono', 'backend', 'Small web framework for any JavaScript runtime'],
  ['django', 'Django', 'backend', 'Batteries-included Python web framework'],
  ['fastapi', 'FastAPI', 'backend', 'Python API framework driven by type hints'],
  ['flask', 'Flask', 'backend', 'Lightweight Python web framework'],
  ['spring-boot', 'Spring Boot', 'backend', 'Opinionated Java framework for services', ['spring']],
  ['quarkus', 'Quarkus', 'backend', 'Kubernetes-native Java framework'],
  ['ktor', 'Ktor', 'backend', 'Asynchronous Kotlin web framework'],
  ['rails', 'Ruby on Rails', 'backend', 'Convention-driven Ruby web framework', ['ror']],
  ['laravel', 'Laravel', 'backend', 'Full-featured PHP web framework'],
  ['phoenix', 'Phoenix', 'backend', 'Elixir web framework with real-time channels'],
  ['gin', 'Gin', 'backend', 'HTTP web framework for Go'],
  ['axum', 'Axum', 'backend', 'Ergonomic web framework for Rust on Tokio'],
  ['graphql', 'GraphQL', 'backend', 'Query language and runtime for APIs'],
  ['grpc', 'gRPC', 'backend', 'High-performance RPC framework over HTTP/2'],
  ['openapi', 'OpenAPI', 'backend', 'Standard for describing REST APIs', ['swagger']],
  ['trpc', 'tRPC', 'backend', 'End-to-end type-safe APIs for TypeScript'],
  ['signalr', 'SignalR', 'backend', 'Real-time web communication for .NET'],
  ['websockets', 'WebSockets', 'backend', 'Full-duplex communication over a single connection'],
  ['orleans', 'Orleans', 'backend', 'Virtual-actor framework for distributed .NET apps'],
  [
    'ef-core',
    'Entity Framework Core',
    'backend',
    'Object-relational mapper for .NET',
    ['ef', 'efcore'],
  ],
  ['prisma', 'Prisma', 'backend', 'Type-safe ORM for Node.js and TypeScript'],
  ['drizzle', 'Drizzle ORM', 'backend', 'Lightweight, SQL-like TypeScript ORM'],
  ['sqlalchemy', 'SQLAlchemy', 'backend', 'SQL toolkit and ORM for Python'],
  ['hibernate', 'Hibernate', 'backend', 'Object-relational mapper for Java'],

  // Desktop & Mobile
  ['electron', 'Electron', 'desktop-mobile', 'Desktop apps with web technologies'],
  ['tauri', 'Tauri', 'desktop-mobile', 'Small, secure desktop apps with a Rust core'],
  ['avalonia', 'Avalonia', 'desktop-mobile', 'Cross-platform .NET UI framework'],
  ['maui', '.NET MAUI', 'desktop-mobile', 'Cross-platform native apps with .NET', ['maui']],
  ['wpf', 'WPF', 'desktop-mobile', 'Windows desktop UI framework for .NET'],
  ['winui', 'WinUI 3', 'desktop-mobile', 'Modern native UI for Windows apps', ['winui']],
  ['swiftui', 'SwiftUI', 'desktop-mobile', 'Declarative UI for Apple platforms'],
  [
    'jetpack-compose',
    'Jetpack Compose',
    'desktop-mobile',
    "Android's declarative UI toolkit",
    ['compose'],
  ],
  [
    'compose-multiplatform',
    'Compose Multiplatform',
    'desktop-mobile',
    'Kotlin UI shared across desktop, mobile and web',
  ],
  ['flutter', 'Flutter', 'desktop-mobile', 'Cross-platform UI toolkit in Dart'],
  ['react-native', 'React Native', 'desktop-mobile', 'Native mobile apps with React'],
  ['expo', 'Expo', 'desktop-mobile', 'Tooling and services for React Native apps'],
  ['qt', 'Qt', 'desktop-mobile', 'Cross-platform C++ application framework'],

  // Databases
  [
    'postgresql',
    'PostgreSQL',
    'databases',
    'Advanced open-source relational database',
    ['postgres', 'pg'],
  ],
  ['mysql', 'MySQL', 'databases', 'Popular open-source relational database'],
  ['mariadb', 'MariaDB', 'databases', 'Community fork of MySQL'],
  ['sqlite', 'SQLite', 'databases', 'Embedded, file-based relational database'],
  ['sql-server', 'SQL Server', 'databases', "Microsoft's relational database", ['mssql']],
  ['oracle-db', 'Oracle Database', 'databases', 'Enterprise relational database'],
  ['mongodb', 'MongoDB', 'databases', 'Document database', ['mongo']],
  [
    'cosmos-db',
    'Azure Cosmos DB',
    'databases',
    'Globally distributed multi-model database',
    ['cosmosdb'],
  ],
  ['dynamodb', 'DynamoDB', 'databases', "AWS's managed key-value and document database"],
  ['cassandra', 'Apache Cassandra', 'databases', 'Wide-column store built for scale'],
  ['neo4j', 'Neo4j', 'databases', 'Graph database'],
  ['clickhouse', 'ClickHouse', 'databases', 'Column-oriented database for analytics'],
  ['duckdb', 'DuckDB', 'databases', 'In-process analytical database'],
  ['timescaledb', 'TimescaleDB', 'databases', 'Time-series database on PostgreSQL'],
  ['influxdb', 'InfluxDB', 'databases', 'Time-series database'],
  ['cockroachdb', 'CockroachDB', 'databases', 'Distributed SQL database'],
  ['supabase', 'Supabase', 'databases', 'Postgres platform with auth, storage and APIs'],
  [
    'firebase',
    'Firebase',
    'databases',
    "Google's app platform with a realtime database",
    ['firestore'],
  ],
  ['pgvector', 'pgvector', 'databases', 'Vector similarity search for PostgreSQL'],
  ['qdrant', 'Qdrant', 'databases', 'Vector database for similarity search'],
  ['pinecone', 'Pinecone', 'databases', 'Managed vector database'],

  // Caching
  ['redis', 'Redis', 'caching', 'In-memory data store for caching and more'],
  ['valkey', 'Valkey', 'caching', 'Open-source fork of Redis'],
  ['memcached', 'Memcached', 'caching', 'Distributed in-memory cache'],
  ['garnet', 'Garnet', 'caching', 'High-performance Redis-compatible cache from Microsoft'],
  ['varnish', 'Varnish', 'caching', 'HTTP caching reverse proxy'],

  // Messaging & Streaming
  ['kafka', 'Apache Kafka', 'messaging', 'Distributed event streaming platform'],
  ['rabbitmq', 'RabbitMQ', 'messaging', 'Message broker supporting several protocols'],
  ['nats', 'NATS', 'messaging', 'Lightweight messaging and streaming'],
  ['pulsar', 'Apache Pulsar', 'messaging', 'Multi-tenant messaging and streaming'],
  ['redpanda', 'Redpanda', 'messaging', 'Kafka-compatible streaming platform'],
  ['azure-service-bus', 'Azure Service Bus', 'messaging', 'Managed enterprise message broker'],
  ['aws-sqs', 'Amazon SQS', 'messaging', 'Managed message queues', ['sqs']],
  ['aws-sns', 'Amazon SNS', 'messaging', 'Managed pub/sub messaging', ['sns']],
  ['google-pubsub', 'Google Pub/Sub', 'messaging', 'Managed messaging on Google Cloud'],
  ['masstransit', 'MassTransit', 'messaging', 'Distributed application framework for .NET'],
  ['mqtt', 'MQTT', 'messaging', 'Lightweight messaging protocol for IoT'],

  // Search
  ['elasticsearch', 'Elasticsearch', 'search', 'Distributed search and analytics engine'],
  [
    'opensearch',
    'OpenSearch',
    'search',
    'Open-source search and analytics, forked from Elasticsearch',
  ],
  ['meilisearch', 'Meilisearch', 'search', 'Fast, typo-tolerant search engine'],
  ['typesense', 'Typesense', 'search', 'Open-source, typo-tolerant search engine'],
  ['algolia', 'Algolia', 'search', 'Hosted search as a service'],

  // Auth & Identity
  ['oauth2', 'OAuth 2.0', 'auth', 'Standard for delegated authorisation', ['oauth']],
  ['oidc', 'OpenID Connect', 'auth', 'Identity layer on OAuth 2.0'],
  [
    'entra-id',
    'Microsoft Entra ID',
    'auth',
    "Microsoft's cloud identity (formerly Azure AD)",
    ['azure ad', 'aad'],
  ],
  ['auth0', 'Auth0', 'auth', 'Hosted authentication and authorisation'],
  ['keycloak', 'Keycloak', 'auth', 'Open-source identity and access management'],
  ['clerk', 'Clerk', 'auth', 'Drop-in authentication and user management'],
  ['aspnet-identity', 'ASP.NET Core Identity', 'auth', 'Membership system for ASP.NET Core'],
  ['passkeys', 'Passkeys', 'auth', 'Passwordless sign-in with WebAuthn', ['webauthn']],
  ['jwt', 'JWT', 'auth', 'Signed tokens for claims between parties', ['json web token']],

  // AI & ML
  ['claude-api', 'Claude API', 'ai', "Anthropic's Claude models through the API", ['anthropic']],
  ['openai-api', 'OpenAI API', 'ai', "OpenAI's models through the API", ['openai']],
  ['azure-openai', 'Azure OpenAI', 'ai', 'OpenAI models hosted on Azure'],
  ['gemini-api', 'Gemini API', 'ai', "Google's Gemini models through the API", ['gemini']],
  ['ollama', 'Ollama', 'ai', 'Run open models locally'],
  ['mcp', 'Model Context Protocol', 'ai', 'Open protocol connecting AI models to tools and data'],
  [
    'semantic-kernel',
    'Semantic Kernel',
    'ai',
    "Microsoft's SDK for AI orchestration in .NET and Python",
  ],
  ['langchain', 'LangChain', 'ai', 'Framework for building LLM applications'],
  ['llamaindex', 'LlamaIndex', 'ai', 'Framework for retrieval over your own data'],
  ['vercel-ai-sdk', 'AI SDK', 'ai', "Vercel's TypeScript toolkit for AI apps", ['vercel ai']],
  ['pytorch', 'PyTorch', 'ai', 'Deep learning framework'],
  ['tensorflow', 'TensorFlow', 'ai', 'Machine learning platform'],
  ['scikit-learn', 'scikit-learn', 'ai', 'Classical machine learning in Python', ['sklearn']],
  [
    'hugging-face',
    'Hugging Face',
    'ai',
    'Models, datasets and the Transformers library',
    ['transformers'],
  ],
  ['onnx', 'ONNX Runtime', 'ai', 'Cross-platform inference for ML models', ['onnx']],
  ['ml-net', 'ML.NET', 'ai', 'Machine learning for .NET'],

  // Cloud & Hosting
  ['azure', 'Microsoft Azure', 'cloud', "Microsoft's cloud platform"],
  ['aws', 'Amazon Web Services', 'cloud', "Amazon's cloud platform"],
  ['gcp', 'Google Cloud', 'cloud', "Google's cloud platform", ['google cloud platform']],
  ['cloudflare', 'Cloudflare', 'cloud', 'Edge network, Workers and storage'],
  ['vercel', 'Vercel', 'cloud', 'Frontend and serverless hosting'],
  ['netlify', 'Netlify', 'cloud', 'Web hosting and serverless functions'],
  ['fly-io', 'Fly.io', 'cloud', 'Run apps close to users worldwide'],
  ['digitalocean', 'DigitalOcean', 'cloud', 'Developer-friendly cloud hosting'],
  ['azure-functions', 'Azure Functions', 'cloud', 'Serverless compute on Azure'],
  ['aws-lambda', 'AWS Lambda', 'cloud', 'Serverless compute on AWS', ['lambda']],
  ['azure-app-service', 'Azure App Service', 'cloud', 'Managed web app hosting on Azure'],
  ['azure-container-apps', 'Azure Container Apps', 'cloud', 'Serverless containers on Azure'],
  ['s3', 'Amazon S3', 'cloud', 'Object storage', ['s3']],
  ['azure-blob', 'Azure Blob Storage', 'cloud', 'Object storage on Azure'],
  ['terraform', 'Terraform', 'cloud', 'Infrastructure as code', ['opentofu']],
  ['pulumi', 'Pulumi', 'cloud', 'Infrastructure as code in general-purpose languages'],
  ['bicep', 'Bicep', 'cloud', 'Infrastructure as code for Azure'],

  // Containers & Orchestration
  ['docker', 'Docker', 'containers', 'Build and run containers'],
  ['podman', 'Podman', 'containers', 'Daemonless container engine'],
  ['kubernetes', 'Kubernetes', 'containers', 'Container orchestration', ['k8s']],
  ['helm', 'Helm', 'containers', 'Package manager for Kubernetes'],
  [
    'aspire',
    '.NET Aspire',
    'containers',
    'Orchestration and tooling for distributed .NET apps',
    ['aspire'],
  ],
  [
    'docker-compose',
    'Docker Compose',
    'containers',
    'Define and run multi-container apps',
    ['compose'],
  ],
  ['dapr', 'Dapr', 'containers', 'Portable runtime building blocks for microservices'],
  ['istio', 'Istio', 'containers', 'Service mesh for Kubernetes'],
  ['nginx', 'NGINX', 'containers', 'Web server, reverse proxy and load balancer'],
  ['yarp', 'YARP', 'containers', 'Reverse proxy toolkit for .NET'],

  // Observability
  [
    'opentelemetry',
    'OpenTelemetry',
    'observability',
    'Standard for traces, metrics and logs',
    ['otel'],
  ],
  ['prometheus', 'Prometheus', 'observability', 'Metrics collection and alerting'],
  ['grafana', 'Grafana', 'observability', 'Dashboards for metrics, logs and traces'],
  ['serilog', 'Serilog', 'observability', 'Structured logging for .NET'],
  ['seq', 'Seq', 'observability', 'Search and analysis for structured logs'],
  ['sentry', 'Sentry', 'observability', 'Error tracking and performance monitoring'],
  ['datadog', 'Datadog', 'observability', 'Monitoring and observability platform'],
  ['app-insights', 'Application Insights', 'observability', "Azure's application monitoring"],
  ['jaeger', 'Jaeger', 'observability', 'Distributed tracing'],

  // Testing
  ['xunit', 'xUnit', 'testing', 'Unit testing for .NET'],
  ['nunit', 'NUnit', 'testing', 'Unit testing for .NET'],
  ['mstest', 'MSTest', 'testing', "Microsoft's unit testing framework for .NET"],
  ['vitest', 'Vitest', 'testing', 'Fast unit testing for Vite and TypeScript'],
  ['jest', 'Jest', 'testing', 'JavaScript testing framework'],
  ['playwright', 'Playwright', 'testing', 'End-to-end browser testing'],
  ['cypress', 'Cypress', 'testing', 'End-to-end testing for web apps'],
  ['pytest', 'pytest', 'testing', 'Testing framework for Python'],
  ['junit', 'JUnit', 'testing', 'Unit testing for the JVM'],
  [
    'testcontainers',
    'Testcontainers',
    'testing',
    'Real dependencies in throwaway containers for tests',
  ],
  ['k6', 'k6', 'testing', 'Load testing with scripts'],

  // CI/CD
  ['github-actions', 'GitHub Actions', 'cicd', 'CI/CD workflows on GitHub'],
  ['gitlab-ci', 'GitLab CI/CD', 'cicd', 'Pipelines built into GitLab'],
  ['azure-pipelines', 'Azure Pipelines', 'cicd', 'CI/CD in Azure DevOps'],
  ['jenkins', 'Jenkins', 'cicd', 'Self-hosted automation server'],
  ['circleci', 'CircleCI', 'cicd', 'Hosted continuous integration'],
  ['argo-cd', 'Argo CD', 'cicd', 'GitOps continuous delivery for Kubernetes'],

  // Build & Packaging
  ['vite', 'Vite', 'build', 'Fast frontend build tool and dev server'],
  ['webpack', 'webpack', 'build', 'Module bundler for JavaScript'],
  ['esbuild', 'esbuild', 'build', 'Extremely fast JavaScript bundler'],
  ['npm', 'npm', 'build', 'Package manager for JavaScript'],
  ['pnpm', 'pnpm', 'build', 'Fast, disk-efficient JavaScript package manager'],
  ['nuget', 'NuGet', 'build', 'Package manager for .NET'],
  ['msbuild', 'MSBuild', 'build', 'Build engine for .NET'],
  ['gradle', 'Gradle', 'build', 'Build automation for the JVM'],
  ['maven', 'Maven', 'build', 'Build and dependency management for Java'],
  ['cargo', 'Cargo', 'build', "Rust's build tool and package manager"],
  ['cmake', 'CMake', 'build', 'Cross-platform build system generator for C and C++'],
  ['uv', 'uv', 'build', 'Fast Python package and project manager'],
  ['nx', 'Nx', 'build', 'Monorepo build system'],
  ['turborepo', 'Turborepo', 'build', 'High-performance monorepo build system'],
  ['electron-builder', 'electron-builder', 'build', 'Package and distribute Electron apps'],
];

/**
 * The curated catalogue (#806).
 */
export const TECHNOLOGY_CATALOGUE: readonly Technology[] = ROWS.map(
  ([id, name, category, description, aliases]: Row): Technology => ({
    id,
    name,
    category,
    description,
    aliases: aliases ?? [],
    local: false,
  }),
);
