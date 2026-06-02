import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertCircle, Boxes, CheckCircle2, ClipboardList, PackagePlus, RefreshCw, Trash2, UserPlus, Users } from 'lucide-react';
import './styles.css';

const API_URL =
  import.meta.env.VITE_API_URL ||
  'https://inventory-manager-production-48e5.up.railway.app';

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(data.detail) ? data.detail.map((item) => item.msg).join(', ') : data.detail;
    throw new Error(detail || 'Request failed');
  }
  return data;
}

function App() {
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState({ total_products: 0, total_customers: 0, total_orders: 0, low_stock_products: 0 });
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [productForm, setProductForm] = useState({ id: null, name: '', sku: '', price: '', quantity_in_stock: '' });
  const [customerForm, setCustomerForm] = useState({ full_name: '', email: '', phone_number: '' });
  const [orderForm, setOrderForm] = useState({ customer_id: '', product_id: '', quantity: 1 });

  const lowStock = useMemo(() => {
  if (!Array.isArray(products)) return [];

  return products.filter(
    (product) => product.quantity_in_stock <= 5
  );
}, [products]);

async function loadData() {
  setLoading(true);

  try {
    const [productData, customerData, orderData, dashboardData] =
      await Promise.all([
        api('/products'),
        api('/customers'),
        api('/orders'),
        api('/dashboard'),
      ]);

    setProducts(Array.isArray(productData) ? productData : []);
    setCustomers(Array.isArray(customerData) ? customerData : []);
    setOrders(Array.isArray(orderData) ? orderData : []);
    setSummary(dashboardData || {});
  } catch (error) {
    flash(error.message, 'error');
  } finally {
    setLoading(false);
  }
}

  useEffect(() => {
    loadData();
  }, []);

  function flash(message, type = 'success') {
    setNotice({ message, type });
    window.setTimeout(() => setNotice(null), 4200);
  }

  async function submitProduct(event) {
    event.preventDefault();
    try {
      const payload = {
        name: productForm.name.trim(),
        sku: productForm.sku.trim(),
        price: Number(productForm.price),
        quantity_in_stock: Number(productForm.quantity_in_stock),
      };
      if (productForm.id) {
        await api(`/products/${productForm.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        flash('Product updated.');
      } else {
        await api('/products', { method: 'POST', body: JSON.stringify(payload) });
        flash('Product added.');
      }
      setProductForm({ id: null, name: '', sku: '', price: '', quantity_in_stock: '' });
      await loadData();
    } catch (error) {
      flash(error.message, 'error');
    }
  }

  async function submitCustomer(event) {
    event.preventDefault();
    try {
      await api('/customers', { method: 'POST', body: JSON.stringify(customerForm) });
      setCustomerForm({ full_name: '', email: '', phone_number: '' });
      flash('Customer added.');
      await loadData();
    } catch (error) {
      flash(error.message, 'error');
    }
  }

  async function submitOrder(event) {
    event.preventDefault();
    try {
      await api('/orders', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: Number(orderForm.customer_id),
          items: [{ product_id: Number(orderForm.product_id), quantity: Number(orderForm.quantity) }],
        }),
      });
      setOrderForm({ customer_id: '', product_id: '', quantity: 1 });
      flash('Order created and inventory updated.');
      await loadData();
    } catch (error) {
      flash(error.message, 'error');
    }
  }

  async function remove(path, success) {
    try {
      await api(path, { method: 'DELETE' });
      flash(success);
      await loadData();
    } catch (error) {
      flash(error.message, 'error');
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Operations Console</p>
          <h1>Inventory & Order Management</h1>
        </div>
        <button className="icon-button" onClick={loadData} title="Refresh data" aria-label="Refresh data">
          <RefreshCw size={18} className={loading ? 'spin' : ''} />
        </button>
      </header>

      {notice && (
        <div className={`notice ${notice.type}`}>
          {notice.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          <span>{notice.message}</span>
        </div>
      )}

      <section className="metrics">
        <Metric icon={<Boxes />} label="Products" value={summary.total_products} />
        <Metric icon={<Users />} label="Customers" value={summary.total_customers} />
        <Metric icon={<ClipboardList />} label="Orders" value={summary.total_orders} />
        <Metric icon={<AlertCircle />} label="Low Stock" value={summary.low_stock_products} />
      </section>

      <section className="workspace">
        <Panel title="Products" icon={<PackagePlus size={18} />}>
          <form className="form-grid" onSubmit={submitProduct}>
            <Input label="Product name" value={productForm.name} onChange={(name) => setProductForm({ ...productForm, name })} required />
            <Input label="SKU/code" value={productForm.sku} onChange={(sku) => setProductForm({ ...productForm, sku })} required />
            <Input label="Price" type="number" min="0.01" step="0.01" value={productForm.price} onChange={(price) => setProductForm({ ...productForm, price })} required />
            <Input label="Stock" type="number" min="0" value={productForm.quantity_in_stock} onChange={(quantity_in_stock) => setProductForm({ ...productForm, quantity_in_stock })} required />
            <button>{productForm.id ? 'Update Product' : 'Add Product'}</button>
          </form>
          <DataTable headers={['Name', 'SKU', 'Price', 'Stock', '']}>
            {products.map((product) => (
              <tr key={product.id}>
                <td>{product.name}</td>
                <td>{product.sku}</td>
                <td>{money(product.price)}</td>
                <td><span className={product.quantity_in_stock <= 5 ? 'status low' : 'status'}>{product.quantity_in_stock}</span></td>
                <td className="actions">
                  <button className="text-button" onClick={() => setProductForm(product)}>Edit</button>
                  <button className="icon-danger" onClick={() => remove(`/products/${product.id}`, 'Product deleted.')} title="Delete product" aria-label="Delete product">
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </DataTable>
        </Panel>

        <Panel title="Customers" icon={<UserPlus size={18} />}>
          <form className="form-grid" onSubmit={submitCustomer}>
            <Input label="Full name" value={customerForm.full_name} onChange={(full_name) => setCustomerForm({ ...customerForm, full_name })} required />
            <Input label="Email address" type="email" value={customerForm.email} onChange={(email) => setCustomerForm({ ...customerForm, email })} required />
            <Input label="Phone number" value={customerForm.phone_number} onChange={(phone_number) => setCustomerForm({ ...customerForm, phone_number })} required />
            <button>Add Customer</button>
          </form>
          <DataTable headers={['Name', 'Email', 'Phone', '']}>
            {customers.map((customer) => (
              <tr key={customer.id}>
                <td>{customer.full_name}</td>
                <td>{customer.email}</td>
                <td>{customer.phone_number}</td>
                <td className="actions">
                  <button className="icon-danger" onClick={() => remove(`/customers/${customer.id}`, 'Customer deleted.')} title="Delete customer" aria-label="Delete customer">
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </DataTable>
        </Panel>
      </section>

      <section className="workspace orders-area">
        <Panel title="Create Order" icon={<ClipboardList size={18} />}>
          <form className="form-grid" onSubmit={submitOrder}>
            <label>
              Customer
              <select value={orderForm.customer_id} onChange={(event) => setOrderForm({ ...orderForm, customer_id: event.target.value })} required>
                <option value="">Select customer</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.full_name}</option>)}
              </select>
            </label>
            <label>
              Product
              <select value={orderForm.product_id} onChange={(event) => setOrderForm({ ...orderForm, product_id: event.target.value })} required>
                <option value="">Select product</option>
                {products.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.quantity_in_stock} in stock)</option>)}
              </select>
            </label>
            <Input label="Quantity" type="number" min="1" value={orderForm.quantity} onChange={(quantity) => setOrderForm({ ...orderForm, quantity })} required />
            <button>Create Order</button>
          </form>
          {lowStock.length > 0 && <p className="hint">Low stock: {lowStock.map((product) => product.name).join(', ')}</p>}
        </Panel>

        <Panel title="Orders" icon={<ClipboardList size={18} />}>
          <div className="order-list">
            {orders.map((order) => (
              <article className="order-card" key={order.id}>
                <div>
                  <strong>Order #{order.id}</strong>
                  <span>{order.customer.full_name}</span>
                </div>
                <div>
                  <strong>{money(order.total_amount)}</strong>
                  <span>{new Date(order.created_at).toLocaleString()}</span>
                </div>
                <ul>
                  {order.items.map((item) => (
                    <li key={item.id}>{item.product.name} x {item.quantity} = {money(item.line_total)}</li>
                  ))}
                </ul>
                <button className="danger-button" onClick={() => remove(`/orders/${order.id}`, 'Order deleted.')}>Cancel Order</button>
              </article>
            ))}
          </div>
        </Panel>
      </section>
    </main>
  );
}

function Metric({ icon, label, value }) {
  return (
    <div className="metric">
      <span>{React.cloneElement(icon, { size: 20 })}</span>
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

function Panel({ title, icon, children }) {
  return (
    <section className="panel">
      <h2>{icon}{title}</h2>
      {children}
    </section>
  );
}

function Input({ label, value, onChange, ...props }) {
  return (
    <label>
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} {...props} />
    </label>
  );
}

function DataTable({ headers, children }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function money(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

createRoot(document.getElementById('root')).render(<App />);

