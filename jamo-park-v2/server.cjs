const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8']
};
http.createServer((request, response) => {
  const entry = files[new URL(request.url, 'http://localhost').pathname];
  if (!entry) { response.writeHead(404); response.end(); return; }
  fs.readFile(path.join(__dirname, entry[0]), (error, data) => {
    if (error) { response.writeHead(500); response.end('Unable to read file'); return; }
    response.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-store' });
    response.end(data);
  });
}).listen(8188, '127.0.0.1', () => console.log('http://127.0.0.1:8188'));
