// ============================================================
// CORE SERVICES: ToolchainService
// Manages extra language binaries (PHP, Rust, etc.) via WASM.
// ============================================================

import type { WebContainer } from '@webcontainer/api'

export interface ToolDefinition {
  name: string
  command: string
  serverPath: string // Path to fetch from (static assets)
  containerPath: string // Path within WebContainer
  shimContent: string
}

const PHP_SHIM = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { WASI } = require('wasi');

async function run() {
  const wasmPath = path.join(__dirname, '../.toolchain/php.wasm');
  if (!fs.existsSync(wasmPath)) {
    process.stderr.write('php: command not found (binary missing at ' + wasmPath + ')\\n');
    return;
  }

  const args = process.argv.slice(1);
  const scriptPath = args[1] ? path.resolve(process.cwd(), args[1]) : '';

  // 1. SILENCE NODE WARNINGS (WASI is experimental)
  process.removeAllListeners('warning');

  // 2. Minimal CGI environment for php-cgi
  const env = { 
    ...process.env, 
    REDIRECT_STATUS: '200',
    REQUEST_METHOD: 'GET',
    SCRIPT_FILENAME: scriptPath,
    SCRIPT_NAME: args[1] || '',
    PATH_INFO: args[1] || '',
    QUERY_STRING: '',
    SERVER_NAME: 'localhost',
    SERVER_PROTOCOL: 'HTTP/1.1',
    GATEWAY_INTERFACE: 'CGI/1.1'
  };

  const wasi = new WASI({ 
    version: 'preview1', 
    // Add -q to suppress CGI headers, then keep any other flags
    args: [args[0], '-q', ...args.slice(2)], 
    env,
    preopens: { '/': '/' }
  });

  const wasm = await WebAssembly.compile(fs.readFileSync(wasmPath));
  const instance = await WebAssembly.instantiate(wasm, wasi.getImportObject());
  wasi.start(instance);
}
run().catch(err => process.stderr.write(err.message + '\\n'));
`;

const PYTHON_SHIM = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { WASI } = require('wasi');

async function run() {
  const wasmPath = path.join(__dirname, '../.toolchain/python.wasm');
  if (!fs.existsSync(wasmPath)) {
    process.stderr.write('python: command not found (binary missing at ' + wasmPath + ')\\n');
    return;
  }

  process.removeAllListeners('warning');

  const args = process.argv.slice(1);
  const processedArgs = args.map((arg, i) => {
    // If it's the first argument after 'python' and doesn't start with '-', resolve it
    if (i === 1 && !arg.startsWith('-')) {
      return path.resolve(process.cwd(), arg);
    }
    return arg;
  });

  const wasi = new WASI({ 
    version: 'preview1', 
    args: processedArgs, 
    env: process.env,
    preopens: { '/': '/' }
  });

  const wasm = await WebAssembly.compile(fs.readFileSync(wasmPath));
  const instance = await WebAssembly.instantiate(wasm, wasi.getImportObject());
  wasi.start(instance);
}
run().catch(err => process.stderr.write(err.message + '\\n'));
`;

const RUBY_SHIM = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { WASI } = require('wasi');

async function run() {
  const wasmPath = path.join(__dirname, '../.toolchain/ruby.wasm');
  if (!fs.existsSync(wasmPath)) {
    process.stderr.write('ruby: command not found (binary missing at ' + wasmPath + ')\\n');
    return;
  }

  process.removeAllListeners('warning');

  const args = process.argv.slice(1);
  const processedArgs = args.map((arg, i) => {
    // If it's the first argument after 'ruby' and doesn't start with '-', resolve it
    if (i === 1 && !arg.startsWith('-')) {
      return path.resolve(process.cwd(), arg);
    }
    return arg;
  });

  const wasi = new WASI({ 
    version: 'preview1', 
    args: processedArgs, 
    env: process.env,
    preopens: { '/': '/' }
  });

  const wasm = await WebAssembly.compile(fs.readFileSync(wasmPath));
  const instance = await WebAssembly.instantiate(wasm, wasi.getImportObject());
  wasi.start(instance);
}
run().catch(err => process.stderr.write(err.message + '\\n'));
`;

const RUST_SHIM = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { WASI } = require('wasi');

async function run() {
  const wasmPath = path.join(__dirname, '../.toolchain/rustc.wasm');
  if (!fs.existsSync(wasmPath)) {
    process.stderr.write('rustc: command not found (binary missing at ' + wasmPath + ')\\n');
    return;
  }

  const wasi = new WASI({ version: 'preview1', args: process.argv.slice(1), env: process.env });
  const wasm = await WebAssembly.compile(fs.readFileSync(wasmPath));
  const instance = await WebAssembly.instantiate(wasm, wasi.getImportObject());
  wasi.start(instance);
}
run().catch(err => process.stderr.write(err.message + '\\n'));
`;

export class ToolchainService {
  private tools: ToolDefinition[] = [
    {
      name: 'PHP',
      command: 'php',
      serverPath: '/toolchain/php.wasm',
      containerPath: '/node_modules/.toolchain/php.wasm',
      shimContent: PHP_SHIM
    },
    {
      name: 'Python',
      command: 'python',
      serverPath: '/toolchain/python.wasm',
      containerPath: '/node_modules/.toolchain/python.wasm',
      shimContent: PYTHON_SHIM
    },
    {
      name: 'Ruby',
      command: 'ruby',
      serverPath: '/toolchain/ruby.wasm',
      containerPath: '/node_modules/.toolchain/ruby.wasm',
      shimContent: RUBY_SHIM
    }
  ]

  async setup(wc: WebContainer, onProgress?: (msg: string) => void): Promise<void> {
    // 1. Ensure required directories exist
    await wc.fs.mkdir('/node_modules/.bin', { recursive: true })
    await wc.fs.mkdir('/node_modules/.toolchain', { recursive: true })

    // 2. Install tool shims and pre-load binaries
    for (const tool of this.tools) {
      // a. Write the shim
      const shimPath = `/node_modules/.bin/${tool.command}`
      const content = tool.shimContent.replace(/\r\n/g, '\n')
      await wc.fs.writeFile(shimPath, content);

      // b. Pre-load binary from public assets if available
      try {
        const fetchUrl = window.location.origin + tool.serverPath;
        if (onProgress) onProgress(`Pre-loading ${tool.name} binary...`)
        console.log(`[ToolchainService] Pre-loading ${tool.name} binary from ${fetchUrl}...`)

        const response = await fetch(fetchUrl)
        if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`)

        const buffer = await response.arrayBuffer()
        await wc.fs.writeFile(tool.containerPath, new Uint8Array(buffer))

        if (onProgress) onProgress(`${tool.name} binary ready`)
        console.log(`[ToolchainService] ${tool.name} binary loaded successfully.`)
      } catch (err) {
        console.warn(`[ToolchainService] Failed to pre-load ${tool.name} binary:`, err)
        if (onProgress) onProgress(`Failed to load ${tool.name}`)
      }
    }

    // 3. Cleanup old folders from previous failed attempts
    try {
      await wc.fs.rm('/usr', { recursive: true })
      await wc.fs.rm('/.bin', { recursive: true })
      await wc.fs.rm('/.toolchain', { recursive: true })
      await wc.fs.rm('/toolchain', { recursive: true })
    } catch {
      // Ignore if not present
    }

    console.log('[ToolchainService] Offline toolchain initialized in node_modules/.bin')
  }
}

export const toolchainService = new ToolchainService()
