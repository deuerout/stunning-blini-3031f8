// PayPal Buy Button example — zero-dependency Node server.
// Creates and captures orders server-side so the price and credentials
// never live in the browser.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
loadDotEnv(join(ROOT, ".env"));

const {
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PAYPAL_ENV = "sandbox",
  PORT = 8888,
} = process.env;

const PAYPAL_API =
  PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

// The catalogue is the single source of truth for prices.
const PRODUCTS = {
  "strategy-session": {
    name: "Transformation Strategy Session",
    description: "90-minute business transformation strategy session with Deverout and Associates",
    price: "250.00",
    currency: "GBP",
  },
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

async function getAccessToken() {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error("Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET");
  }
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Token request failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function paypal(path, body) {
  const token = await getAccessToken();
  const res = await fetch(`${PAYPAL_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

function createOrder(productId) {
  const product = PRODUCTS[productId];
  if (!product) return Promise.resolve({ status: 400, data: { error: "Unknown product" } });
  return paypal("/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: productId,
        description: product.description,
        amount: { currency_code: product.currency, value: product.price },
      },
    ],
  });
}

function captureOrder(orderId) {
  if (!/^[A-Z0-9]+$/i.test(orderId)) {
    return Promise.resolve({ status: 400, data: { error: "Invalid order id" } });
  }
  return paypal(`/v2/checkout/orders/${orderId}/capture`);
}

function send(res, status, payload, type = "application/json") {
  res.writeHead(status, { "Content-Type": type });
  res.end(type === "application/json" ? JSON.stringify(payload) : payload);
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error("Body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/config") {
      return send(res, 200, {
        clientId: PAYPAL_CLIENT_ID || null,
        currency: "GBP",
        products: Object.fromEntries(
          Object.entries(PRODUCTS).map(([id, p]) => [id, { name: p.name, price: p.price, currency: p.currency }])
        ),
      });
    }
    if (req.method === "POST" && url.pathname === "/api/orders") {
      const { productId } = await readJson(req);
      const { status, data } = await createOrder(productId);
      return send(res, status, data);
    }
    const capture = url.pathname.match(/^\/api\/orders\/([^/]+)\/capture$/);
    if (req.method === "POST" && capture) {
      const { status, data } = await captureOrder(capture[1]);
      return send(res, status, data);
    }
    if (req.method === "GET") {
      const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const file = normalize(join(ROOT, "public", rel));
      if (!file.startsWith(join(ROOT, "public"))) return send(res, 403, "Forbidden", "text/plain");
      try {
        const body = await readFile(file);
        return send(res, 200, body, MIME[extname(file)] || "application/octet-stream");
      } catch {
        return send(res, 404, "Not found", "text/plain");
      }
    }
    send(res, 405, { error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`PayPal Buy Button example running at http://localhost:${PORT} (${PAYPAL_ENV})`);
  if (!PAYPAL_CLIENT_ID) console.warn("PAYPAL_CLIENT_ID is not set — copy .env.example to .env and add your sandbox keys.");
});
