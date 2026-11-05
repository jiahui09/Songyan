/**
 * 零依赖热更新代理（开发期工具，不入库、不进主题）
 * 用法：node livereload.js   （需先让 hexo server 跑在 4001：npx hexo server -p 4001）
 * 访问 http://localhost:4000 —— HTML 响应注入 SSE 客户端脚本；
 * watch 主题与 source 目录，变化后等 0.8s（留给 hexo 重建路由）广播 reload。
 * 代理对上游强制 identity 编码，免去 gzip 解压。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const UPSTREAM_PORT = 4001; // hexo server
const LISTEN_PORT = 4000;  // 浏览器访问
const WATCH_DIRS = [
  path.resolve(__dirname, '../themes/hexo-theme-songyan'),
  path.resolve(__dirname, 'source'),
  path.resolve(__dirname, '_config.yml')
];

const CLIENT_JS = `<script>
(function(){
  var es = new EventSource('/__livereload');
  es.onmessage = function(e){ if(e.data === 'reload') location.reload(); };
  es.onerror = function(){ /* hexo server 重启期间静默重连 */ };
})();
</script>`;

const sseClients = new Set();

let broadcastTimer = null;
function broadcast() {
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    for (const res of sseClients) res.write('data: reload\n\n');
    console.log(`[livereload] reload broadcast (${sseClients.size} client(s))`);
  }, 800);
}

for (const dir of WATCH_DIRS) {
  try {
    fs.watch(dir, { recursive: true }, (event, file) => {
      if (file && /(^|\/)(node_modules|\.git|db\.json|public)\//.test(file)) return;
      console.log(`[livereload] change: ${event} ${file || dir}`);
      broadcast();
    });
  } catch (err) {
    console.warn(`[livereload] cannot watch ${dir}: ${err.message}`);
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/__livereload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write('data: connected\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  const headers = { ...req.headers, host: `localhost:${UPSTREAM_PORT}`, 'accept-encoding': 'identity' };
  const upstream = http.request(
    { host: '127.0.0.1', port: UPSTREAM_PORT, method: req.method, path: req.url, headers },
    (up) => {
      const isHtml = String(up.headers['content-type'] || '').includes('text/html');
      if (!isHtml || up.statusCode !== 200) {
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
        return;
      }
      // HTML：改写长度后注入客户端脚本（</body> 前；无 </body> 则追加尾部）
      delete up.headers['content-length'];
      delete up.headers['content-encoding'];
      res.writeHead(up.statusCode, up.headers);
      let body = '';
      up.setEncoding('utf8');
      up.on('data', (chunk) => { body += chunk; });
      up.on('end', () => {
        body = body.includes('</body>')
          ? body.replace('</body>', CLIENT_JS + '</body>')
          : body + CLIENT_JS;
        res.end(body);
      });
    }
  );
  upstream.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`hexo server (:${UPSTREAM_PORT}) 不可达：${err.message}`);
  });
  req.pipe(upstream);
});

server.listen(LISTEN_PORT, () => {
  console.log(`热更新已启动：http://localhost:${LISTEN_PORT}/ （上游 hexo :${UPSTREAM_PORT}，SSE 客户端 /__livereload）`);
});
