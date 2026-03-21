const http = require('http');
const https = require('https');

const SHOP = 'libasdelhi.myshopify.com';
const ACCESS_TOKEN = "PASTE_YOUR_TOKEN_HERE"; // TEMP for testing

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

      res.on('data', chunk => data += chunk);

      res.on('end', () => {
        console.log("Response received");

        if (!data) {
          return reject("Empty response");
        }

        try {
          resolve(JSON.parse(data));
        } catch (err) {
          console.log("Invalid JSON:", data);
          reject("Invalid JSON");
        }
      });
    });

    req.on('error', (err) => {
      console.log("HTTP Error:", err);
      reject(err);
    });

    req.setTimeout(5000, () => {
      console.log("Timeout hit");
      req.destroy();
      reject("Timeout");
    });
  });
}

// ======================
// SERVER
// ======================
const server = http.createServer(async (req, res) => {

  console.log("Incoming request:", req.url);

  res.setHeader('Content-Type', 'application/json');

  if (!req.url.startsWith('/support')) {
    return res.end(JSON.stringify({ message: "API running" }));
  }

  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const orderId = urlObj.searchParams.get('orderId');
  const action = urlObj.searchParams.get('action');

  if (!orderId || !action) {
    return res.end(JSON.stringify({ message: "Missing parameters" }));
  }

  try {
    // ======================
    // STEP 1: FETCH ORDER
    // ======================
    console.log("Calling Order API...");

    const orderAPI = `https://${SHOP}/admin/api/2024-01/orders.json?name=%23${orderId}&status=any`;
    const orderData = await fetchData(orderAPI);

    if (!orderData.orders || orderData.orders.length === 0) {
      return res.end(JSON.stringify({ message: "Order not found" }));
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
        return res.end(JSON.stringify({ message: "Order placed but not shipped yet" }));
      }

      const shipments = fulfilmentData.fulfillments.map(f => ({
        status: f.shipment_status,
        tracking_url: f.tracking_url
      }));

      return res.end(JSON.stringify({ shipments }));
    }

    // ======================
    // STEP 2: FETCH METAFIELD
    // ======================
    console.log("Calling Metafield API...");

    const metafieldAPI = `https://${SHOP}/admin/api/2024-01/orders/${order_id}/metafields.json?namespace=returnprime&key=lifecycle_data`;
    const metafieldData = await fetchData(metafieldAPI);

    if (!metafieldData.metafields || metafieldData.metafields.length === 0) {
      return res.end(JSON.stringify({ message: "No return/refund data found" }));
    }

    let parsedData = {};

    try {
      const rawValue = metafieldData.metafields[0].value;
      parsedData = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
    } catch (e) {
      console.log("Parse error:", e);
      return res.end(JSON.stringify({ message: "Error parsing metafield" }));
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

      return res.end(JSON.stringify({ returnData }));
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

      return res.end(JSON.stringify({ refundData }));
    }

    return res.end(JSON.stringify({ message: "Invalid action" }));

  } catch (err) {
    console.log("ERROR:", err);
    return res.end(JSON.stringify({ message: "Something went wrong" }));
  }

});

// ======================
// START SERVER
// ======================
server.listen(3000, '0.0.0.0', () => {
  console.log("🚀 Server running on port 3000");
});
