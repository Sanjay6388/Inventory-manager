require('dotenv').config();

const cors = require('cors');
const express = require('express');
const helmet = require('helmet');

const { initDb, pool, query, transaction } = require('./src/db');
const { HttpError, asyncHandler, handleError } = require('./src/errors');
const { customerSchema, idParam, orderSchema, productSchema } = require('./src/validators');

const app = express();
const port = Number(process.env.PORT || 8000);
const corsOrigins = (process.env.BACKEND_CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(helmet());
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    message: 'Inventory API Running',
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/products', asyncHandler(async (req, res) => {
  const product = productSchema.parse(req.body);
  const result = await query(
    `INSERT INTO products (name, sku, price, quantity_in_stock)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [product.name, product.sku, product.price, product.quantity_in_stock],
  );
  res.status(201).json(result.rows[0]);
}));

app.get('/products', asyncHandler(async (req, res) => {
  const result = await query('SELECT * FROM products ORDER BY id');
  res.json(result.rows);
}));

app.get('/products/:id', asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const product = await findOne('SELECT * FROM products WHERE id = $1', [id], 'Product not found');
  res.json(product);
}));

app.put('/products/:id', asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const product = productSchema.parse(req.body);
  const result = await query(
    `UPDATE products
     SET name = $1, sku = $2, price = $3, quantity_in_stock = $4
     WHERE id = $5
     RETURNING *`,
    [product.name, product.sku, product.price, product.quantity_in_stock, id],
  );
  if (!result.rowCount) throw new HttpError(404, 'Product not found');
  res.json(result.rows[0]);
}));

app.delete('/products/:id', asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const result = await query('DELETE FROM products WHERE id = $1', [id]);
  if (!result.rowCount) throw new HttpError(404, 'Product not found');
  res.status(204).send();
}));

app.post('/customers', asyncHandler(async (req, res) => {
  const customer = customerSchema.parse(req.body);
  const result = await query(
    `INSERT INTO customers (full_name, email, phone_number)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [customer.full_name, customer.email, customer.phone_number],
  );
  res.status(201).json(result.rows[0]);
}));

app.get('/customers', asyncHandler(async (req, res) => {
  const result = await query('SELECT * FROM customers ORDER BY id');
  res.json(result.rows);
}));

app.get('/customers/:id', asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const customer = await findOne('SELECT * FROM customers WHERE id = $1', [id], 'Customer not found');
  res.json(customer);
}));

app.delete('/customers/:id', asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const result = await query('DELETE FROM customers WHERE id = $1', [id]);
  if (!result.rowCount) throw new HttpError(404, 'Customer not found');
  res.status(204).send();
}));

app.post('/orders', asyncHandler(async (req, res) => {
  const payload = orderSchema.parse(req.body);
  const order = await transaction(async (client) => {
    const customer = await client.query('SELECT id FROM customers WHERE id = $1', [payload.customer_id]);
    if (!customer.rowCount) throw new HttpError(404, 'Customer not found');

    const requested = new Map();
    for (const item of payload.items) {
      requested.set(item.product_id, (requested.get(item.product_id) || 0) + item.quantity);
    }

    const productIds = [...requested.keys()];
    const productsResult = await client.query('SELECT * FROM products WHERE id = ANY($1::int[]) FOR UPDATE', [productIds]);
    const products = new Map(productsResult.rows.map((product) => [product.id, product]));

    for (const productId of productIds) {
      if (!products.has(productId)) throw new HttpError(404, `Product not found: ${productId}`);
      const product = products.get(productId);
      const quantity = requested.get(productId);
      if (Number(product.quantity_in_stock) < quantity) {
        throw new HttpError(400, `Insufficient inventory for ${product.name}. Available: ${product.quantity_in_stock}`);
      }
    }

    let total = 0;
    const orderResult = await client.query(
      'INSERT INTO orders (customer_id, total_amount) VALUES ($1, $2) RETURNING *',
      [payload.customer_id, 0],
    );
    const orderId = orderResult.rows[0].id;

    for (const [productId, quantity] of requested.entries()) {
      const product = products.get(productId);
      const unitPrice = Number(product.price);
      const lineTotal = unitPrice * quantity;
      total += lineTotal;

      await client.query('UPDATE products SET quantity_in_stock = quantity_in_stock - $1 WHERE id = $2', [quantity, productId]);
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, productId, quantity, unitPrice, lineTotal],
      );
    }

    await client.query('UPDATE orders SET total_amount = $1 WHERE id = $2', [total, orderId]);
    return orderId;
  });

  res.status(201).json(await getOrder(order));
}));

app.get('/orders', asyncHandler(async (req, res) => {
  const orders = await query('SELECT id FROM orders ORDER BY id DESC');
  const hydrated = await Promise.all(orders.rows.map((row) => getOrder(row.id)));
  res.json(hydrated);
}));

app.get('/orders/:id', asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await getOrder(id));
}));

app.delete('/orders/:id', asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  await transaction(async (client) => {
    const items = await client.query('SELECT product_id, quantity FROM order_items WHERE order_id = $1', [id]);
    if (!items.rowCount) {
      const order = await client.query('SELECT id FROM orders WHERE id = $1', [id]);
      if (!order.rowCount) throw new HttpError(404, 'Order not found');
    }
    for (const item of items.rows) {
      await client.query('UPDATE products SET quantity_in_stock = quantity_in_stock + $1 WHERE id = $2', [item.quantity, item.product_id]);
    }
    await client.query('DELETE FROM orders WHERE id = $1', [id]);
  });
  res.status(204).send();
}));

app.get('/dashboard', asyncHandler(async (req, res) => {
  const result = await query(`
    SELECT
      (SELECT COUNT(*)::int FROM products) AS total_products,
      (SELECT COUNT(*)::int FROM customers) AS total_customers,
      (SELECT COUNT(*)::int FROM orders) AS total_orders,
      (SELECT COUNT(*)::int FROM products WHERE quantity_in_stock <= 5) AS low_stock_products
  `);
  res.json(result.rows[0]);
}));

app.use(handleError);

async function findOne(sql, params, notFoundMessage) {
  const result = await query(sql, params);
  if (!result.rowCount) throw new HttpError(404, notFoundMessage);
  return result.rows[0];
}

async function getOrder(id) {
  const order = await findOne(
    `SELECT o.*, row_to_json(c.*) AS customer
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     WHERE o.id = $1`,
    [id],
    'Order not found',
  );
  const items = await query(
    `SELECT oi.*, row_to_json(p.*) AS product
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1
     ORDER BY oi.id`,
    [id],
  );
  return { ...order, items: items.rows };
}

initDb()
  .then(() => {
    app.listen(port, '0.0.0.0', () => {
      console.log(`Inventory API listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database', error);
    process.exit(1);
  });

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
