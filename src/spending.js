import { getLedgerTransactionsForMonth } from './ledger.js';
import { escapeHtml, formatCurrency, renderChartDataTable, getReportDate } from './utils.js';

export const PALETTE = [
    '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
    '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#64748b'
];

const PINNED_COLORS = { 'Debt Payments': '#ef4444', 'Savings': '#10b981' };

export function categoryColor(name) {
    name = String(name || 'Other');
    if (Object.prototype.hasOwnProperty.call(PINNED_COLORS, name)) return PINNED_COLORS[name];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
    return PALETTE[Math.abs(h) % PALETTE.length];
}

function _catForTx(tx) {
    if (tx.type === 'bill' || tx.type === 'expense') return tx.category || 'Other';
    if (tx.type === 'recurring' && tx.amount < 0) return tx.category || 'Other';
    if (tx.type === 'debt') return 'Debt Payments';
    if (tx.type === 'savings' && tx.amount < 0) return 'Savings'; // ledger always emits negative; guard against future withdrawals
    return null; // income, bonus, reimbursement — excluded from spending
}

function _aggregate(txs) {
    const m = new Map();
    for (const tx of txs) {
        const cat = _catForTx(tx);
        if (!cat) continue;
        if (!m.has(cat)) m.set(cat, { total: 0, transactions: [] });
        const b = m.get(cat);
        b.total += Math.abs(tx.amount || 0);
        b.transactions.push(tx);
    }
    return m;
}

export function computeSpendingByCategory(app, year, month) {
    const txs = getLedgerTransactionsForMonth(app, year, month);
    const buckets = _aggregate(txs);

    let py = year, pm = month - 1;
    if (pm < 0) { pm = 11; py--; }
    const priorBuckets = _aggregate(getLedgerTransactionsForMonth(app, py, pm));

    const result = [];
    for (const [category, { total, transactions }] of buckets) {
        const prior = priorBuckets.get(category);
        const changeVsLastMonth = (prior && prior.total > 0) ? (total - prior.total) / prior.total : null;
        result.push({ category, total, transactions, changeVsLastMonth });
    }
    result.sort((a, b) => b.total - a.total);
    return result;
}

function _changeBadgeHTML(change, prevLabel, cls) {
    if (change === null || change === undefined) return '<span></span>';
    const pct = Math.round(Math.abs(change) * 100);
    const dir = change >= 0 ? '↑' : '↓';
    return `<span class="spending-change-badge ${cls}">${dir} ${pct}% vs ${escapeHtml(prevLabel)}</span>`;
}

function _openSpendingDrilldown(app, catData, year, month) {
    const modal = document.getElementById('spendingDrilldownModal');
    const content = document.getElementById('spendingDrilldownContent');
    if (!modal || !content) return;
    let py = year, pm = month - 1;
    if (pm < 0) { pm = 11; py--; }
    const monthLabel = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const prevLabel = new Date(py, pm, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const typeIcons = { expense: '💸', bill: '🧾', recurring: '🔄', debt: '💳', savings: '💰' };
    const badgeHTML = _changeBadgeHTML(
        catData.changeVsLastMonth, prevLabel,
        catData.changeVsLastMonth !== null && catData.changeVsLastMonth >= 0 ? 'spending-badge--up' : 'spending-badge--down'
    );
    const txRows = catData.transactions.map(tx => {
        const d = new Date(tx.date);
        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const icon = typeIcons[tx.type] || '•';
        return `<div class="spending-modal-tx-row">
            <span class="spending-modal-tx-name">${escapeHtml(tx.name)}</span>
            <span class="spending-modal-tx-meta">${dateStr} ${icon}</span>
            <span class="spending-modal-tx-amt--neg">–${formatCurrency(Math.abs(tx.amount))}</span>
        </div>`;
    }).join('');
    content.innerHTML = `
        <div class="spending-modal-header">
            <div>
                <h3 class="spending-modal-title" id="spendingDrilldownTitle">${escapeHtml(catData.category)} — ${escapeHtml(monthLabel)}</h3>
                <p class="spending-modal-subtitle">${catData.transactions.length} transaction${catData.transactions.length !== 1 ? 's' : ''} · ${formatCurrency(catData.total)}</p>
            </div>
            ${badgeHTML}
        </div>
        <div class="spending-modal-tx-list">${txRows || '<p class="spending-empty-detail">No transactions.</p>'}</div>
        <div class="spending-modal-footer">
            <button class="btn btn-secondary" id="spendingDrilldownClose">Close</button>
        </div>`;
    modal.classList.remove('hidden');
    document.getElementById('spendingDrilldownClose').onclick = () => modal.classList.add('hidden');
    modal.onclick = e => { if (e.target === modal) modal.classList.add('hidden'); };
}

function _hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

export function renderReportsSpending(app) {
    const container = document.getElementById('reportsSpending');
    if (!container) return;

    if (app._rptSpendingPieChart) { app._rptSpendingPieChart.destroy(); app._rptSpendingPieChart = null; }
    if (app._rptSpendingBarChart) { app._rptSpendingBarChart.destroy(); app._rptSpendingBarChart = null; }

    const d = getReportDate(app);
    const year = d.getFullYear(), month = d.getMonth();
    const monthLabel = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const categories = computeSpendingByCategory(app, year, month);

    if (categories.length === 0) {
        container.innerHTML = `<p class="spending-empty">No spending data for ${escapeHtml(monthLabel)}. Add expenses, bills, or recurring templates.</p>`;
        return;
    }

    const total = categories.reduce((s, c) => s + c.total, 0);
    let py = year, pm = month - 1;
    if (pm < 0) { pm = 11; py--; }
    const prevLabel = new Date(py, pm, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const prevCats = computeSpendingByCategory(app, py, pm);
    const prevTotal = prevCats.reduce((s, c) => s + c.total, 0);
    const totalChange = prevTotal > 0 ? (total - prevTotal) / prevTotal : null;
    const totalBadge = _changeBadgeHTML(totalChange, prevLabel, totalChange !== null && totalChange >= 0 ? 'spending-badge--up' : 'spending-badge--down');

    const rankedRows = categories.map((cat, i) => {
        const changeHTML = _changeBadgeHTML(cat.changeVsLastMonth, prevLabel,
            cat.changeVsLastMonth !== null && cat.changeVsLastMonth >= 0 ? 'spending-ranked-change--up' : 'spending-ranked-change--down');
        return `<div class="spending-ranked-row" data-spending-cat="${escapeHtml(cat.category)}" role="button" tabindex="0" aria-label="View ${escapeHtml(cat.category)} details">
            <span class="spending-ranked-rank">${i + 1}.</span>
            <span class="spending-ranked-name">${escapeHtml(cat.category)}</span>
            <span class="spending-ranked-total">${formatCurrency(cat.total)}</span>
            ${changeHTML}
        </div>`;
    }).join('');

    container.innerHTML = `
        <div class="spending-summary-strip">
            <span>Total: <strong>${formatCurrency(total)}</strong> · ${escapeHtml(monthLabel)}</span>
            ${totalBadge}
        </div>
        <div class="spending-hero-row">
            <div class="spending-pie-wrap"><canvas id="rptSpendingPieChart"></canvas></div>
            <div class="spending-ranked-list" id="spendingRankedList">${rankedRows}</div>
        </div>
        <div class="spending-bar-section">
            <h4 class="spending-bar-title">6-Month Trend by Category</h4>
            <div class="spending-bar-wrap"><canvas id="rptSpendingBarChart"></canvas></div>
        </div>`;

    const rankedList = document.getElementById('spendingRankedList');
    if (rankedList) {
        rankedList.addEventListener('click', e => {
            const row = e.target.closest('[data-spending-cat]');
            if (!row) return;
            const cat = categories.find(c => c.category === row.getAttribute('data-spending-cat'));
            if (cat) _openSpendingDrilldown(app, cat, year, month);
        });
    }

    // Pie chart
    const pieCvs = document.getElementById('rptSpendingPieChart');
    if (pieCvs && typeof Chart !== 'undefined') {
        app._rptSpendingPieChart = new Chart(pieCvs, {
            type: 'doughnut',
            data: {
                labels: categories.map(c => c.category),
                datasets: [{
                    data: categories.map(c => c.total),
                    backgroundColor: categories.map(c => categoryColor(c.category)),
                    borderWidth: 2,
                    borderColor: '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onClick: (event, elements) => {
                    if (!elements.length) return;
                    const cat = categories[elements[0].index];
                    _openSpendingDrilldown(app, cat, year, month);
                },
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
                    tooltip: {
                        callbacks: {
                            label: ctx => ` ${ctx.label}: ${formatCurrency(ctx.parsed)}`
                        }
                    }
                }
            }
        });


        renderChartDataTable('rptSpendingPieChart', {
            caption: `Spending by category — ${monthLabel}`,
            columns: ['Category', 'Amount'],
            rows: categories.map(c => [c.category, formatCurrency(c.total)])
        });
    }

    // 6-month stacked bar chart
    const barCvs = document.getElementById('rptSpendingBarChart');
    if (barCvs && typeof Chart !== 'undefined') {
        const months = [];
        for (let i = 5; i >= 0; i--) {
            let bm = month - i, by = year;
            if (bm < 0) { bm += 12; by--; }
            months.push({ year: by, month: bm, label: new Date(by, bm, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) });
        }
        const monthCats = months.map(({ year: by, month: bm }) => computeSpendingByCategory(app, by, bm));
        const allCatNames = [...new Set(monthCats.flatMap(mc => mc.map(c => c.category)))];

        const barDatasets = allCatNames.map(cat => {
            const color = categoryColor(cat);
            return {
                label: cat,
                data: monthCats.map(mc => { const found = mc.find(c => c.category === cat); return found ? found.total : 0; }),
                backgroundColor: monthCats.map((_, idx) => idx === 5 ? color : _hexToRgba(color, 0.5)),
                borderWidth: 0
            };
        });

        app._rptSpendingBarChart = new Chart(barCvs, {
            type: 'bar',
            data: { labels: months.map(m => m.label), datasets: barDatasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { stacked: true },
                    y: { stacked: true, ticks: { callback: v => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v) } }
                },
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
                    tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}` } }
                }
            }
        });


        renderChartDataTable('rptSpendingBarChart', {
            caption: '6-month spending trend by category',
            columns: ['Month', ...barDatasets.map(ds => ds.label)],
            rows: months.map((m, idx) => [m.label, ...barDatasets.map(ds => formatCurrency(ds.data[idx]))])
        });
    }
}
