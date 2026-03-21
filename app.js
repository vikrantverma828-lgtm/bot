const http = require('http');
const https = require('https');

const SHOP = 'libasdelhi.myshopify.com';
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

function fetchData(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'X-Shopify-Access-Token': ACCESS_TOKEN
      }
    };

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {

  res.setHeader('Content-Type', 'application/json');

  if (req.url.startsWith('/support')) {

    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const orderId = urlObj.searchParams.get('orderId');
    const action = urlObj.searchParams.get('action');

    if (!orderId || !action) {
      return res.end(JSON.stringify({ message: "Missing orderId or action" }));
    }

    try {
      // ======================
      // STEP 1: FETCH ORDER
      // ======================
      const orderAPI = `https://${SHOP}/admin/api/2024-01/orders.json?name=%23${orderId}&status=any`;
      const orderData = await fetchData(orderAPI);

      if (!orderData.orders || orderData.orders.length === 0) {
        return res.end(JSON.stringify({ message: "Order not found" }));
      }

      const order = orderData.orders[0];
      const order_id = order.id;

      // ======================
      // CASE 1: ORDER STATUS
      // ======================
      if (action === "order") {

        const fulfilmentAPI = `https://${SHOP}/admin/api/2024-01/orders/${order_id}/fulfillments.json`;
        const fulfilmentData = await fetchData(fulfilmentAPI);

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
      // STEP 2: FETCH METAFIELD (COMMON FOR RETURN & REFUND)
      // ======================
      const metafieldAPI = `https://${SHOP}/admin/api/2024-01/orders/${order_id}/metafields.json?namespace=returnprime&key=lifecycle_data`;
      const metafieldData = await fetchData(metafieldAPI);

      if (!metafieldData.metafields || metafieldData.metafields.length === 0) {
        return res.end(JSON.stringify({ message: "No return/refund data found" }));
      }

      // Parse JSON string
      const rawValue = metafieldData.metafields[0].value;
      const parsedData = JSON.parse(rawValue);

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
      console.error(err);
      return res.end(JSON.stringify({ message: "Error processing request" }));
    }

  } else {
    res.end("API running");
  }

});

server.listen(3000, '0.0.0.0', () => {
  console.log("Server running on port 3000");
});
