const { z } = require('zod');

const idParam = z.object({
  id: z.coerce.number().int().positive(),
});

const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().min(1).max(80),
  price: z.coerce.number().positive(),
  quantity_in_stock: z.coerce.number().int().min(0),
});

const customerSchema = z.object({
  full_name: z.string().trim().min(1).max(140),
  email: z.string().trim().email().max(180),
  phone_number: z.string().trim().min(3).max(40),
});

const orderSchema = z.object({
  customer_id: z.coerce.number().int().positive(),
  items: z.array(z.object({
    product_id: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().positive(),
  })).min(1),
});

module.exports = { customerSchema, idParam, orderSchema, productSchema };

