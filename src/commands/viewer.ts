import { createServer } from 'node:http';
import { createProofBundle } from '../proof.js';
import { error, info, success } from '../utils.js';

interface ViewerOptions {
  port?: string;
  target?: string;
}

const VIEWER_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kelyra Receipt Viewer</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f6f7f9; color: #15181d; }
    main { max-width: 1120px; margin: 0 auto; padding: 28px; }
    header { display: flex; align-items: end; justify-content: space-between; gap: 16px; border-bottom: 1px solid #d9dde5; padding-bottom: 18px; }
    h1 { margin: 0; font-size: 28px; letter-spacing: 0; }
    h2 { margin-top: 28px; font-size: 16px; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 20px; }
    .metric, pre, table { background: #fff; border: 1px solid #d9dde5; border-radius: 8px; }
    .metric { padding: 14px; }
    .label { color: #667085; font-size: 12px; text-transform: uppercase; }
    .value { font-size: 18px; font-weight: 650; margin-top: 6px; overflow-wrap: anywhere; }
    .ok { color: #067647; }
    .bad { color: #b42318; }
    .warn { color: #b54708; }
    table { border-collapse: collapse; width: 100%; overflow: hidden; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #eaecf0; text-align: left; vertical-align: top; }
    th { color: #475467; font-size: 12px; background: #f9fafb; }
    pre { padding: 14px; overflow: auto; max-height: 440px; }
    @media (max-width: 800px) { main { padding: 18px; } header { display: block; } .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Kelyra Receipt Viewer</h1>
        <div id="subtitle" class="label">loading</div>
      </div>
      <div id="generated" class="label"></div>
    </header>
    <section class="grid" id="metrics"></section>
    <section>
      <h2>Files</h2>
      <table>
        <thead><tr><th>Operation</th><th>Path</th><th>Status</th><th>Expected</th></tr></thead>
        <tbody id="files"></tbody>
      </table>
    </section>
    <section>
      <h2>Git Diff</h2>
      <pre id="diff"></pre>
    </section>
    <section>
      <h2>Raw Proof</h2>
      <pre id="raw"></pre>
    </section>
  </main>
  <script>
    function statusClass(value) {
      if (value === true || value === 'ok') return 'ok';
      if (value === false || value === 'failed') return 'bad';
      return 'warn';
    }
    function metric(label, value) {
      return '<div class="metric"><div class="label">' + label + '</div><div class="value ' + statusClass(value) + '">' + String(value) + '</div></div>';
    }
    fetch('/api/proof').then(r => r.json()).then(bundle => {
      document.getElementById('subtitle').textContent = bundle.receipt.id;
      document.getElementById('generated').textContent = bundle.generatedAt;
      document.getElementById('metrics').innerHTML = [
        metric('Files', bundle.verification.filesOk),
        metric('Integrity', bundle.verification.integrityOk),
        metric('Signature', bundle.verification.signatureOk === null ? 'unsigned' : bundle.verification.signatureOk),
        metric('Chain', bundle.verification.chainOk)
      ].join('');
      document.getElementById('files').innerHTML = bundle.receipt.files.map(file =>
        '<tr><td>' + file.operation + '</td><td>' + file.path + '</td><td>' + file.status + '</td><td>' + file.expectedSource + '</td></tr>'
      ).join('');
      document.getElementById('diff').textContent = bundle.git.diff || bundle.git.diffError || 'No diff available.';
      document.getElementById('raw').textContent = JSON.stringify(bundle, null, 2);
    }).catch(err => {
      document.body.textContent = 'Failed to load proof: ' + err.message;
    });
  </script>
</body>
</html>`;

export function createViewerServer(target = 'latest') {
  return createServer((req, res) => {
    if (req.url === '/api/proof') {
      try {
        const bundle = createProofBundle(target);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(bundle));
      } catch (err) {
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(VIEWER_HTML);
  });
}

export async function viewerCommand(options: ViewerOptions = {}): Promise<void> {
  const port = parseInt(options.port ?? '4327', 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    error('Invalid --port value.');
    process.exitCode = 1;
    return;
  }

  const target = options.target ?? 'latest';
  const server = createViewerServer(target);

  server.listen(port, '127.0.0.1', () => {
    success(`Receipt viewer running at http://127.0.0.1:${port}`);
    info(`Target receipt: ${target}`);
  });
}
