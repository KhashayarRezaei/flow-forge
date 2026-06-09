// Tiny zero-dependency echo server for local end-to-end demos.
// GET  /article  -> a long-ish text body (so the mock LLM classifies "high")
// POST *         -> echoes the received JSON body
const http = require('http');

const ARTICLE = `Incident report: the checkout service degraded at 02:14 UTC.
Error rates spiked to 38% for roughly nine minutes after a bad deploy.
The on-call engineer rolled back release 1.42.0 and paged the payments team.
Root cause was a missing database index on the orders table causing slow
queries under load. Follow-ups: add the index, add a canary stage to the
deploy pipeline, and write a runbook entry for checkout rollbacks. Customers
on the EU region were most affected; a status-page note was published and
an apology email is pending review before send. This is considered a high
severity event requiring a formal post-mortem within 48 hours.`.repeat(2);

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(ARTICLE);
    } else {
      let parsed;
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        parsed = body;
      }
      // eslint-disable-next-line no-console
      console.log(`[echo] ${req.method} ${req.url} <- ${body.slice(0, 200)}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ received: parsed, at: new Date().toISOString() }));
    }
  });
});

const port = process.env.ECHO_PORT || 4321;
server.listen(port, () => console.log(`echo server on http://localhost:${port}`));
