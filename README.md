# ModelPort

<p align="center">
  <img src="build/icons.png" alt="ModelPort Logo" width="128" height="128">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Release-v1.4.1-blue?style=flat-square&logo=github" alt="Release">
  <img src="https://img.shields.io/badge/License-GPL--3.0-blue?style=flat-square" alt="License">
  <br>
  <a href="https://www.electronjs.org/"><img src="https://img.shields.io/badge/Electron-33+-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron"></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat-square" alt="Platform">
</p>

<p align="center">
  <strong><a href="README_CN.md">中文</a> | <a href="https://github.com/polite0803/ModelPort">GitHub</a> | <a href="https://github.com/polite0803/ModelPort/releases">Releases</a></strong>
</p>

<p align="center">
  <strong>One local port for every model you own.</strong>
</p>

<p align="center">
  ModelPort turns any OpenAI-compatible endpoint into a single local API. It ships a 89-entry
  catalogue of key-based and key-less aggregate channels (including Kilo's free pool), thirteen
  account channels with their own account pools and credit accounting, and user-defined custom
  providers — so any OpenAI-compatible client works out of the box.
</p>

![Product Preview](docs/screenshots/preview.png)

## ✨ Features

- OpenAI Compatible API: standard OpenAI-compatible endpoints for seamless integration
- Multi-Provider Support: 79 aggregate channels (API-key, free-tier, local), 13 account channels and a custom provider type
- Account Channels: browser / device-code login with account pools, daily credit claim, per-model credit weights and free-model badges
- Online Model Catalogue: refresh a channel's model list online, switch models off, restore models the pack marked dead
- 🆕 Context Management: Intelligent conversation context management with sliding window, token limit, and summary strategies
- 🆕 Function Calling Support: Universal tool calling capability for all models via prompt engineering, compatible with Cherry Studio, Kilo Code, and other clients
- 🆕 Model Mapping: Flexible model name mapping with wildcard support and preferred provider/account selection
- 🆕 Custom Parameters: Support for custom HTTP headers to enable web search, thinking mode, and deep research features
- Dashboard Monitoring: Real-time request traffic, token usage, and success rates
- API Key Management: Generate and manage keys for your local proxy
- Request Logs: Detailed request logging for debugging and analysis
- Proxy Configuration: Flexible proxy settings and routing strategies
- System Tray Integration: Quick access to status from menu bar
- Multilingual: English and Simplified Chinese support
- Modern UI: Clean, responsive interface with dark/light theme support

## 🤖 Supported Providers

| Provider class | Auth Type | Count | Notes |
| -------------- | --------- | ----- | ----- |
| Aggregate catalogue | API key / none | 89 entries / 570 models | OpenAI-chat and Anthropic-messages wires; includes Kilo's key-less free pool |
| Account channels | Browser / device-code / API-key | 13 channels | Each channel keeps its own account pool, daily credit claim and model gating |
| Custom provider | Configured per provider | — | Any OpenAI-compatible HTTP endpoint you define yourself |

The aggregate catalogue is browsable in the **Aggregate Channels** page, which lists each entry with its category (API key / free tier / local), wire protocol and model count. Saving an entry creates a provider record with namespaced model names (`provider/model`); entries you never save never appear in the provider list. Entries requiring Google ADC are listed but marked unsupported.

The **Account Channels** page covers the thirteen channels (`lobsterai`, `qoder`, `qodercn`, `trae`, `cline`, `loomy`, `raccoon`, `minimax`, `zcode`, `gemini`, `buddy`, `workbuddy`, `opencode`). Model names carry the upstream credit multiplier in one of three shapes (`· x4.0`, `· x0.2→x0.1`, `· 免费`), so you can see the cost of a model before picking it; free models are badged and a model the upstream no longer reports as healthy can be restored from the same panel.

Provider adaptation notes are in [docs/providers](docs/providers/README.md).

## 📥 Installation

### Download

Download the latest release from [GitHub Releases](https://github.com/polite0803/ModelPort/releases):

| Platform              | Download                                 |
| --------------------- | ---------------------------------------- |
| macOS (Apple Silicon) | `ModelPort-x.x.x-arm64.dmg`              |
| Windows               | `ModelPort-x.x.x-x64-setup.exe`          |
| Linux                 | `ModelPort-x.x.x-x64.AppImage` or `.deb` |

### Build from Source

**Requirements:**

- Node.js 22.18+ (24 recommended)
- npm
- Git

```bash
# Clone the repository
git clone https://github.com/polite0803/ModelPort.git
cd ModelPort

# Install dependencies
npm install

# Start development server
npm run dev
```

### Build for Production

```bash
npm run build              # Build the application
npm run build:mac          # Build for macOS (dmg only)
npm run build:win          # Build for Windows (nsis)
npm run build:linux        # Build for Linux (AppImage, deb)
npm run build:all          # Build for all platforms
```

## 📖 Usage

### Step 1: Launch the App

After installation, launch ModelPort. You'll see the main dashboard.

### Step 2: Add a Provider

1. Navigate to **Aggregate Channels** from the sidebar
2. Find a channel (e.g. `kilo` for the key-less free pool, or any API-key entry)
3. Click **Configure**, paste the API key when the entry requires one, and optionally override the base URL or model list
4. Save — the provider appears under **Providers** with models named `<provider>/<model>`

Key-less entries such as Kilo need no credentials: saving them creates an empty local account, so
they route immediately. Entries that use `{placeholders}` in their base URL (Azure, Vertex) must be
overridden with your own endpoint before they can be saved.

For a login channel, open **Account Channels**, pick a channel, sign in through the built-in browser
flow, then enable the models you want to expose. The model list can be refreshed online at any time.

### Step 3: Configure Proxy

1. Navigate to **Proxy Settings** from the sidebar
2. Set the port (default: 8080)
3. Choose a load balancing strategy:
   - **Round Robin**: Distributes requests evenly across accounts
   - **Fill First**: Uses one account until limit is reached
   - **Failover**: Automatically switches on failure
4. Click **Start Proxy**

### Step 4: Test the API

Using Python (OpenAI SDK):

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-api-key",
    base_url="http://localhost:8080/v1"
)

response = client.chat.completions.create(
    model="kilo/kilo-auto/free",
    messages=[
        {"role": "user", "content": "Hello, who are you?"}
    ]
)

print(response.choices[0].message.content)
```

### Step 5: Manage API Keys (Optional)

For security, you can enable API Key authentication:

1. Go to **API Keys** page
2. Click **New API Key**
3. Enter a name and description
4. Copy the generated key

## 📸 Screenshots

| Dashboard | Providers |
|-----------|-----------|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Providers](docs/screenshots/providers.png) |

| Proxy Settings | API Keys |
|----------------|----------|
| ![Proxy](docs/screenshots/proxy.png) | ![API Keys](docs/screenshots/api-keys.png) |

| Models | Session |
|--------|---------|
| ![Models](docs/screenshots/models.png) | ![Session](docs/screenshots/Session.png) |

## ⚙️ Settings

- **Port**: Change the proxy listening port (default: 8080)
- **Routing Strategy**: Round Robin or Fill First
- **Auto-start**: Launch proxy automatically on app startup
- **Theme**: Light, Dark, or System preference
- **Language**: English or Simplified Chinese

## 🏗️ Architecture

```
ModelPort/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # App entry point
│   │   ├── proxy/               # Proxy server (Koa)
│   │   ├── ipc/                 # IPC handlers
│   │   ├── providers/           # Builtin / aggregate / account-channel configs
│   │   ├── channelPack/         # Channel-pack host (worker + compat shims)
│   │   ├── store/               # Persistent storage
│   │   └── tray/                # System tray integration
│   ├── preload/                 # Context bridge
│   ├── renderer/                # React frontend
│   │   ├── components/          # UI components
│   │   ├── pages/               # Page components
│   │   ├── stores/              # Zustand state
│   │   └── i18n/                # Internationalization
│   └── shared/                  # Types shared by main and renderer
├── build/                       # Build resources
├── resources/                   # Bundled runtime assets
├── scripts/                     # Build scripts
└── tests/                       # Node test-runner suite
```

## 🔧 Tech Stack

| Component | Technology            |
| --------- | --------------------- |
| Framework | Electron 33+          |
| Frontend  | React 18 + TypeScript |
| Styling   | Tailwind CSS          |
| State     | Zustand               |
| Build     | Vite + electron-vite  |
| Packaging | electron-builder      |
| Server    | Koa                   |

## 📁 Data Storage

Application data is stored in `~/.modelport/` directory (kept unchanged on purpose so existing installs keep their accounts and keys):

- `data.json` - configuration, providers, accounts and app logs (one electron-store file)
- `store.key` - this install's data key, sealed by the OS keystore
- `request-logs/` - detailed request logs
- `channel-pack/` - the channel pack's own state and encrypted channel credentials

Account credentials are additionally encrypted with the OS keychain when it is available; if it is
not, they are stored in `data.json` unencrypted.

## ❓ FAQ

### macOS: "App is damaged and can't be opened"

Due to macOS security mechanisms, apps downloaded outside the App Store may trigger this warning. Run the following command to fix it:

```bash
sudo xattr -rd com.apple.quarantine "/Applications/ModelPort.app"
```

### How to update?

Check for updates in the **About** page, or download the latest version from [GitHub Releases](https://github.com/polite0803/ModelPort/releases).

## 🤝 Contributing

1. Fork the project
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

GNU General Public License v3.0. See [LICENSE](LICENSE).

## 🙏 Acknowledgements

- [Electron](https://www.electronjs.org/) - cross-platform framework
- [React](https://react.dev/) - UI framework
- [TypeScript](https://www.typescriptlang.org/) - typed JavaScript
- [Tailwind CSS](https://tailwindcss.com/) - CSS framework
- [Zustand](https://zustand-demo.pmnd.rs/) - state management
- [Koa](https://koajs.com/) - HTTP server
