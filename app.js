const http = require('http');
const https = require('https');

const SHOP = 'libasdelhi.myshopify.com';
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN; // Set this in AWS Lambda / EC2 env vars

if (!ACCESS_TOKEN) {
  console.error("❌ SHOPIFY_ACCESS_TOKEN environment variable is not set!");
  process.exit(1);
}

// ======================
// SAFE FETCH FUNCTION
// ======================
function fetchData(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'X-Shopify-Access-Token': ACCESS_TOKEN
      }
    };

    const req = https.get(url, options, (res) => {
      let data = '';

      console.log("Status Code:", res.statusCode);

      if (res.statusCode === 401) {
        return reject("Unauthorized - check your Shopify access token");
      }

      if (res.statusCode === 404) {
        return reject("Resource not found (404)");
      }

      res.on('data', chunk => data += chunk);

      res.on('end', () => {
        console.log("Response received");

        if (!data) {
          return reject("Empty response");
        }

        try {
          resolve(JSON.parse(data));
        } catch (err) {
          console.log("Invalid JSON:", data.substring(0, 200));
          reject("Invalid JSON response from Shopify");
        }
      });
    });

    req.on('error', (err) => {
      console.log("HTTP Error:", err.message);
      reject(err.message);
    });

    req.setTimeout(10000, () => {
      console.log("Timeout hit");
      req.destroy();
      reject("Request timed out");
    });
  });
}

// ======================
// SEND RESPONSE HELPER
// ======================
function sendJSON(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

// ======================
// SERVER
// ======================
const server = http.createServer(async (req, res) => {

  console.log("Incoming request:", req.url);

  if (!req.url.startsWith('/support')) {
    return sendJSON(res, 200, { message: "API running" });
  }

  // Safe URL parsing
  let urlObj;
  try {
    urlObj = new URL(req.url, `http://${req.headers.host}`);
  } catch (e) {
    return sendJSON(res, 400, { message: "Invalid request URL" });
  }

  const orderId = urlObj.searchParams.get('orderId');
  const action = urlObj.searchParams.get('action');

  if (!orderId || !action) {
    return sendJSON(res, 400, { message: "Missing parameters: orderId and action are required" });
  }

  try {
    // ======================
    // STEP 1: FETCH ORDER
    // ======================
    console.log("Calling Order API for:", orderId);

    const orderAPI = `https://${SHOP}/admin/api/2024-01/orders.json?name=%23${orderId}&status=any`;
    const orderData = await fetchData(orderAPI);

    if (!orderData.orders || orderData.orders.length === 0) {
      return sendJSON(res, 404, { message: `Order #${orderId} not found` });
    }

    const order = orderData.orders[0];
    const order_id = order.id;

    console.log("Order found:", order_id);

    // ======================
    // CASE 1: ORDER STATUS
    // ======================
    if (action === "order") {

      console.log("Calling Fulfillment API...");

      const fulfilmentAPI = `https://${SHOP}/admin/api/2024-01/orders/${order_id}/fulfillments.json`;
      const fulfilmentData = await fetchData(fulfilmentAPI);

      if (!fulfilmentData.fulfillments || fulfilmentData.fulfillments.length === 0) {
        return sendJSON(res, 200, { message: "Order placed but not shipped yet" });
      }

      const shipments = fulfilmentData.fulfillments.map(f => ({
        status: f.shipment_status || "N/A",
        tracking_url: f.tracking_url || "N/A",
        tracking_number: f.tracking_number || "N/A",
        carrier: f.tracking_company || "N/A"
      }));

      return sendJSON(res, 200, { shipments });
    }

    // ======================
    // STEP 2: FETCH METAFIELD
    // ======================
    console.log("Calling Metafield API...");

    const metafieldAPI = `https://${SHOP}/admin/api/2024-01/orders/${order_id}/metafields.json?namespace=returnprime&key=lifecycle_data`;
    const metafieldData = await fetchData(metafieldAPI);

    if (!metafieldData.metafields || metafieldData.metafields.length === 0) {
      return sendJSON(res, 200, { message: "No return/refund data found for this order" });
    }

    let parsedData = {};

    try {
      const rawValue = metafieldData.metafields[0].value;
      parsedData = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
    } catch (e) {
      console.log("Metafield parse error:", e.message);
      return sendJSON(res, 500, { message: "Error parsing return/refund data" });
    }

    // ======================
    // CASE 2: RETURN STATUS
    // ======================
    if (action === "return") {

      const returnData = Object.values(parsedData).map(item => ({
        return_status: item.return?.latest_status?.status || "N/A",
        shipment_status: item.shipment?.latest_status?.status || "N/A",
        logistics_partner: item.shipment?.logistics_partner || "N/A",
        tracking_id: item.shipment?.tracking_id || "N/A"
      }));

      return sendJSON(res, 200, { returnData });
    }

    // ======================
    // CASE 3: REFUND STATUS
    // ======================
    if (action === "refund") {

      const refundData = Object.values(parsedData).map(item => ({
        refund_status: item.refund?.status?.status || "N/A",
        amount: item.refund?.amount || 0,
        mode: item.refund?.mode || "N/A"
      }));

      return sendJSON(res, 200, { refundData });
    }

    return sendJSON(res, 400, { message: "Invalid action. Use: order | return | refund" });

  } catch (err) {
    console.log("ERROR:", err);
    return sendJSON(res, 500, { message: "Something went wrong", detail: err.toString() });
  }

});

// ======================
// START SERVER
// ======================
server.listen(3000, '0.0.0.0', () => {
  console.log("🚀 Server running on port 3000");
});
