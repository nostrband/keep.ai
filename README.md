# Keep.AI

> Privacy-focused proactive AI assistant

Keep.AI is an AI assistant application that prioritizes user privacy while providing powerful AI capabilities. The app can run in the background on your desktop computer, and you can connect to it on mobile in an end-to-end-encrypted way. The assistant can run scheduled tasks, send reminders, take notes, search and browse the web, do precise calculations, and much more.

## 🚀 Features

- **Privacy-First**: All your data is stored locally (message history, notes, tasks, etc)
- **Peer-to-Peer Sync**: Synchronize your data across devices with E2EE
- **Multiple Interfaces**: Web app (docker), desktop app (Electron), web SPA (mobile)
- **AI Agent Tools**: Built-in tools for note management, task handling, web search, and more
- **Offline Capable**: Works offline (read-only) with local database replica
- **JS runtime**: Agent uses JS sandbox for tool calls and data processing
- **Extensible Architecture**: Modular design with reusable packages

## 🏗️ Architecture

This is a monorepo using npm workspaces with the following structure:

### Applications (`apps/`)

- **[`web/`](apps/web/)** - React-based web application with multiple build modes (frontend, serverless, electron)
- **[`cli/`](apps/cli/)** - Command-line interface for Keep.AI (`keepai` command)
- **[`electron/`](apps/electron/)** - Desktop application wrapper
- **[`server/`](apps/server/)** - Web server for hosting the frontend
- **[`push/`](apps/push/)** - Push notification server

### Packages (`packages/`)

- **[`agent/`](packages/agent/)** - Core AI agent functionality with tools and REPL environment
- **[`db/`](packages/db/)** - Database abstraction layer with CRSqlite integration
- **[`node/`](packages/node/)** - Node.js-specific database and server utilities
- **[`proto/`](packages/proto/)** - Shared protocol definitions, schemas, and message contracts
- **[`sync/`](packages/sync/)** - Peer-to-peer synchronization using Nostr protocol
- **[`tests/`](packages/tests/)** - Test utilities and shared test configurations

## 📋 Requirements

- **Node.js**: >= 22.0.0
- **npm**: >= 10.9.0

## 🛠️ Installation

1. Clone the repository:
```bash
git clone https://github.com/nostrband/keep.ai.git
cd keep.ai
```

2. Install dependencies:
```bash
npm install
```

3. Build all packages:
```bash
npm run build
```

## 💻 Usage

### Web Application

Start the development server:
```bash
cd apps/web
npm run dev
```

The web app supports multiple build modes:
- `dev:frontend` - Frontend-only mode
- `dev:serverless` - Serverless mode
- `dev:electron` - Electron integration mode

### Desktop Application

Build and run the Electron app:
```bash
cd apps/electron
npm run build
npm start
```

To build a release:
```bash
npx electron-builder
```

### Docker

Run with Docker:
```bash
docker-compose up
```

## 🔧 Development

### Development Scripts

- `npm run dev` - Start development mode for all packages
- `npm run build` - Build all packages
- `npm run type-check` - Run TypeScript type checking
- `npm run clean` - Clean build artifacts

### Package Development

Each package has its own development scripts:
```bash
cd packages/[package-name]
npm run dev      # Watch mode
npm run build    # Build package
npm run type-check # Type checking
```

## 🔌 Agent Tools

The AI agent comes with built-in tools for:

- **Note Management**: Create, update, search, and delete notes
- **Task Management**: Handle tasks and recurring schedules
- **Web Integration**: Web search and fetch capabilities
- **Weather**: Get weather information
- **Inbox Management**: Handle message queues and notifications

## 🗄️ Database

Keep.AI uses SQLite with CRSqlite for conflict-free replicated data types (CRDTs), enabling:

- **Offline-first**: Data available without internet connection
- **Conflict-free sync**: Automatic merge resolution across devices
- **Privacy**: All data stored locally by default

## 🔄 Synchronization

Peer-to-peer sync is implemented using:

- **Nostr Protocol**: Decentralized communication protocol
- **CRSqlite**: CRDT-based SQLite for conflict resolution
- **Transport Layer**: Pluggable transport mechanisms (HTTP, WebSocket, Nostr relays)

## 🌐 Deployment Options

Keep.AI supports multiple deployment scenarios:

1. **Self-hosted Web**: Deploy the web app on your own server
2. **Desktop App**: Distribute as an Electron application
3. **CLI Tool**: Install as a global npm package
4. **Docker**: Containerized deployment

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Development Setup

1. Install dependencies: `npm install`
2. Build packages: `npm run build`
3. Run tests: `cd packages/tests && npm test`
4. Start development: `npm run dev`

## 📝 Environment Variables

Create a `.env` file in your home directory at `~/.keep.ai/.env`:

```bash
# OpenRouter AI API (required for AI functionality)
OPENROUTER_API_KEY=your_api_key_here
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1

# AI Model (optional, defaults to a reasonable model)
AGENT_MODEL=anthropic/claude-sonnet-4

# Exa Search API (optional, for web search functionality)
EXA_API_KEY=your_exa_api_key_here
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Nostr](https://nostr.com/) protocol for decentralized communication
- Uses [CRSqlite](https://github.com/vlcn-io/cr-sqlite) for conflict-free replicated databases
- AI functionality powered by [AI SDK](https://sdk.vercel.ai/)
- Desktop app built with [Electron](https://www.electronjs.org/)

## 📞 Support

- **Homepage**: https://github.com/nostrband/keep.ai
- **Issues**: [GitHub Issues](https://github.com/nostrband/keep.ai/issues)
- **Email**: artur@nostr.band

---

*Keep.AI - Your privacy-focused AI assistant that stays under your control.*