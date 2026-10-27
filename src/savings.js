import { formatCurrency, normalizeText, sanitizeFiniteNumber, sanitizeInteger, sanitizeDateISO, escapeHtml, formatShortDate, computeMonthlyIncomeForMonth, computeTotalSavingsContribution } from './utils.js';
import { buildAccountOptionsHtml, computeAccountBalance } from './accounts.js';
import { pgPost, pgPatch, pgDelete } from './postgresSync.js';
import { showDeleteConfirmModal, showAlertModal } from './ui.js';
import { getSetting, setSetting, SHOW_ARCHIVED_SINKING_FUNDS } from './settings.js';
import { renderHomePurchaseContent, attachHomePurchaseEventListeners } from './homePurchase.js';
import { savingsStatus } from './health.js';

/**
 * Savings rate summary panel shown at the top of the Savings page (issue #303):
 * what percentage of this month's net income is going to active savings
 * contributions (emergency fund + sinking fund allocations), using the exact
 * same formula and color thresholds as Health's Savings Rate card.
 */
function renderSavingsRateSummary(app) {
  const now = new Date();
  const totalSavingsContrib = computeTotalSavingsContribution(app);
  const { monthlyTotal: monthlyIncome } = computeMonthlyIncomeForMonth(app.incomes, app.bonuses, now.getFullYear(), now.getMonth());
  const ratio = monthlyIncome > 0 ? totalSavingsContrib / monthlyIncome : 0;
  const pct = Math.min(ratio * 100, 100);
  const status = savingsStatus(ratio);

  return `
    <div class="savings-rate-summary">
      <div class="savings-rate-summary-main">
        <span class="savings-rate-summary-label">Savings Rate</span>
        <span class="savings-rate-summary-value health-badge ${status.cls}">${pct.toFixed(1)}%</span>
      </div>
      <div class="savings-rate-summary-detail">
        Saving ${formatCurrency(totalSavingsContrib)} of ${formatCurrency(monthlyIncome)}/mo income
      </div>
    </div>
  `;
}

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
      ${renderSavingsRateSummary(app)}
      <div class="savings-subtabs">
        <button class="savings-subtab-btn ${currentSubTab === 'emergency' ? 'active' : ''}" data-savings-subtab="emergency" aria-pressed="${currentSubTab === 'emergency' ? 'true' : 'false'}">🏦 Emergency Fund</button>
        <button class="savings-subtab-btn ${currentSubTab === 'sinking' ? 'active' : ''}" data-savings-subtab="sinking" aria-pressed="${currentSubTab === 'sinking' ? 'true' : 'false'}">🎯 Sinking Funds</button>
        <button class="savings-subtab-btn ${currentSubTab === 'home' ? 'active' : ''}" data-savings-subtab="home" aria-pressed="${currentSubTab === 'home' ? 'true' : 'false'}">🏠 Home Purchase</button>
      </div>

      <div class="savings-content">
  `;

  if (currentSubTab === 'emergency') {
    html += renderEmergencyFundContent(app);
  } else if (currentSubTab === 'sinking') {
    html += renderSinkingFundsContent(app);
  } else {
    html += renderHomePurchaseContent(app);
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
                  ${buildAccountOptionsHtml(app.accounts, null, { emptyLabel: '-- Select Account --' })}
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
              <div class="form-group ef-auto-sync-row">
                <label class="ef-auto-sync-label">
                  <input type="checkbox" id="emergencyAutoSync" />
                  Auto-sync balance from linked account
                </label>
                <span class="ef-auto-sync-hint">When enabled, the current amount reflects the linked account's projected balance.</span>
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
      const displayAmount = fund.autoSyncBalance && fund.accountId
        ? computeAccountBalance(app, fund.accountId)
        : fund.currentAmount;
      const progressPercent = fund.targetAmount > 0 ? Math.round((displayAmount / fund.targetAmount) * 100) : 0;
      const remaining = Math.max(0, fund.targetAmount - displayAmount);
      const monthsToComplete = fund.monthlyContribution > 0 ? Math.ceil(remaining / fund.monthlyContribution) : 999;
      const projectedDate = new Date();
      projectedDate.setMonth(projectedDate.getMonth() + monthsToComplete);

      const badgeClass = progressPercent === 100 ? 'badge-complete' : progressPercent >= 75 ? 'badge-excellent' : progressPercent >= 50 ? 'badge-good' : 'badge-warning';

      html += `
        <div class="emergency-card">
          <div class="emergency-card-header">
            <div>
              <div class="emergency-account">${escapeHtml(accountName)}</div>
              <div class="emergency-target">${formatCurrency(displayAmount)} / ${formatCurrency(fund.targetAmount)}${fund.autoSyncBalance ? ' <span class="ef-sync-badge" title="Balance is auto-synced from linked account">⟳ synced</span>' : ''}</div>
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
            <button class="btn btn-small btn-secondary" data-emergency-action="edit" data-emergency-id="${escapeHtml(String(fund.id))}" aria-label="Edit ${escapeHtml(accountName)}">Edit</button>
            ${fund.autoSyncBalance ? '' : `<button class="btn btn-small btn-primary" data-emergency-action="contribute" data-emergency-id="${escapeHtml(String(fund.id))}" aria-label="Contribute to ${escapeHtml(accountName)}">+ Contribute</button>`}
            <button class="btn btn-small btn-danger" data-emergency-action="delete" data-emergency-id="${escapeHtml(String(fund.id))}" aria-label="Delete ${escapeHtml(accountName)}">Delete</button>
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
  const showArchived = getSetting(app, SHOW_ARCHIVED_SINKING_FUNDS, false);
  const allFunds = app.sinkingFunds || [];
  const sortedFunds = [...allFunds].sort((a, b) => {
    const ao = a.order || 0, bo = b.order || 0;
    if (ao !== bo) return ao === 0 ? 1 : bo === 0 ? -1 : ao - bo;
    return a.id - b.id;
  });
  const visibleFunds = showArchived ? sortedFunds : sortedFunds.filter(f => !f.archived);
  const archivedCount = sortedFunds.filter(f => f.archived).length;

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
                  ${buildAccountOptionsHtml(app.accounts, null, { emptyLabel: '-- Select Account --' })}
                </select>
              </div>
              <div class="form-group">
                <label for="sinkingOrder">Priority (order)</label>
                <input type="number" id="sinkingOrder" min="1" step="1" placeholder="Leave blank for default" />
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
      </div>`;

  if (archivedCount > 0) {
    html += `<div class="savings-archived-row">
      <button class="btn btn-small btn-secondary" id="toggleArchivedSinkingFunds" aria-pressed="${showArchived ? 'true' : 'false'}">
        ${showArchived ? 'Hide Archived' : `Show Archived (${archivedCount})`}
      </button>
    </div>`;
  }

  html += `<div class="sinking-list" id="sinkingList">`;

  if (visibleFunds.length === 0 && allFunds.filter(f => !f.archived).length === 0) {
    html += `<div class="empty-state">
      <div class="empty-state__icon">🎯</div>
      <h3 class="empty-state__heading">No sinking funds yet</h3>
      <p class="empty-state__body">Create goals for planned expenses — car repairs, vacations, insurance — and track your monthly progress toward each one.</p>
      <button class="btn btn-primary empty-state__cta" id="sinkingEmptyStateCta">Add Your First Fund</button>
    </div>`;
  } else {
    visibleFunds.forEach(fund => {
      const account = app.accounts.find(ac => ac.id === fund.accountId);
      const accountName = account?.name || 'Unknown Account';
      const progressPercent = fund.targetAmount > 0 ? Math.min(100, Math.round((fund.currentAmount / fund.targetAmount) * 100)) : 0;
      const remaining = Math.max(0, fund.targetAmount - fund.currentAmount);
      const isFullyFunded = fund.targetAmount > 0 && fund.currentAmount >= fund.targetAmount;

      const badgeClass = isFullyFunded ? 'badge-complete' : progressPercent >= 75 ? 'badge-excellent' : progressPercent >= 50 ? 'badge-good' : 'badge-warning';
      const cardClass = fund.archived ? ' sinking-card--archived' : isFullyFunded ? ' sinking-card--funded' : '';
      const orderLabel = fund.order ? `<span class="sinking-order-tag">#${fund.order}</span>` : '';

      html += `
        <div class="sinking-card${cardClass}">
          <div class="sinking-card-header">
            <div>
              <div class="sinking-name">${escapeHtml(fund.name)}${orderLabel}</div>
              <div class="sinking-account">${escapeHtml(accountName)}</div>
            </div>
            <div class="sinking-badge ${badgeClass}">${isFullyFunded ? '✓ Funded' : `${progressPercent}%`}</div>
          </div>
          <div class="progress-bar">
            <div class="progress-fill${isFullyFunded ? ' progress-fill--funded' : ''}" data-progress-width="${Math.min(100, progressPercent)}"></div>
          </div>
          <div class="sinking-card-details">
            <div class="detail-row">
              <span>Progress:</span>
              <span>${formatCurrency(fund.currentAmount)} / ${formatCurrency(fund.targetAmount)}</span>
            </div>
            ${!fund.archived ? `<div class="detail-row">
              <span>Monthly Allocation:</span>
              <span>${formatCurrency(fund.monthlyAllocation)} ${fund.autoContribute ? '(auto)' : ''}</span>
            </div>` : ''}
            ${!isFullyFunded && !fund.archived ? `<div class="detail-row">
              <span>Remaining:</span>
              <span>${formatCurrency(remaining)}</span>
            </div>` : ''}
            ${fund.completedDate ? `<div class="detail-row">
              <span>Completed:</span>
              <span>${escapeHtml(fund.completedDate)}</span>
            </div>` : ''}
            ${fund.notes ? `<div class="detail-row"><span>Notes:</span><span>${escapeHtml(fund.notes)}</span></div>` : ''}
          </div>
          <div class="sinking-card-actions">
            ${fund.archived
              ? `<button class="btn btn-small btn-secondary" data-sinking-action="unarchive" data-sinking-id="${escapeHtml(String(fund.id))}" aria-label="Unarchive ${escapeHtml(fund.name)}">Unarchive</button>
                 <button class="btn btn-small btn-danger" data-sinking-action="delete" data-sinking-id="${escapeHtml(String(fund.id))}" aria-label="Delete ${escapeHtml(fund.name)}">Delete</button>`
              : `<button class="btn btn-small btn-secondary" data-sinking-action="edit" data-sinking-id="${escapeHtml(String(fund.id))}" aria-label="Edit ${escapeHtml(fund.name)}">Edit</button>
                 ${!isFullyFunded ? `<button class="btn btn-small btn-primary" data-sinking-action="contribute" data-sinking-id="${escapeHtml(String(fund.id))}" aria-label="Contribute to ${escapeHtml(fund.name)}">+ Contribute</button>` : ''}
                 ${isFullyFunded ? `<button class="btn btn-small btn-primary sinking-complete-btn" data-sinking-action="complete" data-sinking-id="${escapeHtml(String(fund.id))}" aria-label="Complete this goal: ${escapeHtml(fund.name)}">Complete this goal</button>` : ''}
                 <button class="btn btn-small btn-danger" data-sinking-action="delete" data-sinking-id="${escapeHtml(String(fund.id))}" aria-label="Delete ${escapeHtml(fund.name)}">Delete</button>`
            }
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

  attachHomePurchaseEventListeners(app);

  // Emergency Fund form toggle
  const emergencyFormToggle = document.getElementById('emergencyFormToggle');
  const emergencyFormBody = document.getElementById('emergencyFormBody');
  if (emergencyFormToggle && emergencyFormBody) {
    emergencyFormToggle.addEventListener('click', () => {
      emergencyFormBody.classList.toggle('visible'); emergencyFormBody.classList.toggle('hidden');
    });
  }

  // Toggle current-amount field disabled state when auto-sync checkbox changes
  const emergencyAutoSync = document.getElementById('emergencyAutoSync');
  const emergencyCurrentEl = document.getElementById('emergencyCurrent');
  if (emergencyAutoSync && emergencyCurrentEl) {
    emergencyAutoSync.addEventListener('change', () => {
      emergencyCurrentEl.disabled = emergencyAutoSync.checked;
      if (emergencyAutoSync.checked) emergencyCurrentEl.value = '';
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
      const fundId = parseInt(btn.dataset.sinkingId, 10) || btn.dataset.sinkingId;
      if (action === 'edit') startEditSinkingFund(app, fundId);
      if (action === 'delete') deleteSinkingFund(app, fundId);
      if (action === 'contribute') openContributeSinking(app, fundId);
      if (action === 'complete') openSinkingCompleteModal(app, fundId);
      if (action === 'unarchive') unarchiveSinkingFund(app, fundId);
    });
    const emptyCtaBtn = sinkingList.querySelector('#sinkingEmptyStateCta');
    if (emptyCtaBtn) {
      emptyCtaBtn.addEventListener('click', () => {
        const formBody = document.getElementById('sinkingFormBody');
        if (formBody) { formBody.classList.add('visible'); formBody.classList.remove('hidden'); }
      });
    }
  }

  const toggleArchivedBtn = document.getElementById('toggleArchivedSinkingFunds');
  if (toggleArchivedBtn) {
    toggleArchivedBtn.addEventListener('click', () => {
      const current = getSetting(app, SHOW_ARCHIVED_SINKING_FUNDS, false);
      setSetting(app, SHOW_ARCHIVED_SINKING_FUNDS, !current);
      app.saveToStorage();
      renderSavingsPage(app);
      attachSavingsEventListeners(app);
    });
  }
}

/**
 * Add Emergency Fund
 */
async function addEmergencyFund(app) {
  const accountIdRaw = document.getElementById('emergencyAccount').value;
  const accountId = sanitizeInteger(accountIdRaw, null);
  const targetAmount = sanitizeFiniteNumber(document.getElementById('emergencyTarget').value);
  const autoSyncBalance = document.getElementById('emergencyAutoSync').checked;
  const currentAmount = autoSyncBalance ? 0 : sanitizeFiniteNumber(document.getElementById('emergencyCurrent').value);
  const monthlyContribution = sanitizeFiniteNumber(document.getElementById('emergencyContribution').value);
  const autoContribute = document.getElementById('emergencyAuto').checked;
  const notes = normalizeText(document.getElementById('emergencyNotes').value);

  if (!accountId || targetAmount <= 0 || monthlyContribution < 0) {
    await showAlertModal('Please fill all required fields with valid values.');
    return;
  }

  const existingFund = app.emergencyFunds.find(f => f.accountId === accountId);
  if (existingFund) {
    Object.assign(existingFund, { targetAmount, currentAmount, monthlyContribution, autoContribute, autoSyncBalance, notes });
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/emergency-funds/${existingFund.id}`, existingFund);
  } else {
    const fund = { id: Date.now(), accountId, targetAmount, currentAmount, monthlyContribution, autoContribute, autoSyncBalance, notes };
    app.emergencyFunds.push(fund);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') {
      const saved = await pgPost(app, '/api/emergency-funds', fund);
      if (saved?.id) fund.id = saved.id;
    }
  }

  renderSavingsPage(app);
  attachSavingsEventListeners(app);
}

/**
 * Delete Emergency Fund
 */
async function deleteEmergencyFund(app, fundId) {
  if (!await showDeleteConfirmModal('Delete this emergency fund?')) return;
  const fund = app.emergencyFunds.find(f => String(f.id) === String(fundId));
  const numericId = fund?.id ?? fundId;
  app.emergencyFunds = app.emergencyFunds.filter(f => String(f.id) !== String(fundId));
  app.saveToStorage();
  if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/emergency-funds/${numericId}`);
  renderSavingsPage(app);
  attachSavingsEventListeners(app);
}

/**
 * Open contribute dialog for Emergency Fund
 */
async function openContributeEmergency(app, fundId) {
  const amount = prompt('Enter contribution amount:');
  if (!amount) return;
  const contrib = sanitizeFiniteNumber(amount);
  if (contrib <= 0) {
    await showAlertModal('Please enter a valid amount.');
    return;
  }

  const fund = app.emergencyFunds.find(f => String(f.id) === String(fundId));
  if (fund) {
    fund.currentAmount = Math.min(fund.currentAmount + contrib, fund.targetAmount);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/emergency-funds/${fund.id}`, fund);
    renderSavingsPage(app);
    attachSavingsEventListeners(app);
  }
}

/**
 * Start editing Emergency Fund
 */
function startEditEmergencyFund(app, fundId) {
  const fund = app.emergencyFunds.find(f => String(f.id) === String(fundId));
  if (!fund) return;

  document.getElementById('emergencyAccount').value = fund.accountId;
  document.getElementById('emergencyTarget').value = fund.targetAmount;
  const currentEl = document.getElementById('emergencyCurrent');
  currentEl.value = fund.currentAmount;
  currentEl.disabled = !!fund.autoSyncBalance;
  document.getElementById('emergencyAutoSync').checked = !!fund.autoSyncBalance;
  document.getElementById('emergencyContribution').value = fund.monthlyContribution;
  document.getElementById('emergencyAuto').checked = fund.autoContribute;
  document.getElementById('emergencyNotes').value = fund.notes || '';

  document.getElementById('emergencyFormBody').classList.add('visible'); document.getElementById('emergencyFormBody').classList.remove('hidden');
}

/**
 * Add Sinking Fund
 */
async function addSinkingFund(app) {
  const name = normalizeText(document.getElementById('sinkingName').value);
  const allocationMethod = document.getElementById('sinkingAllocationMethod').value;
  const currentAmount = sanitizeFiniteNumber(document.getElementById('sinkingCurrentAmount').value);
  const autoContribute = document.getElementById('sinkingAuto').checked;
  const accountId = document.getElementById('sinkingAccount').value;
  const notes = normalizeText(document.getElementById('sinkingNotes').value);

  if (!name || !accountId) {
    await showAlertModal('Please fill all required fields.');
    return;
  }

  let monthlyAllocation = 0;
  let targetAmount = 0;

  if (allocationMethod === 'fixed') {
    monthlyAllocation = sanitizeFiniteNumber(document.getElementById('sinkingMonthlyAllocation').value);
    if (monthlyAllocation <= 0) {
      await showAlertModal('Monthly allocation must be greater than 0.');
      return;
    }
    targetAmount = monthlyAllocation * 12;
  } else if (allocationMethod === 'annual') {
    const annualCost = sanitizeFiniteNumber(document.getElementById('sinkingAnnualCost').value);
    if (annualCost <= 0) {
      await showAlertModal('Annual cost must be greater than 0.');
      return;
    }
    monthlyAllocation = annualCost / 12;
    targetAmount = annualCost;
  } else if (allocationMethod === 'target_date') {
    const targetAmount2 = sanitizeFiniteNumber(document.getElementById('sinkingTargetAmount').value);
    const targetDateStr = document.getElementById('sinkingTargetDate').value;
    if (targetAmount2 <= 0 || !targetDateStr) {
      await showAlertModal('Please enter target amount and date.');
      return;
    }
    targetAmount = targetAmount2;
    const targetDate = new Date(targetDateStr);
    const today = new Date();
    const monthsDiff = (targetDate.getFullYear() - today.getFullYear()) * 12 + (targetDate.getMonth() - today.getMonth());
    monthlyAllocation = monthsDiff > 0 ? targetAmount / monthsDiff : targetAmount;
  }

  const order = sanitizeInteger(document.getElementById('sinkingOrder').value, 0);
  const fund = {
    id: `sf-${Date.now()}`,
    name,
    allocationMethod,
    monthlyAllocation,
    targetAmount,
    currentAmount,
    autoContribute,
    accountId,
    notes,
    order,
    archived: false,
    completedDate: null
  };

  app.sinkingFunds.push(fund);
  app.saveToStorage();
  if (app._storageBackendKind === 'postgres') {
    const saved = await pgPost(app, '/api/sinking-funds', fund);
    if (saved?.id) fund.id = saved.id;
  }
  renderSavingsPage(app);
  attachSavingsEventListeners(app);
}

/**
 * Open completion modal for a fully-funded sinking fund (#308)
 */
async function openSinkingCompleteModal(app, fundId) {
  const fund = app.sinkingFunds.find(f => String(f.id) === String(fundId));
  if (!fund) return;
  const lastFocused = document.activeElement;
  const modal = document.createElement('div');
  modal.className = 'modal flex-visible';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'sinkingCompleteTitle');
  modal.innerHTML = `
    <div class="modal-card">
      <h3 class="modal-title" id="sinkingCompleteTitle">🎉 Goal Complete!</h3>
      <p class="modal-message"><strong>${escapeHtml(fund.name)}</strong> is fully funded at ${escapeHtml(formatCurrency(fund.currentAmount))}.</p>
      <p class="modal-message">What would you like to do with it?</p>
      <div class="modal-actions">
        <button class="btn btn-primary" id="scArchiveBtn">Archive Goal</button>
        <button class="btn btn-danger" id="scDeleteBtn">Delete Goal</button>
        <button class="btn btn-secondary" id="scKeepBtn">Keep Active</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => {
    modal.remove();
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  };
  modal.onkeydown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') {
      const focusable = modal.querySelectorAll('button:not([disabled])');
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  modal.onclick = (e) => { if (e.target === modal) close(); };
  modal.querySelector('#scArchiveBtn').onclick = () => { close(); archiveSinkingFund(app, fundId); };
  modal.querySelector('#scDeleteBtn').onclick = async () => {
    close();
    await deleteSinkingFund(app, fundId);
  };
  modal.querySelector('#scKeepBtn').onclick = close;
  modal.focus();
  setTimeout(() => modal.querySelector('#scArchiveBtn').focus(), 30);
}

/**
 * Archive a completed sinking fund (#308)
 */
function archiveSinkingFund(app, fundId) {
  const fund = app.sinkingFunds.find(f => String(f.id) === String(fundId));
  if (!fund) return;
  fund.archived = true;
  fund.completedDate = new Date().toISOString().slice(0, 10);
  app.saveToStorage();
  if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/sinking-funds/${fundId}`, fund);
  renderSavingsPage(app);
  attachSavingsEventListeners(app);
}

/**
 * Unarchive a sinking fund (#308)
 */
function unarchiveSinkingFund(app, fundId) {
  const fund = app.sinkingFunds.find(f => String(f.id) === String(fundId));
  if (!fund) return;
  fund.archived = false;
  fund.completedDate = null;
  app.saveToStorage();
  if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/sinking-funds/${fundId}`, fund);
  renderSavingsPage(app);
  attachSavingsEventListeners(app);
}

/**
 * Delete Sinking Fund
 */
async function deleteSinkingFund(app, fundId) {
  if (!await showDeleteConfirmModal('Delete this sinking fund?')) return;
  app.sinkingFunds = app.sinkingFunds.filter(f => f.id !== fundId);
  app.saveToStorage();
  if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/sinking-funds/${fundId}`);
  renderSavingsPage(app);
  attachSavingsEventListeners(app);
}

/**
 * Open contribute dialog for Sinking Fund
 */
async function openContributeSinking(app, fundId) {
  const amount = prompt('Enter contribution amount:');
  if (!amount) return;
  const contrib = sanitizeFiniteNumber(amount);
  if (contrib <= 0) {
    await showAlertModal('Please enter a valid amount.');
    return;
  }

  const fund = app.sinkingFunds.find(f => f.id === fundId);
  if (fund) {
    fund.currentAmount = Math.min(fund.currentAmount + contrib, fund.targetAmount);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/sinking-funds/${fundId}`, fund);
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
  document.getElementById('sinkingOrder').value = fund.order || '';

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

