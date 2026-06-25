import { formatCurrency, normalizeText, sanitizeFiniteNumber, sanitizeInteger, sanitizeDateISO, escapeHtml } from './utils.js';

/**
 * Render the Savings page with toggleable Emergency Fund and Sinking Funds sections
 */
export function renderSavingsPage(app) {
  const section = document.getElementById('savingsSection');
  if (!section) return;

  const currentSubTab = app.savingsSubTab || 'emergency';

  let html = `
    <div class="page-header-row">
      <h2>💰 Savings</h2>
      <button type="button" class="page-print-btn" id="savingsPrintBtn" title="Print this page" aria-label="Print the Savings page">🖨️ Print</button>
    </div>
    <div class="savings-container">
      <div class="savings-subtabs">
        <button class="savings-subtab-btn ${currentSubTab === 'emergency' ? 'active' : ''}" data-savings-subtab="emergency">🏦 Emergency Fund</button>
        <button class="savings-subtab-btn ${currentSubTab === 'sinking' ? 'active' : ''}" data-savings-subtab="sinking">🎯 Sinking Funds</button>
      </div>

      <div class="savings-content">
  `;

  if (currentSubTab === 'emergency') {
    html += renderEmergencyFundContent(app);
  } else {
    html += renderSinkingFundsContent(app);
  }

  html += `
      </div>
    </div>
  `;

  section.innerHTML = html;
  section.querySelectorAll('[data-progress-width]').forEach(el =>
    el.style.setProperty('--progress-width', el.dataset.progressWidth + '%'));
}

function renderEmergencyFundContent(app) {
  let html = `
    <div class="savings-section emergency-fund-section">
      <h2>Emergency Fund</h2>
      <p class="section-description">Track your emergency fund target and progress for each account.</p>

      <div class="emergency-form-card">
        <button class="emergency-form-toggle" id="emergencyFormToggle">➕ Add/Edit Emergency Fund</button>
        <div class="emergency-form-body hidden" id="emergencyFormBody">
          <form id="emergencyForm">
            <div class="emergency-form-grid">
              <div class="form-group">
                <label for="emergencyAccount">Account</label>
                <select id="emergencyAccount" required>
                  <option value="">-- Select Account --</option>
                  ${app.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label for="emergencyTarget">Target Amount ($)</label>
                <input type="number" id="emergencyTarget" min="0" step="0.01" placeholder="5000" required />
              </div>
              <div class="form-group">
                <label for="emergencyCurrent">Current Amount ($)</label>
                <input type="number" id="emergencyCurrent" min="0" step="0.01" placeholder="0" required />
              </div>
              <div class="form-group">
                <label for="emergencyContribution">Monthly Contribution ($)</label>
                <input type="number" id="emergencyContribution" min="0" step="0.01" placeholder="250" required />
              </div>
              <div class="form-group">
                <label for="emergencyAuto">
                  <input type="checkbox" id="emergencyAuto" />
                  Auto-contribute monthly
                </label>
              </div>
              <div class="form-group">
                <label for="emergencyNotes">Notes</label>
                <textarea id="emergencyNotes" placeholder="e.g., 3-6 months of expenses"></textarea>
              </div>
            </div>
            <div class="emergency-form-actions">
              <button type="submit" class="btn btn-primary" id="emergencyFormSubmit">Save Emergency Fund</button>
              <button type="button" class="btn btn-secondary" id="emergencyCancelBtn">Cancel</button>
            </div>
          </form>
        </div>
      </div>

      <div class="emergency-list" id="emergencyList">
  `;

  // Sort by account for better organization
  const sortedFunds = (app.emergencyFunds || []).sort((a, b) => {
    const acctA = app.accounts.find(ac => ac.id === a.accountId)?.name || '';
    const acctB = app.accounts.find(ac => ac.id === b.accountId)?.name || '';
    return acctA.localeCompare(acctB);
  });

  if (sortedFunds.length === 0) {
    html += '<p class="empty-message">No emergency funds created yet. Add one to get started.</p>';
  } else {
    sortedFunds.forEach(fund => {
      const account = app.accounts.find(ac => ac.id === fund.accountId);
      const accountName = account?.name || 'Unknown Account';
      const progressPercent = fund.targetAmount > 0 ? Math.round((fund.currentAmount / fund.targetAmount) * 100) : 0;
      const remaining = Math.max(0, fund.targetAmount - fund.currentAmount);
      const monthsToComplete = fund.monthlyContribution > 0 ? Math.ceil(remaining / fund.monthlyContribution) : 999;
      const projectedDate = new Date();
      projectedDate.setMonth(projectedDate.getMonth() + monthsToComplete);

      const badgeClass = progressPercent === 100 ? 'badge-complete' : progressPercent >= 75 ? 'badge-excellent' : progressPercent >= 50 ? 'badge-good' : 'badge-warning';

      html += `
        <div class="emergency-card">
          <div class="emergency-card-header">
            <div>
              <div class="emergency-account">${escapeHtml(accountName)}</div>
              <div class="emergency-target">${formatCurrency(fund.currentAmount)} / ${formatCurrency(fund.targetAmount)}</div>
            </div>
            <div class="emergency-badge ${badgeClass}">${progressPercent}%</div>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" data-progress-width="${Math.min(100, progressPercent)}"></div>
          </div>
          <div class="emergency-card-details">
            <div class="detail-row">
              <span>Monthly Contribution:</span>
              <span>${formatCurrency(fund.monthlyContribution)} ${fund.autoContribute ? '(auto)' : ''}</span>
            </div>
            <div class="detail-row">
              <span>Remaining:</span>
              <span>${formatCurrency(remaining)}</span>
            </div>
            <div class="detail-row">
              <span>Projected Completion:</span>
              <span>${monthsToComplete >= 999 ? 'N/A' : projectedDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
            </div>
            ${fund.notes ? `<div class="detail-row"><span>Notes:</span><span>${escapeHtml(fund.notes)}</span></div>` : ''}
          </div>
          <div class="emergency-card-actions">
            <button class="btn btn-small btn-secondary" data-emergency-action="edit" data-emergency-id="${escapeHtml(fund.id)}">Edit</button>
            <button class="btn btn-small btn-primary" data-emergency-action="contribute" data-emergency-id="${escapeHtml(fund.id)}">+ Contribute</button>
            <button class="btn btn-small btn-danger" data-emergency-action="delete" data-emergency-id="${escapeHtml(fund.id)}">Delete</button>
          </div>
        </div>
      `;
    });
  }

  html += `
      </div>
    </div>
  `;

  return html;
}

function renderSinkingFundsContent(app) {
  let html = `
    <div class="savings-section sinking-funds-section">
      <h2>Sinking Funds</h2>
      <p class="section-description">Create goals for planned expenses (car repairs, vacation, insurance, etc.) and track monthly allocations.</p>

      <div class="sinking-form-card">
        <button class="sinking-form-toggle" id="sinkingFormToggle">➕ Add/Edit Sinking Fund</button>
        <div class="sinking-form-body hidden" id="sinkingFormBody">
          <form id="sinkingForm">
            <div class="sinking-form-grid">
              <div class="form-group">
                <label for="sinkingName">Goal Name</label>
                <input type="text" id="sinkingName" placeholder="e.g., Car Repairs, Vacation" required />
              </div>
              <div class="form-group">
                <label for="sinkingAllocationMethod">Allocation Method</label>
                <select id="sinkingAllocationMethod" required>
                  <option value="fixed">Fixed Monthly Amount</option>
                  <option value="annual">Annual Cost ÷ 12</option>
                  <option value="target_date">Target Date Planning</option>
                </select>
              </div>
              <div class="form-group" id="fixedAmountGroup">
                <label for="sinkingMonthlyAllocation">Monthly Allocation ($)</label>
                <input type="number" id="sinkingMonthlyAllocation" min="0" step="0.01" placeholder="100" />
              </div>
              <div class="form-group hidden" id="annualCostGroup">
                <label for="sinkingAnnualCost">Annual Cost ($)</label>
                <input type="number" id="sinkingAnnualCost" min="0" step="0.01" placeholder="1200" />
              </div>
              <div class="form-group hidden" id="targetAmountGroup">
                <label for="sinkingTargetAmount">Target Amount ($)</label>
                <input type="number" id="sinkingTargetAmount" min="0" step="0.01" placeholder="5000" />
              </div>
              <div class="form-group hidden" id="targetDateGroup">
                <label for="sinkingTargetDate">Target Date</label>
                <input type="date" id="sinkingTargetDate" />
              </div>
              <div class="form-group">
                <label for="sinkingCurrentAmount">Current Amount ($)</label>
                <input type="number" id="sinkingCurrentAmount" min="0" step="0.01" placeholder="0" required />
              </div>
              <div class="form-group">
                <label for="sinkingAccount">Account</label>
                <select id="sinkingAccount" required>
                  <option value="">-- Select Account --</option>
                  ${app.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label for="sinkingAuto">
                  <input type="checkbox" id="sinkingAuto" />
                  Auto-contribute monthly
                </label>
              </div>
              <div class="form-group">
                <label for="sinkingNotes">Notes</label>
                <textarea id="sinkingNotes" placeholder="Optional notes"></textarea>
              </div>
            </div>
            <div class="sinking-form-actions">
              <button type="submit" class="btn btn-primary" id="sinkingFormSubmit">Save Sinking Fund</button>
              <button type="button" class="btn btn-secondary" id="sinkingCancelBtn">Cancel</button>
            </div>
          </form>
        </div>
      </div>

      <div class="sinking-list" id="sinkingList">
  `;

  if (!app.sinkingFunds || app.sinkingFunds.length === 0) {
    html += '<p class="empty-message">No sinking funds created yet. Add one to get started.</p>';
  } else {
    app.sinkingFunds.forEach(fund => {
      const account = app.accounts.find(ac => ac.id === fund.accountId);
      const accountName = account?.name || 'Unknown Account';
      const progressPercent = fund.targetAmount > 0 ? Math.round((fund.currentAmount / fund.targetAmount) * 100) : 0;
      const remaining = Math.max(0, fund.targetAmount - fund.currentAmount);

      const badgeClass = progressPercent === 100 ? 'badge-complete' : progressPercent >= 75 ? 'badge-excellent' : progressPercent >= 50 ? 'badge-good' : 'badge-warning';

      html += `
        <div class="sinking-card">
          <div class="sinking-card-header">
            <div>
              <div class="sinking-name">${escapeHtml(fund.name)}</div>
              <div class="sinking-account">${escapeHtml(accountName)}</div>
            </div>
            <div class="sinking-badge ${badgeClass}">${progressPercent}%</div>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" data-progress-width="${Math.min(100, progressPercent)}"></div>
          </div>
          <div class="sinking-card-details">
            <div class="detail-row">
              <span>Progress:</span>
              <span>${formatCurrency(fund.currentAmount)} / ${formatCurrency(fund.targetAmount)}</span>
            </div>
            <div class="detail-row">
              <span>Monthly Allocation:</span>
              <span>${formatCurrency(fund.monthlyAllocation)} ${fund.autoContribute ? '(auto)' : ''}</span>
            </div>
            <div class="detail-row">
              <span>Remaining:</span>
              <span>${formatCurrency(remaining)}</span>
            </div>
            ${fund.notes ? `<div class="detail-row"><span>Notes:</span><span>${escapeHtml(fund.notes)}</span></div>` : ''}
          </div>
          <div class="sinking-card-actions">
            <button class="btn btn-small btn-secondary" data-sinking-action="edit" data-sinking-id="${escapeHtml(fund.id)}">Edit</button>
            <button class="btn btn-small btn-primary" data-sinking-action="contribute" data-sinking-id="${escapeHtml(fund.id)}">+ Contribute</button>
            <button class="btn btn-small btn-danger" data-sinking-action="delete" data-sinking-id="${escapeHtml(fund.id)}">Delete</button>
          </div>
        </div>
      `;
    });
  }

  html += `
      </div>
    </div>
  `;

  return html;
}

/**
 * Switch between Emergency Fund and Sinking Funds subtabs
 */
export function switchSavingsSubTab(app, subTab) {
  app.savingsSubTab = subTab;
  renderSavingsPage(app);
  attachSavingsEventListeners(app);
}

/**
 * Attach all event listeners for savings page
 */
export function attachSavingsEventListeners(app) {
  const section = document.getElementById('savingsSection');
  if (!section) return;

  const savingsPrintBtn = document.getElementById('savingsPrintBtn');
  if (savingsPrintBtn) {
    savingsPrintBtn.addEventListener('click', () => window.print());
  }

  // Subtab switching
  section.querySelectorAll('.savings-subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchSavingsSubTab(app, btn.dataset.savingsSubtab);
    });
  });

  // Emergency Fund form toggle
  const emergencyFormToggle = document.getElementById('emergencyFormToggle');
  const emergencyFormBody = document.getElementById('emergencyFormBody');
  if (emergencyFormToggle && emergencyFormBody) {
    emergencyFormToggle.addEventListener('click', () => {
      emergencyFormBody.classList.toggle('visible'); emergencyFormBody.classList.toggle('hidden');
    });
  }

  // Sinking Fund form toggle
  const sinkingFormToggle = document.getElementById('sinkingFormToggle');
  const sinkingFormBody = document.getElementById('sinkingFormBody');
  if (sinkingFormToggle && sinkingFormBody) {
    sinkingFormToggle.addEventListener('click', () => {
      sinkingFormBody.classList.toggle('visible'); sinkingFormBody.classList.toggle('hidden');
    });
  }

  // Emergency Fund form submit
  const emergencyForm = document.getElementById('emergencyForm');
  if (emergencyForm) {
    emergencyForm.addEventListener('submit', e => {
      e.preventDefault();
      addEmergencyFund(app);
    });
  }

  // Sinking Fund form submit
  const sinkingForm = document.getElementById('sinkingForm');
  if (sinkingForm) {
    sinkingForm.addEventListener('submit', e => {
      e.preventDefault();
      addSinkingFund(app);
    });
  }

  // Sinking Fund allocation method change
  const sinkingAllocationMethod = document.getElementById('sinkingAllocationMethod');
  if (sinkingAllocationMethod) {
    sinkingAllocationMethod.addEventListener('change', () => {
      handleAllocationMethodChange();
    });
  }

  // Cancel buttons
  const emergencyCancelBtn = document.getElementById('emergencyCancelBtn');
  if (emergencyCancelBtn) {
    emergencyCancelBtn.addEventListener('click', () => {
      if (emergencyFormBody) { emergencyFormBody.classList.add('hidden'); emergencyFormBody.classList.remove('visible'); }
      emergencyForm?.reset();
    });
  }

  const sinkingCancelBtn = document.getElementById('sinkingCancelBtn');
  if (sinkingCancelBtn) {
    sinkingCancelBtn.addEventListener('click', () => {
      if (sinkingFormBody) { sinkingFormBody.classList.add('hidden'); sinkingFormBody.classList.remove('visible'); }
      sinkingForm?.reset();
    });
  }

  // Emergency Fund card actions
  const emergencyList = document.getElementById('emergencyList');
  if (emergencyList) {
    emergencyList.addEventListener('click', e => {
      const btn = e.target.closest('[data-emergency-action]');
      if (!btn) return;
      const action = btn.dataset.emergencyAction;
      const fundId = btn.dataset.emergencyId;
      if (action === 'edit') startEditEmergencyFund(app, fundId);
      if (action === 'delete') deleteEmergencyFund(app, fundId);
      if (action === 'contribute') openContributeEmergency(app, fundId);
    });
  }

  // Sinking Fund card actions
  const sinkingList = document.getElementById('sinkingList');
  if (sinkingList) {
    sinkingList.addEventListener('click', e => {
      const btn = e.target.closest('[data-sinking-action]');
      if (!btn) return;
      const action = btn.dataset.sinkingAction;
      const fundId = btn.dataset.sinkingId;
      if (action === 'edit') startEditSinkingFund(app, fundId);
      if (action === 'delete') deleteSinkingFund(app, fundId);
      if (action === 'contribute') openContributeSinking(app, fundId);
    });
  }
}

/**
 * Add Emergency Fund
 */
function addEmergencyFund(app) {
  const accountId = document.getElementById('emergencyAccount').value;
  const targetAmount = sanitizeFiniteNumber(document.getElementById('emergencyTarget').value);
  const currentAmount = sanitizeFiniteNumber(document.getElementById('emergencyCurrent').value);
  const monthlyContribution = sanitizeFiniteNumber(document.getElementById('emergencyContribution').value);
  const autoContribute = document.getElementById('emergencyAuto').checked;
  const notes = normalizeText(document.getElementById('emergencyNotes').value);

  if (!accountId || targetAmount <= 0 || monthlyContribution < 0) {
    alert('Please fill all required fields with valid values.');
    return;
  }

  const existingFund = app.emergencyFunds.find(f => f.accountId === accountId);
  if (existingFund) {
    Object.assign(existingFund, { targetAmount, currentAmount, monthlyContribution, autoContribute, notes });
  } else {
    app.emergencyFunds.push({
      id: `ef-${Date.now()}`,
      accountId,
      targetAmount,
      currentAmount,
      monthlyContribution,
      autoContribute,
      notes
    });
  }

  app.saveToStorage();
  renderSavingsPage(app);
  attachSavingsEventListeners(app);
}

/**
 * Delete Emergency Fund
 */
function deleteEmergencyFund(app, fundId) {
  if (!confirm('Delete this emergency fund?')) return;
  app.emergencyFunds = app.emergencyFunds.filter(f => f.id !== fundId);
  app.saveToStorage();
  renderSavingsPage(app);
  attachSavingsEventListeners(app);
}

/**
 * Open contribute dialog for Emergency Fund
 */
function openContributeEmergency(app, fundId) {
  const amount = prompt('Enter contribution amount:');
  if (!amount) return;
  const contrib = sanitizeFiniteNumber(amount);
  if (contrib <= 0) {
    alert('Please enter a valid amount.');
    return;
  }

  const fund = app.emergencyFunds.find(f => f.id === fundId);
  if (fund) {
    fund.currentAmount = Math.min(fund.currentAmount + contrib, fund.targetAmount);
    app.saveToStorage();
    renderSavingsPage(app);
    attachSavingsEventListeners(app);
  }
}

/**
 * Start editing Emergency Fund
 */
function startEditEmergencyFund(app, fundId) {
  const fund = app.emergencyFunds.find(f => f.id === fundId);
  if (!fund) return;

  document.getElementById('emergencyAccount').value = fund.accountId;
  document.getElementById('emergencyTarget').value = fund.targetAmount;
  document.getElementById('emergencyCurrent').value = fund.currentAmount;
  document.getElementById('emergencyContribution').value = fund.monthlyContribution;
  document.getElementById('emergencyAuto').checked = fund.autoContribute;
  document.getElementById('emergencyNotes').value = fund.notes || '';

  document.getElementById('emergencyFormBody').classList.add('visible'); document.getElementById('emergencyFormBody').classList.remove('hidden');
}

/**
 * Add Sinking Fund
 */
function addSinkingFund(app) {
  const name = normalizeText(document.getElementById('sinkingName').value);
  const allocationMethod = document.getElementById('sinkingAllocationMethod').value;
  const currentAmount = sanitizeFiniteNumber(document.getElementById('sinkingCurrentAmount').value);
  const autoContribute = document.getElementById('sinkingAuto').checked;
  const accountId = document.getElementById('sinkingAccount').value;
  const notes = normalizeText(document.getElementById('sinkingNotes').value);

  if (!name || !accountId) {
    alert('Please fill all required fields.');
    return;
  }

  let monthlyAllocation = 0;
  let targetAmount = 0;

  if (allocationMethod === 'fixed') {
    monthlyAllocation = sanitizeFiniteNumber(document.getElementById('sinkingMonthlyAllocation').value);
    if (monthlyAllocation <= 0) {
      alert('Monthly allocation must be greater than 0.');
      return;
    }
    targetAmount = monthlyAllocation * 12;
  } else if (allocationMethod === 'annual') {
    const annualCost = sanitizeFiniteNumber(document.getElementById('sinkingAnnualCost').value);
    if (annualCost <= 0) {
      alert('Annual cost must be greater than 0.');
      return;
    }
    monthlyAllocation = annualCost / 12;
    targetAmount = annualCost;
  } else if (allocationMethod === 'target_date') {
    const targetAmount2 = sanitizeFiniteNumber(document.getElementById('sinkingTargetAmount').value);
    const targetDateStr = document.getElementById('sinkingTargetDate').value;
    if (targetAmount2 <= 0 || !targetDateStr) {
      alert('Please enter target amount and date.');
      return;
    }
    targetAmount = targetAmount2;
    const targetDate = new Date(targetDateStr);
    const today = new Date();
    const monthsDiff = (targetDate.getFullYear() - today.getFullYear()) * 12 + (targetDate.getMonth() - today.getMonth());
    monthlyAllocation = monthsDiff > 0 ? targetAmount / monthsDiff : targetAmount;
  }

  const fund = {
    id: `sf-${Date.now()}`,
    name,
    allocationMethod,
    monthlyAllocation,
    targetAmount,
    currentAmount,
    autoContribute,
    accountId,
    notes
  };

  app.sinkingFunds.push(fund);
  app.saveToStorage();
  renderSavingsPage(app);
  attachSavingsEventListeners(app);
}

/**
 * Delete Sinking Fund
 */
function deleteSinkingFund(app, fundId) {
  if (!confirm('Delete this sinking fund?')) return;
  app.sinkingFunds = app.sinkingFunds.filter(f => f.id !== fundId);
  app.saveToStorage();
  renderSavingsPage(app);
  attachSavingsEventListeners(app);
}

/**
 * Open contribute dialog for Sinking Fund
 */
function openContributeSinking(app, fundId) {
  const amount = prompt('Enter contribution amount:');
  if (!amount) return;
  const contrib = sanitizeFiniteNumber(amount);
  if (contrib <= 0) {
    alert('Please enter a valid amount.');
    return;
  }

  const fund = app.sinkingFunds.find(f => f.id === fundId);
  if (fund) {
    fund.currentAmount = Math.min(fund.currentAmount + contrib, fund.targetAmount);
    app.saveToStorage();
    renderSavingsPage(app);
    attachSavingsEventListeners(app);
  }
}

/**
 * Start editing Sinking Fund
 */
function startEditSinkingFund(app, fundId) {
  const fund = app.sinkingFunds.find(f => f.id === fundId);
  if (!fund) return;

  document.getElementById('sinkingName').value = fund.name;
  document.getElementById('sinkingAllocationMethod').value = fund.allocationMethod;
  document.getElementById('sinkingCurrentAmount').value = fund.currentAmount;
  document.getElementById('sinkingAccount').value = fund.accountId;
  document.getElementById('sinkingAuto').checked = fund.autoContribute;
  document.getElementById('sinkingNotes').value = fund.notes || '';

  if (fund.allocationMethod === 'fixed') {
    document.getElementById('sinkingMonthlyAllocation').value = fund.monthlyAllocation;
  } else if (fund.allocationMethod === 'annual') {
    document.getElementById('sinkingAnnualCost').value = fund.targetAmount;
  } else if (fund.allocationMethod === 'target_date') {
    document.getElementById('sinkingTargetAmount').value = fund.targetAmount;
  }

  handleAllocationMethodChange();
  document.getElementById('sinkingFormBody').classList.add('visible'); document.getElementById('sinkingFormBody').classList.remove('hidden');
}

/**
 * Handle allocation method change in form
 */
window.handleAllocationMethodChange = function() {
  const method = document.getElementById('sinkingAllocationMethod').value;
  const fixedEl = document.getElementById('fixedAmountGroup');
  const annualEl = document.getElementById('annualCostGroup');
  const targetAmountEl = document.getElementById('targetAmountGroup');
  const targetDateEl = document.getElementById('targetDateGroup');
  if (fixedEl) {
    fixedEl.classList.toggle('visible', method === 'fixed');
    fixedEl.classList.toggle('hidden', method !== 'fixed');
  }
  if (annualEl) {
    annualEl.classList.toggle('visible', method === 'annual');
    annualEl.classList.toggle('hidden', method !== 'annual');
  }
  if (targetAmountEl) {
    targetAmountEl.classList.toggle('visible', method === 'target_date');
    targetAmountEl.classList.toggle('hidden', method !== 'target_date');
  }
  if (targetDateEl) {
    targetDateEl.classList.toggle('visible', method === 'target_date');
    targetDateEl.classList.toggle('hidden', method !== 'target_date');
  }
};

/**
 * Calculate projected savings for reports
 */
export function calculateSavingsProjection(app, year, month) {
  let emergencyContributions = 0;
  let sinkingContributions = 0;

  // Auto-contribute emergency funds for this month
  app.emergencyFunds?.forEach(fund => {
    if (fund.autoContribute && fund.currentAmount < fund.targetAmount) {
      emergencyContributions += fund.monthlyContribution;
    }
  });

  // Auto-contribute sinking funds for this month
  app.sinkingFunds?.forEach(fund => {
    if (fund.autoContribute && fund.currentAmount < fund.targetAmount) {
      sinkingContributions += fund.monthlyAllocation;
    }
  });

  return {
    emergencyContributions,
    sinkingContributions,
    total: emergencyContributions + sinkingContributions
  };
}
