const fs = require('fs');
const https = require('https');
const path = require('path');

const tools = [
  {
    name: 'python.wasm',
    url: 'https://github.com/vmware-labs/webassembly-language-runtimes/releases/download/python%2F3.11.3%2B20230428-7d1b259/python-3.11.3.wasm'
  },
  {
    name: 'ruby.wasm',
    url: 'https://github.com/vmware-labs/webassembly-language-runtimes/releases/download/ruby%2F3.2.0%2B20230215-1349da9/ruby-3.2.0.wasm'
  }
];

const downloadDir = path.join(process.cwd(), 'public', 'toolchain');
if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
}

async function download(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                download(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
                return;
            }

            response.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log(`Successfully downloaded: ${path.basename(dest)}`);
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
}

async function run() {
    console.log('Starting toolchain binary sync...');
    for (const tool of tools) {
        const dest = path.join(downloadDir, tool.name);
        try {
            await download(tool.url, dest);
        } catch (err) {
            console.error(`Error downloading ${tool.name}:`, err.message);
        }
    }
    console.log('Sync complete.');
}

run();
