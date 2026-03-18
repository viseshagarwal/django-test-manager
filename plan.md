1. Add an OutputChannel specifically for logs. Name it `Django Test Manager Log`.
2. Create a logger utility (`src/logger.ts`) that will provide methods like `info`, `error`, `warn`, `debug`. This utility will write to the `Django Test Manager Log` output channel.
3. Replace existing `console.log` and `console.error` calls with the new logger.
4. Export the logger and initialize it in `extension.ts` on activation.
5. Create a command to view logs if needed (optional, user can just open the output channel). But actually, I just need to create the logger utility and write to an OutputChannel.
6. Run lint and build to verify nothing breaks.
