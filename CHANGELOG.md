# Changelog

All notable changes to Django Test Manager will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.2] - 2025-12-20

### Fixed

- **Status bar tooltip now shows correct statistics** - Tooltip displays Total, Success, Failed, and Skipped counts (#10)

### Improved

- **Code cleanup in testRunner.ts** - Removed unused variables (`configArgs`, `configEnv`)
- **Consistent environment variable handling** - `generateCoverageReport()` now uses `getMergedEnvironmentVariables()` for consistency with other methods, ensuring `.env` file variables are included in coverage generation

---

## [0.3.1] - 2025-12-18

### Added

- **Environment variables from `.env` files** - Load environment variables from a `.env` file via `envFilePath` configuration
- **Custom project root** - New `projectRoot` configuration to specify custom project root paths
- **Variable substitution in paths** - Support for `${workspaceFolder}` in `managePyPath` and `envFilePath`

### Fixed

- Module not found errors when project root differs from workspace root (#3, #8)

---

## [0.3.0] - 2025-12-18

### Added

#### 🔥 Major Features

- **Watch Mode**: Automatically run tests when files change
  - Toggle with `Ctrl+Cmd+W` (Mac) / `Ctrl+Alt+W` (Windows/Linux)
  - Smart detection of affected tests
  - Configurable debounce time
  - Desktop notifications on pass/fail

- **Live Test Status**: Real-time test execution feedback
  - See which test is currently running with animated spinner
  - Progress tracking in status bar (`3/20` style)
  - New status states: `running` and `aborted`
  - Distinct visual icons for each state:
    - 🕐 Pending (clock icon)
    - 🔄 Running (animated spinner)
    - ✅ Passed (checkmark)
    - ❌ Failed (error)
    - ⏭️ Skipped (step-over)
    - 🚫 Aborted (circle-slash)
  - Enhanced status bar shows live progress during test runs

- **Test History & Analytics**: Track all your test runs
  - View test history dashboard with `Ctrl+Cmd+H` / `Ctrl+Alt+H`
  - Flakiness detection for intermittent failures
  - Slowest tests report
  - Pass/fail rate analytics
  - Export history to JSON

- **VS Code Native Test Explorer Integration**: Tests now appear in VS Code's built-in Testing view
  - Run/Debug profiles
  - Integrates with the native test runner UI
  - Works alongside the Django Test Explorer sidebar

- **Run/Debug Test at Cursor**: Execute tests without navigating
  - `Ctrl+Cmd+T` / `Ctrl+Alt+T` to run test at cursor
  - `Ctrl+Cmd+D` / `Ctrl+Alt+D` to debug test at cursor

#### ⌨️ Keyboard Shortcuts

| Mac | Windows/Linux | Command |
|-----|---------------|---------|
| `Ctrl+Cmd+T` | `Ctrl+Alt+T` | Run Test at Cursor |
| `Ctrl+Cmd+D` | `Ctrl+Alt+D` | Debug Test at Cursor |
| `Ctrl+Cmd+F` | `Ctrl+Alt+F` | Run Current File |
| `Ctrl+Cmd+A` | `Ctrl+Alt+A` | Run All Tests |
| `Ctrl+Cmd+E` | `Ctrl+Alt+E` | Run Failed Tests |
| `Ctrl+Cmd+W` | `Ctrl+Alt+W` | Toggle Watch Mode |
| `Ctrl+Cmd+H` | `Ctrl+Alt+H` | View Test History |
| `Ctrl+Cmd+S` | `Ctrl+Alt+S` | Search Tests |
| `Ctrl+Cmd+R` | `Ctrl+Alt+R` | Refresh Tests |
| `Ctrl+Cmd+C` | `Ctrl+Alt+C` | Cancel Tests |

#### ⚙️ New Configuration Options

- `djangoTestManager.watchMode` - Enable watch mode
- `djangoTestManager.watchDebounceMs` - Debounce time for watch mode
- `djangoTestManager.watchPattern` - Files to watch
- `djangoTestManager.watchRunAffectedOnly` - Run only affected tests
- `djangoTestManager.showNotifications` - Show desktop notifications
- `djangoTestManager.useNativeTestExplorer` - Enable native test explorer
- `djangoTestManager.historyMaxSessions` - Max sessions in history

### Improved

- **Performance optimizations** with caching for test base classes and regex patterns
- **Better test class detection** with configurable custom base classes
- **Centralized test utilities** in new `testUtils.ts` module
- **Pre-compiled regex patterns** for faster parsing
- **Batch processing** for large file sets
- **Debounced UI updates** to reduce flickering

### Fixed

- Improved test class detection to avoid false positives on non-test classes
- **Debug no longer modifies launch.json** - Debug config is now passed directly to VS Code (PR #6 by @Abhi904485)
- **Test History now records from terminal runner** - Previously only recorded via native test controller

---

## [0.2.2] - 2025-12-10

### Added

- Full support for **Async Tests** (`async def test_...`)
- **Test Profiles** support for different run configurations
- Status bar performance improvements with smart debouncing

### Improved

- Tree view now respects **Active File Icon Theme**
- CodeLenses appear in **new/untitled files** and **Git Diff** views

### Fixed

- Resolved issues with large output buffers causing extension freeze

---

## [0.2.1] - 2025-12-05

### Improved

- Better argument handling
- Performance improvements

---

## [0.2.0] - 2025-12-01

### Added

- Configuration Panel
- Test Search command
- Run Failed Tests command

---

## [0.1.0] - 2024-11-15

### Added

- Initial release
- Test discovery and tree view
- Run and debug tests
- CodeLens integration
- Test profiles
