export default async function handler(req, res) {
  const { orderId } = req.query;

  if (!orderId) {
    return res.status(400).json({ message: "Order ID is required" });
  }

  const SHOP = "libasdelhi.myshopify.com";
  const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

  try {
    // Step 1: Fetch Order
   const orderRes = await fetch(
  `https://${SHOP}/admin/api/2024-01/orders.json?name=%23${orderId}&status=any`,
      {
        headers: {
          "X-Shopify-Access-Token": ACCESS_TOKEN,
        },
      }
    );

    const orderData = await orderRes.json();

    if (!orderData.orders || orderData.orders.length === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    const order = orderData.orders[0];
    const order_id = order.id;

    // Step 2: Fetch Fulfilments
    const fulfilmentRes = await fetch(
      `https://${SHOP}/admin/api/2024-01/orders/${order_id}/fulfillments.json`,
      {
        headers: {
          "X-Shopify-Access-Token": ACCESS_TOKEN,
        },
      }
    );

    const fulfilmentData = await fulfilmentRes.json();

    if (!fulfilmentData.fulfillments || fulfilmentData.fulfillments.length === 0) {
      return res.status(200).json({
        message: "Your order has been placed but not shipped yet",
      });
    }

    const shipments = fulfilmentData.fulfillments.map(f => ({
      status: f.shipment_status,
      tracking_url: f.tracking_url,
    }));

    return res.status(200).json({ shipments });

  } catch (error) {
    return res.status(500).json({ message: "Something went wrong" });
  }
}
