export function initProductsFeature({
  state,
  db,
  storage,
  collection,
  addDoc,
  onSnapshot,
  doc,
  getDoc,
  query,
  where,
  updateDoc,
  ref,
  uploadBytes,
  getDownloadURL,
  serverTimestamp,
  fmtNum,
  escHtml,
  toast,
  openModal,
  closeModal,
  setEl,
  canDo,
  logAudit,
  updateDashboardStats,
}) {
  function listenProducts() {
    const q = query(collection(db, 'products'), where('storeId', '==', state.currentStoreId));
    const unsub = onSnapshot(q, snapshot => {
      state.allProducts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      renderProducts();
      checkLowStock();
      updateDashboardStats();
    });
    state.unsubscribers.push(unsub);
  }

  function renderProducts() {
    const grid = document.getElementById('productGrid');
    if (!grid) return;

    if (state.allProducts.length === 0) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No products yet. Add your first one!</div>';
      return;
    }

    grid.innerHTML = state.allProducts.map(p => {
      const threshold = p.lowStockThreshold ?? 5;
      const stockClass = p.stock === 0 ? 'stock-out' : p.stock <= threshold ? 'stock-low' : 'stock-ok';
      const stockLabel = p.stock === 0 ? 'Out of stock' : p.stock <= threshold ? `Low: ${p.stock}` : `${p.stock} in stock`;
      const isLow = p.stock <= threshold && p.stock > 0;
      const canEdit = canDo('edit_product');

      return `
        <div class="product-card">
          ${isLow ? '<span class="low-stock-ribbon">Low Stock</span>' : ''}
          ${p.imageUrl
            ? `<img src="${escHtml(p.imageUrl)}" alt="${escHtml(p.name)}" loading="lazy">`
            : '<div class="product-no-img">📦</div>'
          }
          <div class="product-name" title="${escHtml(p.name)}">${escHtml(p.name)}</div>
          <div class="product-price">₱${fmtNum(p.price)}</div>
          <span class="stock-badge ${stockClass}">${stockLabel}</span>
          <div class="product-actions">
            ${canEdit ? `<button class="btn btn-outline btn-sm" onclick="openProductModal('${p.id}')">Edit</button>` : ''}
            <button class="btn btn-primary btn-sm" onclick="startSaleWithProduct('${p.id}')" ${p.stock === 0 ? 'disabled' : ''}>Sell</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function checkLowStock() {
    const threshold = p => p.lowStockThreshold ?? 5;
    const lowItems = state.allProducts.filter(p => p.stock > 0 && p.stock <= threshold(p));
    const outItems = state.allProducts.filter(p => p.stock === 0);
    const total = lowItems.length + outItems.length;

    const banner = document.getElementById('lowStockBanner');
    const alert = document.getElementById('lowStockAlert');
    const navBadge = document.getElementById('lowStockNavBadge');

    if (total > 0) {
      const parts = [];
      if (outItems.length) parts.push(`${outItems.length} out of stock`);
      if (lowItems.length) parts.push(`${lowItems.length} running low`);
      const msg = parts.join(', ');

      if (banner) {
        banner.style.display = 'flex';
        setEl('lowStockText', msg);
      }
      if (alert) {
        alert.style.display = 'block';
        alert.textContent = `⚠️ ${msg}`;
      }
      if (navBadge) navBadge.style.display = 'flex';
      return;
    }

    if (banner) banner.style.display = 'none';
    if (alert) alert.style.display = 'none';
    if (navBadge) navBadge.style.display = 'none';
  }

  window.openProductModal = function (productId = null) {
    if (!canDo('add_product')) return toast('You don\'t have permission to do this', 'error');
    const p = productId ? state.allProducts.find(x => x.id === productId) : null;

    openModal(`
      <div class="modal-title">${p ? 'Edit Product' : 'Add Product'}</div>
      <div class="form-group">
        <label class="form-label">Product name</label>
        <input type="text" id="pName" value="${p ? escHtml(p.name) : ''}" placeholder="e.g. Coke 1.5L" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="form-label">Price (₱)</label>
        <input type="number" id="pPrice" value="${p ? p.price : ''}" placeholder="0.00" min="0" step="0.01">
      </div>
      <div class="form-group">
        <label class="form-label">Stock quantity</label>
        <input type="number" id="pStock" value="${p ? p.stock : '0'}" placeholder="0" min="0">
      </div>
      <div class="form-group">
        <label class="form-label">Low stock alert threshold</label>
        <input type="number" id="pThreshold" value="${p ? (p.lowStockThreshold ?? 5) : '5'}" placeholder="5" min="0">
      </div>
      <div class="form-group">
        <label class="form-label">Photo (optional)</label>
        <input type="file" id="pImage" accept="image/*">
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveProduct('${productId || ''}')">Save product</button>
      </div>
    `);
  };

  window.saveProduct = async function (productId) {
    const name = document.getElementById('pName').value.trim();
    const price = parseFloat(document.getElementById('pPrice').value);
    const stock = parseInt(document.getElementById('pStock').value, 10) || 0;
    const threshold = parseInt(document.getElementById('pThreshold').value, 10) ?? 5;
    const file = document.getElementById('pImage').files[0];

    if (!name || isNaN(price) || price < 0) return toast('Name and a valid price are required', 'error');

    let imageUrl = productId ? (state.allProducts.find(p => p.id === productId)?.imageUrl || '') : '';
    if (file) {
      try {
        const storageRef = ref(storage, `products/${state.currentStoreId}/${Date.now()}_${file.name}`);
        await uploadBytes(storageRef, file);
        imageUrl = await getDownloadURL(storageRef);
      } catch {
        toast('Image upload failed, saving without image', 'warning');
      }
    }

    const data = { name, price, stock, lowStockThreshold: threshold, imageUrl, storeId: state.currentStoreId };

    try {
      if (productId) {
        await updateDoc(doc(db, 'products', productId), data);
        await logAudit('edit_product', `Edited product: ${name}`);
        toast('Product updated', 'success');
      } else {
        await addDoc(collection(db, 'products'), { ...data, createdAt: serverTimestamp() });
        await logAudit('add_product', `Added product: ${name} at ₱${fmtNum(price)}`);
        toast('Product added!', 'success');
      }
      closeModal();
    } catch (e) {
      toast(`Error saving product: ${e.message}`, 'error');
    }
  };

  return {
    listenProducts,
    renderProducts,
    checkLowStock,
  };
}
