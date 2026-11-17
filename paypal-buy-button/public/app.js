const PRODUCT_ID = "strategy-session";
const result = document.getElementById("result");
const container = document.getElementById("paypal-button-container");

function show(message, kind = "") {
  result.textContent = message;
  result.className = `result ${kind}`;
}

function loadSdk(clientId, currency) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${currency}&components=buttons`;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load the PayPal SDK"));
    document.head.appendChild(s);
  });
}

async function init() {
  const config = await fetch("/api/config").then((r) => r.json());
  const product = config.products[PRODUCT_ID];
  document.getElementById("price").textContent =
    new Intl.NumberFormat("en-GB", { style: "currency", currency: product.currency }).format(product.price);

  if (!config.clientId) {
    container.innerHTML =
      '<div class="placeholder">Add <code>PAYPAL_CLIENT_ID</code> and <code>PAYPAL_CLIENT_SECRET</code> to <code>.env</code> to show the PayPal button.</div>';
    return;
  }

  await loadSdk(config.clientId, config.currency);

  window.paypal
    .Buttons({
      style: { layout: "vertical", color: "gold", shape: "rect", label: "buynow" },

      async createOrder() {
        const res = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: PRODUCT_ID }),
        });
        const order = await res.json();
        if (!order.id) throw new Error(order.error || "Could not create order");
        return order.id;
      },

      async onApprove(data, actions) {
        const res = await fetch(`/api/orders/${data.orderID}/capture`, { method: "POST" });
        const capture = await res.json();
        const issue = capture?.details?.[0]?.issue;

        if (issue === "INSTRUMENT_DECLINED") return actions.restart();
        if (issue || capture.status !== "COMPLETED") {
          throw new Error(capture?.details?.[0]?.description || capture.error || "Payment not completed");
        }

        const tx = capture.purchase_units[0].payments.captures[0];
        const name = capture.payer?.name?.given_name || "there";
        container.hidden = true;
        show(`Thank you, ${name}. Payment ${tx.id} is ${tx.status.toLowerCase()} — we'll be in touch within one working day to schedule your session.`, "ok");
      },

      onCancel() {
        show("Payment cancelled — no charge was made.");
      },

      onError(err) {
        console.error(err);
        show(`Sorry, something went wrong: ${err.message}`, "err");
      },
    })
    .render(container);
}

init().catch((err) => show(err.message, "err"));
