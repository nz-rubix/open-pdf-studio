// Launches `tauri dev` with BOTH:
//   • WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//     → enables Chrome DevTools Protocol so the zoom-observer.mjs and any
//       other CDP-based tooling can attach.
//   • --mcp-server                       (passed as a CLI arg to the binary)
//     → starts the in-process MCP server on port 9223 so an AI-driven
//       debug loop can call the synthetic-wheel + zoom-anchor-test tools.
//
// Use this instead of plain `tauri dev` whenever you want the app to be
// remote-controllable. Plain `tauri dev` still works for normal development.

import { spawn } from 'node:child_process';

const env = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9222' };

// The double `--` is intentional:
//   npm-script runs `tauri dev -- --mcp-server`. The first `--` tells `tauri`
//   to forward everything that follows to the bundled binary, so the binary
//   itself receives `--mcp-server` (parsed by clap in src-tauri/src/main.rs).
const child = spawn('npx', ['tauri', 'dev', '--', '--mcp-server'], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
