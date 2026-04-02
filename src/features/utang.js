export function initUtangFeature({
  state,
  db,
  collection,
  addDoc,
  onSnapshot,
  doc,
  query,
  where,
  updateDoc,
  serverTimestamp,
  fmtNum,
  escHtml,
  toast,
  openModal,
  closeModal,
  canDo,
  logAudit,
  updateDashboardStats,
}) {
  function listenUtang() {
    const q = query(collection(db, 'utang'), where('storeId', '==', state.currentStoreId));
    const unsub = onSnapshot(q, snapshot => {
      state.allUtang = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      renderUtang();
      updateDashboardStats();
    });
    state.unsubscribers.push(unsub);
  }

  function renderUtang() {
    const list = document.getElementById('utangList');
    if (!list) return;

    if (state.allUtang.length === 0) {
      list.innerHTML = '<div class="empty-state">No utang records. Great news!</div>';
      return;
    }

    const sorted = [...state.allUtang].sort((a, b) => (b.remaining || 0) - (a.remaining || 0));
    list.innerHTML = sorted.map(u => {
      const paid = (u.remaining || 0) <= 0;
      const percent = u.totalDebt > 0 ? Math.min(100, Math.round((u.totalPaid / u.totalDebt) * 100)) : 100;

      return `
        <div class="item-card">
          <div class="item-card-header">
            <div>
              <div class="item-card-title">${escHtml(u.customerName)} ${paid ? '✅' : ''}</div>
              <div class="item-card-sub">Total debt: ₱${fmtNum(u.totalDebt)}</div>
            </div>
            <div style="text-align:right">
              <div class="item-card-amount" style="color:${paid ? 'var(--success)' : 'var(--danger)'}">
                ₱${fmtNum(u.remaining || 0)}
              </div>
              <div class="item-card-sub">remaining</div>
            </div>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width:${percent}%;background:${paid ? 'var(--success)' : 'var(--primary)'}"></div>
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">
            Paid: ₱${fmtNum(u.totalPaid || 0)} (${percent}%)
          </div>
          <div class="item-card-actions">
            ${!paid ? `<button class="btn btn-success btn-sm" onclick="openPayUtangModal('${u.id}')">Record Payment</button>` : ''}
            <button class="btn btn-outline btn-sm" onclick="viewPaymentHistory('${u.id}')">History (${(u.payments || []).length})</button>
          </div>
        </div>
      `;
    }).join('');
  }

  window.openUtangModal = function () {
    if (!canDo('add_utang')) return toast('You don\'t have permission', 'error');
    openModal(`
      <div class="modal-title">Add Utang Record</div>
      <div class="form-group">
        <label class="form-label">Customer name</label>
        <input type="text" id="utangName" placeholder="Customer name" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="form-label">Amount (₱)</label>
        <input type="number" id="utangAmount" placeholder="0.00" min="0" step="0.01">
      </div>
      <div class="form-group">
        <label class="form-label">Note (optional)</label>
        <input type="text" id="utangNote" placeholder="e.g. 1 bag rice + 2 coke" autocomplete="off">
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="addUtang()">Add record</button>
      </div>
    `);
  };

  window.addUtang = async function () {
    const name = document.getElementById('utangName').value.trim();
    const amount = parseFloat(document.getElementById('utangAmount').value);
    const note = document.getElementById('utangNote')?.value.trim() || '';

    if (!name) return toast('Enter a customer name', 'error');
    if (isNaN(amount) || amount <= 0) return toast('Enter a valid amount', 'error');

    try {
      await addDoc(collection(db, 'utang'), {
        storeId: state.currentStoreId,
        customerName: name,
        totalDebt: amount,
        totalPaid: 0,
        remaining: amount,
        note,
        payments: [],
        createdAt: serverTimestamp()
      });
      await logAudit('add_utang', `Added utang for ${name}: ₱${fmtNum(amount)}${note ? ` (${note})` : ''}`);
      toast('Utang recorded!', 'success');
      closeModal();
    } catch (e) {
      toast(`Error: ${e.message}`, 'error');
    }
  };

  window.openPayUtangModal = function (utangId) {
    if (!canDo('pay_utang')) return toast('No permission', 'error');
    const u = state.allUtang.find(x => x.id === utangId);
    if (!u) return;

    openModal(`
      <div class="modal-title">Record Payment</div>
      <div style="background:var(--surface-2);border-radius:var(--radius);padding:14px;margin-bottom:16px">
        <div style="font-weight:700;font-size:16px;margin-bottom:4px">${escHtml(u.customerName)}</div>
        <div style="font-size:13px;color:var(--text-muted)">
          Total debt: ₱${fmtNum(u.totalDebt)} · Remaining: <strong style="color:var(--danger)">₱${fmtNum(u.remaining)}</strong>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Payment amount (₱)</label>
        <input type="number" id="payAmount" placeholder="0.00" min="0" max="${u.remaining}" step="0.01">
      </div>
      <button class="btn btn-outline btn-sm" onclick="document.getElementById('payAmount').value=${u.remaining}" style="margin-bottom:4px">
        Pay full amount (₱${fmtNum(u.remaining)})
      </button>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-success" onclick="recordPayment('${utangId}')">Record payment</button>
      </div>
    `);
  };

  window.recordPayment = async function (utangId) {
    const amount = parseFloat(document.getElementById('payAmount').value);
    if (isNaN(amount) || amount <= 0) return toast('Enter a valid amount', 'error');

    const u = state.allUtang.find(x => x.id === utangId);
    if (!u) return;
    if (amount > u.remaining + 0.01) return toast('Payment exceeds remaining balance', 'error');

    const newPaid = (u.totalPaid || 0) + amount;
    const newRemaining = Math.max(0, u.totalDebt - newPaid);
    const paymentEntry = {
      amount,
      date: new Date().toISOString(),
      recordedBy: state.currentUser.displayName || state.currentUser.email
    };

    try {
      await updateDoc(doc(db, 'utang', utangId), {
        totalPaid: newPaid,
        remaining: newRemaining,
        payments: [...(u.payments || []), paymentEntry]
      });
      await logAudit('payment', `Payment of ₱${fmtNum(amount)} from ${u.customerName}`);
      toast('Payment recorded! ✅', 'success');
      closeModal();
    } catch (e) {
      toast(`Error: ${e.message}`, 'error');
    }
  };

  window.viewPaymentHistory = function (utangId) {
    const u = state.allUtang.find(x => x.id === utangId);
    if (!u) return;

    const payments = [...(u.payments || [])].reverse();
    const historyHtml = payments.length === 0
      ? '<p style="color:var(--text-muted);font-size:13px;padding:8px 0">No payments yet.</p>'
      : `<div class="payment-history">
          ${payments.map(p => `
            <div class="payment-row">
              <div>
                <div style="font-size:13px;font-weight:600">${new Date(p.date).toLocaleDateString('en-PH')}</div>
                <div style="font-size:11px;color:var(--text-muted)">${escHtml(p.recordedBy)}</div>
              </div>
              <div class="payment-amount">+₱${fmtNum(p.amount)}</div>
            </div>
          `).join('')}
         </div>`;

    openModal(`
      <div class="modal-title">Payment History</div>
      <div style="background:var(--surface-2);border-radius:var(--radius);padding:14px;margin-bottom:16px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center">
        <div>
          <div style="font-size:11px;color:var(--text-muted);font-weight:700;text-transform:uppercase">Total</div>
          <div style="font-size:16px;font-weight:800">₱${fmtNum(u.totalDebt)}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-muted);font-weight:700;text-transform:uppercase">Paid</div>
          <div style="font-size:16px;font-weight:800;color:var(--success)">₱${fmtNum(u.totalPaid)}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-muted);font-weight:700;text-transform:uppercase">Remaining</div>
          <div style="font-size:16px;font-weight:800;color:var(--danger)">₱${fmtNum(u.remaining)}</div>
        </div>
      </div>
      <div style="font-weight:700;font-size:14px;margin-bottom:10px">${escHtml(u.customerName)}</div>
      ${historyHtml}
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal()">Close</button>
      </div>
    `);
  };

  return {
    listenUtang,
    renderUtang,
  };
}
