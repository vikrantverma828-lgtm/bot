const http = require('http');
const https = require('https');

const SHOP = 'libasdelhi.myshopify.com';
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// ======================
// SAFE FETCH WITH TIMEOUT
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

      res.on('data', chunk => data += chunk);

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (err) {
          console.log("JSON Parse Error:", data);
          reject("Invalid JSON response");
        }
      });
    });

    req.on('error', (err) => {
      console.log("HTTP Error:", err);
      reject(err);
    });

    req.setTimeout(5000, () => {
      req.destroy();
      reject("Request Timeout");
    });

  });
}

// ======================
// SERVER
// ======================
const server = http.createServer(async (req, res) => {

  res.setHeader('Content-Type', 'application/json');

  if (req.url.startsWith('/support')) {
  console.log("Request received");

  return res.end(JSON.stringify({
    message: "Server working fine"
  }));
}

    try {
      // ======================
      // STEP 1: FETCH ORDER
      // ======================
      console.log("Calling Order API...");

      const orderAPI = `https://${SHOP}/admin/api/2024-01/orders.json?name=%23${orderId}&status=any`;
      const orderData = await fetchData(orderAPI);

      console.log("Order API Response Received");

      if (!orderData.orders || orderData.orders.length === 0) {
        return res.end(JSON.stringify({ message: "Order not found" }));
      }

      const order = orderData.orders[0];
      const order_id = order.id;

      // ======================
      // CASE 1: ORDER STATUS
      // ======================
      if (action === "order") {

        console.log("Calling Fulfillment API...");

        const fulfilmentAPI = `https://${SHOP}/admin/api/2024-01/orders/${order_id}/fulfillments.json`;
        const fulfilmentData = await fetchData(fulfilmentAPI);

        console.log("Fulfillment API Response Received");

        if (!fulfilmentData.fulfillments || fulfilmentData.fulfillments.length === 0) {
          return res.end(JSON.stringify({
            message: "Order placed but not shipped yet"
          }));
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

      console.log("Metafield API Response Received");

      if (!metafieldData.metafields || metafieldData.metafields.length === 0) {
        return res.end(JSON.stringify({ message: "No return/refund data found" }));
      }

      // ======================
      // SAFE PARSE
      // ======================
      let parsedData = {};

      try {
        const rawValue = metafieldData.metafields[0].value;
        parsedData = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
      } catch (e) {
        console.log("Metafield Parse Error:", e);
        return res.end(JSON.stringify({ message: "Error parsing return data" }));
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

  } else {
    res.end("API running");
  }

});

// ======================
// START SERVER
// ======================
server.listen(3000, '0.0.0.0', () => {
  console.log("Server running on port 3000");
});
