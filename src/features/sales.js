export function initSalesFeature({
  state,
  db,
  collection,
  addDoc,
  onSnapshot,
  doc,
  getDoc,
  query,
  where,
  updateDoc,
  serverTimestamp,
  fmtNum,
  escHtml,
  csvEscape,
  formatDateForFile,
  toast,
  openModal,
  closeModal,
  canDo,
  logAudit,
  updateDashboardStats,
}) {
  function filterSalesByPeriod(sales, period) {
    const now = new Date();
    return sales.filter(s => {
      if (!s.date?.seconds) return false;
      const d = new Date(s.date.seconds * 1000);
      if (period === 'today') return d.toDateString() === now.toDateString();
      if (period === 'week') {
        const weekAgo = new Date(now);
        weekAgo.setDate(now.getDate() - 7);
        return d >= weekAgo;
      }
      if (period === 'month') {
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }
      return true;
    });
  }

  function getFilteredSales() {
    return filterSalesByPeriod(state.allSales, state.salesFilter);
  }

  function renderSales() {
    const list = document.getElementById('salesList');
    const chip = document.getElementById('salesTotalChip');
    if (!list) return;

    const filtered = getFilteredSales();
    const total = filtered.reduce((sum, sale) => sum + (sale.total || 0), 0);

    if (chip) chip.textContent = `₱${fmtNum(total)} · ${filtered.length} sale${filtered.length !== 1 ? 's' : ''}`;

    if (filtered.length === 0) {
      list.innerHTML = '<div class="empty-state">No sales for this period.</div>';
      return;
    }

    list.innerHTML = filtered.map(s => {
      const date = s.date?.seconds ? new Date(s.date.seconds * 1000) : new Date();
      const items = (s.items || []).map(i => `${escHtml(i.name)} ×${i.qty}`).join(', ');
      const isUtang = s.paymentMethod === 'utang';

      return `
        <div class="item-card">
          <div class="item-card-header">
            <div style="flex:1">
              <div class="item-card-title">${items || 'Sale'}</div>
              <div class="item-card-sub">
                ${date.toLocaleString('en-PH', { dateStyle: 'short', timeStyle: 'short' })}
                · by ${escHtml(s.recordedByName || 'Unknown')}
                ${isUtang ? `· <span style="color:var(--warning);font-weight:700">Utang — ${escHtml(s.customerName)}</span>` : ''}
              </div>
            </div>
            <div style="text-align:right">
              <div class="item-card-amount">₱${fmtNum(s.total || 0)}</div>
              ${isUtang
                ? '<span style="font-size:11px;background:var(--warning-light);color:#92400e;padding:2px 7px;border-radius:999px;font-weight:700">UTANG</span>'
                : '<span style="font-size:11px;background:var(--success-light);color:#15803d;padding:2px 7px;border-radius:999px;font-weight:700">PAID</span>'
              }
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function listenSales() {
    const q = query(collection(db, 'sales'), where('storeId', '==', state.currentStoreId));
    const unsub = onSnapshot(q, snapshot => {
      state.allSales = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
      renderSales();
      updateDashboardStats();
    });
    state.unsubscribers.push(unsub);
  }

  function openProductPickerModal() {
    const items = state.allProducts.length === 0
      ? '<div style="padding:16px;text-align:center;color:var(--text-muted)">No products in catalog yet.</div>'
      : state.allProducts.map(p => {
          const inCart = state.cart.find(c => c.productId === p.id);
          const inCartQty = inCart ? inCart.qty : 0;
          const disabled = p.stock === 0;
          return `
            <div class="picker-item ${disabled ? 'disabled' : ''}" onclick="${!disabled ? `addToCart('${p.id}')` : ''}">
              <div>
                <div class="picker-item-name">${escHtml(p.name)}</div>
                <div class="picker-item-meta">₱${fmtNum(p.price)} · ${disabled ? 'Out of stock' : `${p.stock} left`}</div>
              </div>
              ${inCartQty > 0 ? `<span style="background:var(--primary-light);color:var(--primary-dark);font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px">${inCartQty} in cart</span>` : ''}
              ${disabled ? '' : '<span style="color:var(--primary);font-size:20px;font-weight:300">+</span>'}
            </div>
          `;
        }).join('');

    openModal(`
      <div class="modal-title">New Sale — Pick Products</div>
      <div class="form-group" style="margin-bottom:10px">
        <input type="text" id="productSearch" placeholder="Search products..." oninput="filterProductSearch(this.value)" autocomplete="off">
      </div>
      <div class="product-picker-list" id="productPickerList">${items}</div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="cancelSaleFlow()">Cancel</button>
        <button class="btn btn-primary" id="viewCartBtn" onclick="openCartModal()" ${state.cart.length === 0 ? 'disabled' : ''}>
          Review Cart ${state.cart.length > 0 ? `(${state.cart.length})` : ''}
        </button>
      </div>
    `);
  }

  function openCartModal() {
    if (state.cart.length === 0) return openProductPickerModal();

    const cartTotal = state.cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    const cartRows = state.cart.map((item, idx) => `
      <div class="cart-item">
        <div style="flex:1">
          <div class="cart-item-name">${escHtml(item.name)}</div>
          <div class="cart-item-price">₱${fmtNum(item.price)} each</div>
        </div>
        <div class="cart-qty-controls">
          <button class="qty-btn" onclick="changeQty(${idx}, -1)">−</button>
          <span class="qty-display">${item.qty}</span>
          <button class="qty-btn" onclick="changeQty(${idx}, 1)">+</button>
        </div>
        <div class="cart-item-subtotal">₱${fmtNum(item.price * item.qty)}</div>
      </div>
    `).join('');

    const utangOptions = state.allUtang
      .filter(u => u.remaining > 0)
      .map(u => `<option value="${u.id}">${escHtml(u.customerName)} (₱${fmtNum(u.remaining)} remaining)</option>`)
      .join('');

    openModal(`
      <div class="modal-title">Checkout</div>
      <div class="cart-items">${cartRows}</div>
      <div class="cart-total-row">
        <span>Total</span>
        <span>₱${fmtNum(cartTotal)}</span>
      </div>
      <div class="form-group">
        <label class="form-label">Payment method</label>
        <select id="paymentMethod" onchange="toggleUtangSection()">
          <option value="cash">Cash</option>
          <option value="utang">Utang (Credit)</option>
        </select>
      </div>
      <div id="utangSection" style="display:none">
        <div class="form-group">
          <label class="form-label">Existing customer</label>
          <select id="utangCustomerSelect">
            <option value="">— Select existing customer —</option>
            ${utangOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Or enter new customer name</label>
          <input type="text" id="newUtangCustomerName" placeholder="Customer name" autocomplete="off">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="openProductPickerModal()">← Add more</button>
        <button class="btn btn-primary" onclick="confirmSale()">Confirm Sale</button>
      </div>
    `);
  }

  window.filterSales = function (period, btn) {
    state.salesFilter = period;
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderSales();
  };

  window.exportSalesCsv = function () {
    const filtered = getFilteredSales();
    if (filtered.length === 0) return toast('No sales to export for this filter', 'warning');

    const rows = filtered.map(sale => {
      const date = sale.date?.seconds ? new Date(sale.date.seconds * 1000) : null;
      const items = (sale.items || []).map(item => `${item.name} x${item.qty} @ ${item.price}`).join(' | ');
      const quantity = (sale.items || []).reduce((sum, item) => sum + (item.qty || 0), 0);
      return [
        date ? date.toLocaleString('en-PH', { dateStyle: 'short', timeStyle: 'short' }) : '',
        sale.id || '',
        sale.paymentMethod || 'cash',
        sale.customerName || '',
        sale.recordedByName || '',
        quantity,
        sale.total || 0,
        items
      ];
    });

    const header = ['Date', 'Sale ID', 'Payment Method', 'Customer', 'Recorded By', 'Item Qty', 'Total', 'Items'];
    const csv = [header, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sales-${state.salesFilter}-${formatDateForFile(new Date())}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    toast(`Exported ${filtered.length} sale${filtered.length !== 1 ? 's' : ''}`, 'success');
  };

  window.openSaleModal = function () {
    if (!canDo('record_sale')) return toast('You don\'t have permission to record sales', 'error');
    state.cart = [];
    openProductPickerModal();
  };

  window.startSaleWithProduct = function (productId) {
    if (!canDo('record_sale')) return toast('You don\'t have permission', 'error');
    const p = state.allProducts.find(x => x.id === productId);
    if (!p || p.stock === 0) return toast('Product is out of stock', 'error');
    state.cart = [{ productId: p.id, name: p.name, price: p.price, qty: 1, maxStock: p.stock }];
    openCartModal();
  };

  window.filterProductSearch = function (q) {
    const term = q.toLowerCase();
    const filtered = state.allProducts.filter(p => p.name.toLowerCase().includes(term));
    document.getElementById('productPickerList').innerHTML = filtered.map(p => {
      const inCart = state.cart.find(c => c.productId === p.id);
      const inCartQty = inCart ? inCart.qty : 0;
      const disabled = p.stock === 0;
      return `
        <div class="picker-item ${disabled ? 'disabled' : ''}" onclick="${!disabled ? `addToCart('${p.id}')` : ''}">
          <div>
            <div class="picker-item-name">${escHtml(p.name)}</div>
            <div class="picker-item-meta">₱${fmtNum(p.price)} · ${disabled ? 'Out of stock' : `${p.stock} left`}</div>
          </div>
          ${inCartQty > 0 ? `<span style="background:var(--primary-light);color:var(--primary-dark);font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px">${inCartQty} in cart</span>` : ''}
          ${disabled ? '' : '<span style="color:var(--primary);font-size:20px;font-weight:300">+</span>'}
        </div>
      `;
    }).join('');
  };

  window.addToCart = function (productId) {
    const p = state.allProducts.find(x => x.id === productId);
    if (!p) return;

    const existing = state.cart.find(c => c.productId === productId);
    if (existing) {
      if (existing.qty >= p.stock) return toast('Not enough stock!', 'error');
      existing.qty += 1;
    } else {
      state.cart.push({ productId: p.id, name: p.name, price: p.price, qty: 1, maxStock: p.stock });
    }

    toast(`${p.name} added`, 'success');
    openProductPickerModal();
  };

  window.openCartModal = openCartModal;
  window.openProductPickerModal = openProductPickerModal;

  window.cancelSaleFlow = function () {
    state.cart = [];
    closeModal();
  };

  window.toggleUtangSection = function () {
    const method = document.getElementById('paymentMethod').value;
    const section = document.getElementById('utangSection');
    if (section) section.style.display = method === 'utang' ? 'block' : 'none';
  };

  window.changeQty = function (idx, delta) {
    if (!state.cart[idx]) return;
    const item = state.cart[idx];
    item.qty += delta;
    if (item.qty <= 0) state.cart.splice(idx, 1);
    else if (item.qty > item.maxStock) {
      item.qty = item.maxStock;
      toast('Max stock reached', 'warning');
    }
    if (state.cart.length === 0) {
      closeModal();
      return;
    }
    openCartModal();
  };

  window.confirmSale = async function () {
    if (state.cart.length === 0) return toast('Cart is empty', 'error');
    if (!canDo('record_sale')) return toast('No permission', 'error');

    const paymentMethod = document.getElementById('paymentMethod')?.value || 'cash';
    let customerName = '';
    let customerId = '';

    if (paymentMethod === 'utang') {
      const existingId = document.getElementById('utangCustomerSelect')?.value || '';
      const newName = document.getElementById('newUtangCustomerName')?.value.trim() || '';
      if (!existingId && !newName) return toast('Please specify a customer for utang', 'error');
      if (existingId) {
        customerId = existingId;
        customerName = state.allUtang.find(u => u.id === existingId)?.customerName || '';
      } else {
        customerName = newName;
      }
    }

    const total = state.cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    const saleData = {
      storeId: state.currentStoreId,
      items: state.cart.map(i => ({ productId: i.productId, name: i.name, price: i.price, qty: i.qty })),
      total,
      paymentMethod,
      customerName,
      customerId,
      recordedBy: state.currentUser.uid,
      recordedByName: state.currentUser.displayName || state.currentUser.email,
      date: serverTimestamp()
    };

    try {
      await addDoc(collection(db, 'sales'), saleData);

      for (const item of state.cart) {
        const productRef = doc(db, 'products', item.productId);
        const productSnap = await getDoc(productRef);
        if (productSnap.exists()) {
          const newStock = Math.max(0, productSnap.data().stock - item.qty);
          await updateDoc(productRef, { stock: newStock });
        }
      }

      if (paymentMethod === 'utang') {
        if (customerId) {
          const utangRef = doc(db, 'utang', customerId);
          const utangSnap = await getDoc(utangRef);
          if (utangSnap.exists()) {
            const data = utangSnap.data();
            await updateDoc(utangRef, {
              totalDebt: data.totalDebt + total,
              remaining: data.remaining + total
            });
          }
        } else {
          await addDoc(collection(db, 'utang'), {
            storeId: state.currentStoreId,
            customerName,
            totalDebt: total,
            totalPaid: 0,
            remaining: total,
            payments: [],
            createdAt: serverTimestamp()
          });
        }
      }

      await logAudit(
        'sale',
        `Sale of ₱${fmtNum(total)} — ${state.cart.map(i => `${i.name} ×${i.qty}`).join(', ')}${paymentMethod === 'utang' ? ` (utang: ${customerName})` : ''}`
      );

      state.cart = [];
      closeModal();
      toast('Sale recorded! 💰', 'success');
    } catch (e) {
      toast(`Error recording sale: ${e.message}`, 'error');
    }
  };

  return {
    listenSales,
    renderSales,
    filterSalesByPeriod,
  };
}
