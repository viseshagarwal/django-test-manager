<div align="center">
  <img src="https://raw.githubusercontent.com/viseshagarwal/django-test-manager/main/icon.png" alt="Django Test Manager Logo" width="128" height="128" />
  <h1>Django Test Manager</h1>
  <p>
    <b>The ultimate tool for managing, running, and debugging Django tests in VS Code.</b>
  </p>
  <p>
    <a href="https://github.com/viseshagarwal/django-test-manager/issues">Report Bug</a>
    ·
    <a href="https://github.com/viseshagarwal/django-test-manager/discussions">Request Feature</a>
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
  </p>
</div>

---

**Django Test Manager** brings a powerful, native-feeling test runner to your Django workflow. Discover, organize, search, run, and debug your tests with zero configuration required.

## ✨ Key Features

*   **🔍 Smart Discovery**: Automatically detects tests, including **Async Tests** (`async def`). View your suite hierarchically by app, file, class, and method.
*   **⚡ Fast Execution**: Optimized runner with **native tree icons** and reduced overhead.
*   **▶️ One-Click Run**: execute individual methods, classes, files, or the entire suite instantly.
*   **🐞 Zero-Config Debugging**: Click the debug icon next to any test to start a session. We handle `launch.json` for you.
*   **🔎 Instant Search**: integrated "Search Tests" command to jump to any test in your large codebase.
*   **⚙️ Test Profiles**: Switch between different run configurations (e.g., `Fast` with `--failfast`, `CI` with `--keepdb`) on the fly.
*   **📦 Native Experience**: Uses VS Code's native file icons and themes for a seamless look.
*   **📝 CodeLens**: "Run" and "Debug" shortcuts appear directly in your Python files—even in **Untitled** buffers or **Git Diffs**!

## 📦 Installation

**Via VS Code Marketplace:**
<a href="https://marketplace.visualstudio.com/items?itemName=ViseshAgarwal.django-test-manager">Get it from the Visual Studio Marketplace</a>

1. Open **VS Code**.
2. Go to the **Extensions** view (`Cmd+Shift+X` or `Ctrl+Shift+X`).
3. Search for `Django Test Manager`.
4. Click **Install**.

**Via Open VSX Registry:**
<a href="https://open-vsx.org/extension/viseshagarwal/django-test-manager">Get it from Open VSX</a>

**Via VSIX (Manual):**
1. Download the latest `.vsix` release from the GitHub releases page.
2. In VS Code, run the command `Extensions: Install from VSIX...`.
3. Select the downloaded file.

## 🚀 Getting Started

1.  Open any folder containing a **Django Project** (must have a `manage.py`).
2.  The extension accepts your Python environment automatically (including `venv`, `.env`, etc.).
3.  Click the **Django Tests** icon in the Activity Bar to view your test tree.
4.  **Run** any test by clicking the `▶` Play button.

## 🛠️ Configuration

Configure the extension via the **Settings (Gear Icon)** or `settings.json`:

| Setting | Default | Description |
| :--- | :--- | :--- |
| `pythonPath` | `python3` | Path to your Python interpreter (auto-detects venv). |
| `managePyPath` | `manage.py` | Relative path to `manage.py`. |
| `testFilePattern` | `**/*test*.py` | Glob pattern for finding test files. |
| `testMethodPattern` | `test_` | Prefix for identifying test methods. |
| `activeProfile` | `Default` | Currently active test argument profile. |

## ⌨️ Commands

| Command | Description |
| :--- | :--- |
| `Django Test Manager: Search Tests` | Quick-pick menu to find and run any test. |
| `Django Test Manager: Run Failed Tests` | Smart re-run of only the tests that failed. |
| `Django Test Manager: Cancel Tests` | Instantly stop the current test run. |
| `Django Test Manager: Select Profile` | Switch between `Default`, `Fast`, `Clean`, etc. |

## 🤝 Contributing

We love contributions! Here is how you can set up the project locally:

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/viseshagarwal/django-test-manager.git
    cd django-test-manager
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Run the Extension**:
    *   Open the folder in **VS Code**.
    *   Press `F5` to start debugging.
    *   This will open a new VS Code window (Extension Host) with the extension loaded.

4.  **Submit a Pull Request**:
    *   Make your changes.
    *   Run `npm run compile` to ensure everything builds.
    *   Push your changes and open a PR on GitHub.

## 📦 Release Notes

### 0.2.2
*   **New**: Added full support for **Async Tests** (`async def`).
*   **New**: Improved status bar performance with smart debouncing (no more crashes on large suites!).
*   **New**: Added **Test Profiles** support.
*   **Improved**: Tree view now respects your **Active File Icon Theme**.
*   **Improved**: CodeLenses now appear in **new/untitled files** and **Git Diff** views.
*   **Fixed**: Resolved issues with large output buffers causing extension freeze.

### 0.2.0 - 0.2.1
*   Added Configuration Panel and Search.
*   Improved argument handling and performance.

---

<div align="center">
  <p>Made with ❤️ for the Django Community</p>
</div>
