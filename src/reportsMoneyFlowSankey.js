// Reports page: single-month Money Flow Sankey diagram (issue #79)

import { escapeHtml, getReportDate, formatCurrency, renderChartDataTable } from './utils.js';
import { getLedgerTransactionsForMonth } from './ledgerTransactions.js';
import { computeMonthCashFlowTotals } from './reportsCashFlow.js';

const INCOME_COLORS = ['#10b981', '#34d399', '#6ee7b7', '#a7f3d0', '#059669', '#047857', '#065f46'];

const OUTFLOW_GROUPS = [
    { icon: '🧾', color: '#f59e0b', match: tx => tx.type === 'bill', key: tx => tx.category || 'Other' },
    { icon: '💸', color: '#8b5cf6', match: tx => tx.type === 'expense', key: tx => tx.category || 'Other' },
    { icon: '🔄', color: '#06b6d4', match: tx => tx.type === 'recurring' && tx.amount < 0, key: tx => tx.category || 'Other' },
    { icon: '💳', color: '#ef4444', match: tx => tx.type === 'debt', key: tx => tx.name || 'Debt' },
    { icon: '💰', color: '#10b981', match: tx => tx.type === 'savings', key: tx => tx.name || 'Savings' }
];

const ACCOUNT_COLOR = '#2563eb';
const SURPLUS_COLOR = '#10b981';
const SHORTFALL_COLOR = '#ef4444';
const BALANCE_EPSILON = 0.005;

export function computeMoneyFlowSankeyData(app, year, month) {
    const monthTxs = getLedgerTransactionsForMonth(app, year, month);
    const totals = computeMonthCashFlowTotals(app, year, month);
    const balancedTotal = Math.max(totals.income, totals.outflow);
    const hasData = totals.income > 0 || totals.outflow > 0;

    const nodes = [];
    const links = [];
    let nodeSeq = 0;
    const nextId = () => `n${nodeSeq++}`;

    const accountId = nextId();
    nodes.push({ id: accountId, label: 'Account', column: 1, amount: balancedTotal, color: ACCOUNT_COLOR });

    const incomeBySource = {};
    for (const tx of monthTxs) {
        const isIncome = tx.type === 'income' || tx.type === 'bonus' || tx.type === 'interest' ||
            (tx.type === 'recurring' && tx.amount >= 0);
        if (!isIncome) continue;
        incomeBySource[tx.name] = (incomeBySource[tx.name] || 0) + tx.amount;
    }
    let colorIdx = 0;
    for (const [name, amount] of Object.entries(incomeBySource)) {
        if (amount <= 0) continue;
        const id = nextId();
        const color = INCOME_COLORS[colorIdx % INCOME_COLORS.length];
        colorIdx++;
        nodes.push({ id, label: name, column: 0, amount, color });
        links.push({ sourceId: id, targetId: accountId, amount, color });
    }

    for (const group of OUTFLOW_GROUPS) {
        const grouped = {};
        for (const tx of monthTxs) {
            if (!group.match(tx)) continue;
            const key = group.key(tx);
            grouped[key] = (grouped[key] || 0) + Math.abs(tx.amount || 0);
        }
        for (const [key, amount] of Object.entries(grouped)) {
            if (amount <= 0) continue;
            const id = nextId();
            const label = `${group.icon} ${key}`;
            nodes.push({ id, label, column: 2, amount, color: group.color });
            links.push({ sourceId: accountId, targetId: id, amount, color: group.color });
        }
    }

    const netDiff = totals.income - totals.outflow;
    if (netDiff > BALANCE_EPSILON) {
        const id = nextId();
        nodes.push({ id, label: 'Surplus', column: 2, amount: netDiff, color: SURPLUS_COLOR });
        links.push({ sourceId: accountId, targetId: id, amount: netDiff, color: SURPLUS_COLOR });
    } else if (netDiff < -BALANCE_EPSILON) {
        const id = nextId();
        const amount = Math.abs(netDiff);
        nodes.push({ id, label: 'Shortfall', column: 0, amount, color: SHORTFALL_COLOR });
        links.push({ sourceId: id, targetId: accountId, amount, color: SHORTFALL_COLOR });
    }

    return { nodes, links, hasData };
}

const WIDTH = 760;
const HEIGHT = 420;
const TOP_PADDING = 24;
const NODE_WIDTH = 14;
const COLUMN_X = [16, (WIDTH - NODE_WIDTH) / 2, WIDTH - NODE_WIDTH - 16];

function layoutColumn(nodes, x, scale) {
    let cursor = TOP_PADDING;
    for (const node of nodes) {
        node.x = x;
        node.y = cursor;
        node.height = node.amount * scale;
        cursor += node.height;
    }
}

// Ribbon: horizontal band from (x0, yTop..yBottom) to (x1, yTop..yBottom),
// with a soft bezier transition at the column boundary. Every link in this
// diagram touches the single Account node on one end, and the Account's
// per-link vertical offset is defined (via layoutColumn, same order/scale)
// to exactly match the leaf node's own y/height — so yTop/yBottom are the
// same at both ends and no vertical taper is needed.
function ribbonPath(x0, yTop, yBottom, x1) {
    const midX = (x0 + x1) / 2;
    return `M ${x0} ${yTop} C ${midX} ${yTop} ${midX} ${yTop} ${x1} ${yTop} ` +
        `L ${x1} ${yBottom} C ${midX} ${yBottom} ${midX} ${yBottom} ${x0} ${yBottom} Z`;
}

export function renderMoneyFlowSankey(app) {
    const container = document.getElementById('reportsMoneyFlowSankey');
    if (!container) return;

    const rptDate = getReportDate(app);
    const year = rptDate.getFullYear();
    const month = rptDate.getMonth();
    const monthLabel = rptDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const { nodes, links, hasData } = computeMoneyFlowSankeyData(app, year, month);

    if (!hasData) {
        container.innerHTML = `
            <h3 class="rpt-section-title">🌊 Money Flow — ${escapeHtml(monthLabel)}</h3>
            <p class="rpt-empty-msg">Add income, bills, debts, bonuses, expenses, or recurring items to see the money flow diagram.</p>`;
        return;
    }

    const accountNode = nodes.find(n => n.column === 1);
    const incomeNodes = nodes.filter(n => n.column === 0);
    const outflowNodes = nodes.filter(n => n.column === 2);
    const balancedTotal = accountNode.amount;
    const availableHeight = HEIGHT - TOP_PADDING * 2;
    const scale = balancedTotal > 0 ? availableHeight / balancedTotal : 0;

    layoutColumn(incomeNodes, COLUMN_X[0], scale);
    layoutColumn(outflowNodes, COLUMN_X[2], scale);
    accountNode.x = COLUMN_X[1];
    accountNode.y = TOP_PADDING;
    accountNode.height = availableHeight;

    const nodesById = {};
    for (const n of nodes) nodesById[n.id] = n;

    const isDark = document.body.classList.contains('dark-mode');
    const labelColor = isDark ? '#d1d5db' : '#374151';
    const strokeColor = isDark ? '#1f2937' : '#ffffff';

    const linkMarkup = links.map(link => {
        const source = nodesById[link.sourceId];
        const target = nodesById[link.targetId];
        const leaf = source.column === 1 ? target : source;
        const x0 = source.x + NODE_WIDTH;
        const x1 = target.x;
        const yTop = leaf.y;
        const yBottom = leaf.y + leaf.height;
        const d = ribbonPath(x0, yTop, yBottom, x1);
        const title = `${escapeHtml(source.label)} → ${escapeHtml(target.label)}: ${escapeHtml(formatCurrency(link.amount))}`;
        return `<path d="${d}" fill="${link.color}" fill-opacity="0.35" stroke="none"><title>${title}</title></path>`;
    }).join('');

    const nodeMarkup = nodes.map(node => {
        let labelX, labelY, anchor, dominantBaseline;
        if (node.column === 0) {
            labelX = node.x - 6; labelY = node.y + node.height / 2; anchor = 'end'; dominantBaseline = 'middle';
        } else if (node.column === 2) {
            labelX = node.x + NODE_WIDTH + 6; labelY = node.y + node.height / 2; anchor = 'start'; dominantBaseline = 'middle';
        } else {
            labelX = node.x + NODE_WIDTH / 2; labelY = node.y - 8; anchor = 'middle'; dominantBaseline = 'auto';
        }
        const title = `${escapeHtml(node.label)}: ${escapeHtml(formatCurrency(node.amount))}`;
        return `
            <g>
                <rect x="${node.x}" y="${node.y}" width="${NODE_WIDTH}" height="${Math.max(node.height, 0.5)}" fill="${node.color}" stroke="${strokeColor}" stroke-width="1"><title>${title}</title></rect>
                <text x="${labelX}" y="${labelY}" text-anchor="${anchor}" dominant-baseline="${dominantBaseline}" fill="${labelColor}" font-size="11">${escapeHtml(node.label)}</text>
            </g>`;
    }).join('');

    container.innerHTML = `
        <h3 class="rpt-section-title">🌊 Money Flow — ${escapeHtml(monthLabel)}</h3>
        <p class="rpt-chart-sub">How money flows from income sources, through your account, to where it goes.</p>
        <div class="mf-sankey-wrap">
            <svg id="reportsMoneyFlowSankeyDiagram" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Money flow diagram for ${escapeHtml(monthLabel)}">
                ${linkMarkup}
                ${nodeMarkup}
            </svg>
        </div>`;

    renderChartDataTable('reportsMoneyFlowSankeyDiagram', {
        caption: `Money flow — ${monthLabel}`,
        columns: ['From', 'To', 'Amount'],
        rows: links.map(link => [nodesById[link.sourceId].label, nodesById[link.targetId].label, formatCurrency(link.amount)])
    });
}
