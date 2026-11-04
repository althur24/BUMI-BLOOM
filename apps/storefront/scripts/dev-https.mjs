// Local HTTPS dev server for the storefront.
//
// Why: Stripe blocks Apple Pay and Google Pay on plain HTTP. Running the
// storefront over https://localhost lets the wallet buttons render locally.
//
// Setup:
//   brew install mkcert
//   mkcert -install            # needs sudo once, trusts the local CA
//   mkdir -p .certs
//   mkcert -key-file .certs/localhost-key.pem \
//          -cert-file .certs/localhost-cert.pem localhost 127.0.0.1 ::1
//   node scripts/dev-https.mjs
//
// Then open https://localhost:3443/checkout

import { createServer } from "node:https";
import { readFileSync, existsSync } from "node:fs";
import { request as httpRequest } from "node:http";

const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3443);
const TARGET_PORT = Number(process.env.TARGET_PORT || 3000);
const KEY = ".certs/localhost-key.pem";
const CERT = ".certs/localhost-cert.pem";

if (!existsSync(KEY) || !existsSync(CERT)) {
  console.error(
    `Missing certs. Run:\n` +
      `  brew install mkcert && mkcert -install\n` +
      `  mkdir -p .certs\n` +
      `  mkcert -key-file ${KEY} -cert-file ${CERT} localhost 127.0.0.1 ::1`,
  );
  process.exit(1);
}

const server = createServer(
  {
    key: readFileSync(KEY),
    cert: readFileSync(CERT),
  },
  (req, res) => {
    const proxy = httpRequest(
      {
        hostname: "127.0.0.1",
        port: TARGET_PORT,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `localhost:${TARGET_PORT}` },
      },
      (upstream) => {
        res.writeHead(upstream.statusCode || 502, upstream.headers);
        upstream.pipe(res);
      },
    );

    proxy.on("error", (err) => {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end(`Proxy error: ${err.message}`);
    });

    req.pipe(proxy);
  },
);

server.listen(HTTPS_PORT, () => {
  console.log(
    `HTTPS proxy ready: https://localhost:${HTTPS_PORT}  ->  http://localhost:${TARGET_PORT}`,
  );
});
