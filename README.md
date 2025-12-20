<div align="center">
  <img src="https://raw.githubusercontent.com/viseshagarwal/django-test-manager/main/icon.png" alt="Django Test Manager Logo" width="128" height="128" />
  <h1>Django Test Manager</h1>
  <p>
    <b>The ultimate tool for managing, running, and debugging Django tests in VS Code.</b>
  </p>
  <p>
    <a href="#-features">Features</a> •
    <a href="#-installation">Installation</a> •
    <a href="#-quick-start">Quick Start</a> •
    <a href="#-keyboard-shortcuts">Shortcuts</a> •
    <a href="#-configuration">Configuration</a> •
    <a href="#-documentation">Docs</a>
  </p>
  <p>
    <a href="https://marketplace.visualstudio.com/items?itemName=ViseshAgarwal.django-test-manager">
      <img src="https://img.shields.io/visual-studio-marketplace/v/ViseshAgarwal.django-test-manager?style=flat&label=VS%20Code%20Marketplace&logo=visual-studio-code" alt="VS Code Marketplace Version" />
    </a>
    <a href="https://open-vsx.org/extension/viseshagarwal/django-test-manager">
      <img src="https://img.shields.io/open-vsx/v/viseshagarwal/django-test-manager?style=flat&label=Open%20VSX&logo=eclipse-ide" alt="Open VSX Version" />
    </a>
    <a href="https://marketplace.visualstudio.com/items?itemName=ViseshAgarwal.django-test-manager">
      <img src="https://img.shields.io/visual-studio-marketplace/i/ViseshAgarwal.django-test-manager?style=flat" alt="Installs" />
    </a>
    <a href="https://github.com/viseshagarwal/django-test-manager/blob/main/LICENSE">
      <img src="https://img.shields.io/github/license/viseshagarwal/django-test-manager" alt="License" />
    </a>
  </p>
</div>

---

**Django Test Manager** brings a powerful, native-feeling test runner to your Django workflow. Discover, organize, search, run, and debug your tests with zero configuration required.

## ✨ Features

### 🔍 Smart Test Discovery
- **Automatic detection** of all Django test classes and methods
- **Hierarchical view** by app → file → class → method
- **Async test support** (`async def test_...`)
- **Custom base class recognition** (configure your own test base classes)

### ⚡ Fast Test Execution
- **One-click run** for individual methods, classes, files, or entire suite
- **Run test at cursor** - No need to navigate, just press a shortcut
- **Run failed tests** - Re-run only the tests that failed
- **Parallel execution** support with `--parallel` flag

### 🐞 Zero-Config Debugging
- Click the debug icon next to any test to start a debug session
- **No launch.json required** - Debug config is passed directly
- Full breakpoint support

### 👁️ Watch Mode
- **Automatic test running** when files change
- **Smart detection** of affected tests
- **Desktop notifications** on pass/fail
- **Configurable debounce** to avoid running tests while typing

### 🔄 Live Test Status (NEW!)
- **Real-time status updates** - See which test is currently running
- **Running indicator** - Animated spinner shows active test
- **Progress tracking** - Status bar shows `3/20` style progress
- **Aborted state** - Cancelled tests show distinct visual indicator
- **Status icons**:
  - 🕐 Pending (waiting to run)
  - 🔄 Running (currently executing)
  - ✅ Passed
  - ❌ Failed
  - ⏭️ Skipped
  - 🚫 Aborted (cancelled)

### 📊 Test History & Analytics (NEW!)
- **Track all test runs** with persistent history
- **Flakiness detection** - Find tests that fail intermittently
- **Slowest tests report** - Identify performance bottlenecks
- **Pass/fail rate analytics**
- **Export to JSON**

### 🧪 VS Code Native Test Explorer (NEW!)
- **Integrates with VS Code's built-in Test Explorer**
- Tests appear in the native Testing view (beaker icon)
- Run/Debug profiles
- Works alongside the Django Test Explorer sidebar

### 📝 CodeLens Integration
- "Run" and "Debug" shortcuts appear directly in your Python files
- Works in **untitled files** and **Git diff views**

### ⚙️ Test Profiles
- Define multiple test configurations (Fast, CI, Clean, etc.)
- Switch between profiles on the fly
- Custom arguments per profile

---

## 📦 Installation

### Via VS Code Marketplace (Recommended)

1. Open **VS Code**
2. Go to **Extensions** (`Cmd+Shift+X` / `Ctrl+Shift+X`)
3. Search for **"Django Test Manager"**
4. Click **Install**

<a href="https://marketplace.visualstudio.com/items?itemName=ViseshAgarwal.django-test-manager">
  <img src="https://img.shields.io/badge/Install%20from-VS%20Code%20Marketplace-blue?style=for-the-badge&logo=visual-studio-code" alt="Install from VS Code Marketplace" />
</a>

### Via Open VSX Registry

<a href="https://open-vsx.org/extension/viseshagarwal/django-test-manager">
  <img src="https://img.shields.io/badge/Install%20from-Open%20VSX-purple?style=for-the-badge&logo=eclipse-ide" alt="Install from Open VSX" />
</a>

### Via VSIX (Manual)

1. Download the latest `.vsix` from [GitHub Releases](https://github.com/viseshagarwal/django-test-manager/releases)
2. Run `Extensions: Install from VSIX...` in VS Code
3. Select the downloaded file

---

## 🚀 Quick Start

### 1. Open Your Django Project

Open any folder containing a Django project (must have `manage.py`).

### 2. View Your Tests

Click the **Django Tests** icon in the Activity Bar to see your test tree.

![Test Tree](https://raw.githubusercontent.com/viseshagarwal/django-test-manager/main/docs/test-tree.png)

### 3. Run a Test

- Click the **▶️ Play** button next to any test
- Or use keyboard shortcuts (see below)
- Or use CodeLens links in your test files

### 4. Enable Watch Mode (Optional)

Press `Ctrl+Cmd+W` (Mac) or `Ctrl+Alt+W` to enable Watch Mode. Tests will run automatically when you save files.

---

## ⌨️ Keyboard Shortcuts

| Mac | Windows/Linux | Command |
|-----|---------------|---------|
| `Ctrl+Cmd+T` | `Ctrl+Alt+T` | **Run Test at Cursor** |
| `Ctrl+Cmd+D` | `Ctrl+Alt+D` | Debug Test at Cursor |
| `Ctrl+Cmd+F` | `Ctrl+Alt+F` | Run Current File |
| `Ctrl+Cmd+A` | `Ctrl+Alt+A` | Run All Tests |
| `Ctrl+Cmd+E` | `Ctrl+Alt+E` | Run Failed Tests |
| `Ctrl+Cmd+W` | `Ctrl+Alt+W` | **Toggle Watch Mode** |
| `Ctrl+Cmd+H` | `Ctrl+Alt+H` | **View Test History** |
| `Ctrl+Cmd+S` | `Ctrl+Alt+S` | Search Tests |
| `Ctrl+Cmd+R` | `Ctrl+Alt+R` | Refresh Tests |
| `Ctrl+Cmd+C` | `Ctrl+Alt+C` | Cancel Tests |

---

## ⚙️ Configuration

Configure the extension in **Settings** (`Cmd+,` / `Ctrl+,`) or `settings.json`:

### Basic Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `djangoTestManager.pythonPath` | `python3` | Path to Python interpreter (auto-detects venv) |
| `djangoTestManager.managePyPath` | `manage.py` | Path to `manage.py`. Supports relative paths, absolute paths, or `${workspaceFolder}/path/to/manage.py`.                    |
| `djangoTestManager.testFilePattern` | `**/{tests/**/*.py,test.py,tests.py}` | Glob pattern for test files |
| `djangoTestManager.testMethodPattern` | `test_` | Prefix for test methods |
| `djangoTestManager.projectRoot`          | `""`                                                        | Root path of the Django project.        |
| `environmentVariables` | `{}`                                                        | Environment variables to set when running tests (object with key-value pairs).                                              |
| `djangoTestManager.envFilePath`          | `.env`                                                      | Path to `.env` file. Supports relative paths, absolute paths, or `${workspaceFolder}/.env`. Set to empty string to disable. |
| `djangoTestManager.testArguments`.       | `["--keepdb" ...]` | Pass Required Test Arguments  |

### Test Profiles

| Setting | Default | Description |
|---------|---------|-------------|
| `djangoTestManager.activeProfile` | `Default` | Currently active profile |
| `djangoTestManager.testProfiles` | See below | Define your own profiles |

**Default Profiles:**
```json
{
  "Default": [],
  "Fast": ["--keepdb", "--failfast", "--parallel"],
  "Clean": ["--noinput"]
}
```

### Watch Mode Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `djangoTestManager.watchMode` | `false` | Enable watch mode |
| `djangoTestManager.watchDebounceMs` | `1000` | Debounce time in ms |
| `djangoTestManager.watchPattern` | `**/*.py` | Files to watch |
| `djangoTestManager.watchRunAffectedOnly` | `true` | Only run affected tests |
| `djangoTestManager.showNotifications` | `true` | Show desktop notifications |

### Advanced Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `djangoTestManager.testBaseClasses` | `[]` | Additional test base classes to recognize |
| `djangoTestManager.useNativeTestExplorer` | `true` | Enable VS Code native test explorer |
| `djangoTestManager.enableCoverage` | `false` | Enable code coverage |
| `djangoTestManager.historyMaxSessions` | `50` | Max sessions in history |

---

## 📖 Documentation

For detailed documentation, see the [docs](./docs) folder:

- [Getting Started Guide](./docs/getting-started.md)
- [Watch Mode Guide](./docs/watch-mode.md)
- [Test History & Analytics](./docs/test-history.md)
- [Configuration Reference](./docs/configuration.md)
- [Troubleshooting](./docs/troubleshooting.md)

---

## 🎯 Commands

Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and type "Django":

| Command | Description |
|---------|-------------|
| `Django Test Manager: Run Test at Cursor` | Run the test under your cursor |
| `Django Test Manager: Debug Test at Cursor` | Debug the test under your cursor |
| `Django Test Manager: Run All Tests` | Run the entire test suite |
| `Django Test Manager: Run Failed Tests` | Re-run only failed tests |
| `Django Test Manager: Toggle Watch Mode` | Enable/disable watch mode |
| `Django Test Manager: View Test History` | Open test history dashboard |
| `Django Test Manager: Search Tests` | Quick-pick menu to find tests |
| `Django Test Manager: Refresh Tests` | Refresh the test list |
| `Django Test Manager: Select Profile` | Switch test profiles |
| `Django Test Manager: Cancel Tests` | Stop running tests |

---

## 🤝 Contributing

We love contributions! Here's how to set up the project:

```bash
# Clone the repository
git clone https://github.com/viseshagarwal/django-test-manager.git
cd django-test-manager

# Install dependencies
npm install

# Compile
npm run compile

# Run the extension (F5 in VS Code)
```

### Project Structure

```
django-test-manager/
├── src/
│   ├── extension.ts          # Extension entry point
│   ├── testDiscovery.ts      # Test discovery logic
│   ├── testRunner.ts         # Test execution
│   ├── testCodeLensProvider.ts # CodeLens integration
│   ├── watchMode.ts          # Watch mode manager
│   ├── testHistory.ts        # Test history & analytics
│   ├── nativeTestController.ts # VS Code native test API
│   └── ...
├── docs/                     # Documentation
├── package.json              # Extension manifest
└── README.md
```

---

## 📦 Release Notes

### 0.3.1 (Latest)
- ✨ **New**: Support for loading environment variables from `.env` files via `envFilePath` configuration.
- ✨ **New**: Support for `projectRoot` configuration to specify custom project root path.
- ✨ **New**: Support for absolute paths and variable substitution (`${workspaceFolder}`) in `managePyPath` and `envFilePath`.
- ⚡ **Improved**: Default test profile runs tests sequentially Without DB Reuse. for reliable results. Parallel execution available via profiles.

### 0.3.0
- ✨ **NEW**: Live Test Status - Real-time running/aborted indicators
- ✨ **NEW**: Watch Mode - Auto-run tests on file changes
- ✨ **NEW**: Test History & Analytics dashboard
- ✨ **NEW**: VS Code Native Test Explorer integration
- ✨ **NEW**: Run/Debug Test at Cursor commands
- ✨ **NEW**: Keyboard shortcuts for all commands
- 🔧 **FIX**: Debug no longer modifies launch.json (PR #6)
- ⚡ **Improved**: Performance optimizations with caching
- ⚡ **Improved**: Better test class detection

### 0.2.2
- Added full support for **Async Tests** (`async def`)
- Improved status bar performance with smart debouncing
- Added **Test Profiles** support
- Tree view now respects your **Active File Icon Theme**
- CodeLenses now appear in **new/untitled files** and **Git Diff** views

### 0.2.0 - 0.2.1
- Added Configuration Panel and Search
- Improved argument handling and performance

---

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">
  <p>Made with ❤️ for the Django Community</p>
  <p>
    <a href="https://github.com/viseshagarwal/django-test-manager/issues">Report Bug</a>
    ·
    <a href="https://github.com/viseshagarwal/django-test-manager/discussions">Request Feature</a>
    ·
    <a href="https://twitter.com/viseshagarwal">Follow on Twitter</a>
  </p>
</div>
