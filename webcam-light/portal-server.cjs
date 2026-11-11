const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const files = { '/': ['portal.html', 'text/html; charset=utf-8'], '/portal.html': ['portal.html', 'text/html; charset=utf-8'], '/forest.png': ['forest.png', 'image/png'] };
const server = http.createServer((req, res) => {
  const file = files[new URL(req.url, 'http://localhost').pathname];
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  fs.readFile(path.join(__dirname, file[0]), (error, data) => {
    if (error) { res.writeHead(500); res.end('Could not read file'); return; }
    res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' });
    res.end(data);
  });
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'Port is in use. Close the previous portal window and try again.' : error.message); process.exitCode = 1; });
server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  console.log(`Portal ready: ${url}\nKeep this window open. Press Ctrl+C to stop.`);
  if (!process.argv.includes('--open')) return;
  const chrome = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
    .filter(Boolean).map(root => path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')).find(file => fs.existsSync(file));
  if (!chrome) { console.log('Open the address above in Chrome.'); return; }
  const child = spawn(chrome, [url], { detached: true, stdio: 'ignore' });
  child.on('error', error => console.error(error.message));
  child.unref();
});
