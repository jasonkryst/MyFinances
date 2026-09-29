// Balance History modal — chart + delete-only entry table for one debt or
// Credit Card / Loan account. All user data is rendered via textContent.

import { formatCurrency, formatShortDate, renderChartDataTable } from './utils.js';
import { getBalanceHistory, deleteBalanceHistoryEntry } from './balanceHistory.js';
import { computeHistoryDeltas } from './balanceHistoryCore.js';

const CHART_KEY = '_balanceHistoryChart';

function destroyHistoryChart(app) {
    if (app[CHART_KEY]) { app[CHART_KEY].destroy(); app[CHART_KEY] = null; }
}

function findOwnerRecord(app, owner) {
    return owner.kind === 'debt'
        ? (app.debts || []).find(d => Number(d.id) === Number(owner.id))
        : (app.accounts || []).find(a => Number(a.id) === Number(owner.id));
}

function formatDelta(value) {
    if (value === null) return '—';
    return value > 0 ? `+${formatCurrency(value)}` : formatCurrency(value);
}

function renderHistoryChart(app, entries, isFixed, minLabel) {
    destroyHistoryChart(app);
    const canvas = document.getElementById('balanceHistoryChart');
    if (!canvas) return;
    // Hide the wrapper, not the canvas: Chart.js sets inline display styles on
    // the canvas itself that would override the .hidden class.
    document.getElementById('balanceHistoryChartWrap')?.classList.toggle('hidden', entries.length === 0);
    const staleTable = document.getElementById('balanceHistoryChart-sr-table');
    if (entries.length === 0) {
        if (staleTable) staleTable.remove();
        return;
    }
    if (typeof Chart === 'undefined') return;

    const dark = document.body.classList.contains('dark-mode');
    const grid = dark ? '#374151' : '#e5e7eb';
    const label = dark ? '#d1d5db' : '#374151';
    const money = v => formatCurrency(v);

    const datasets = [];
    if (!isFixed) {
        datasets.push({ label: 'Balance', data: entries.map(e => e.balance), borderColor: '#dc2626', yAxisID: 'y', tension: 0.3, pointRadius: 3 });
    }
    datasets.push({ label: minLabel, data: entries.map(e => e.minimumPayment), borderColor: '#2563eb', yAxisID: isFixed ? 'y' : 'y1', tension: 0.3, pointRadius: 3 });

    const scales = {
        x: { ticks: { color: label }, grid: { color: grid } },
        y: { position: 'left', ticks: { color: label, callback: money }, grid: { color: grid } }
    };
    if (!isFixed) scales.y1 = { position: 'right', ticks: { color: label, callback: money }, grid: { drawOnChartArea: false } };

    app[CHART_KEY] = new Chart(canvas, {
        type: 'line',
        data: { labels: entries.map(e => e.date), datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { color: label } },
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}` } }
            },
            scales
        }
    });

    renderChartDataTable('balanceHistoryChart', {
        caption: isFixed ? 'Monthly amount over time' : 'Balance and minimum payment over time',
        columns: isFixed ? ['Date', minLabel] : ['Date', 'Balance', minLabel],
        rows: entries.map(e => isFixed
            ? [e.date, formatCurrency(e.minimumPayment)]
            : [e.date, formatCurrency(e.balance), formatCurrency(e.minimumPayment)])
    });
}

function makeCell(text, labelText, className) {
    const td = document.createElement('td');
    td.textContent = text;
    td.dataset.label = labelText;
    if (className) td.className = className;
    return td;
}

function renderHistoryRows(app, owner, entries, isFixed, minLabel) {
    const tbody = document.getElementById('balanceHistoryRows');
    tbody.replaceChildren();
    const withDeltas = computeHistoryDeltas(entries);
    for (const entry of [...withDeltas].reverse()) {
        const tr = document.createElement('tr');
        tr.appendChild(makeCell(formatShortDate(entry.date), 'Date'));
        tr.appendChild(makeCell(entry.balance === null ? '—' : formatCurrency(entry.balance), 'Balance', 'bh-col-balance'));
        tr.appendChild(makeCell(formatCurrency(entry.minimumPayment), minLabel));
        const change = entry.minimumPaymentDelta === null
            ? '—'
            : isFixed
                ? formatDelta(entry.minimumPaymentDelta)
                : `Bal ${formatDelta(entry.balanceDelta)} · Min ${formatDelta(entry.minimumPaymentDelta)}`;
        tr.appendChild(makeCell(change, 'Change'));

        const actionTd = makeCell('', '');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-secondary btn-small';
        btn.textContent = 'Delete';
        btn.dataset.bhDelete = String(entry.id);
        btn.setAttribute('aria-label', `Delete entry from ${entry.date}`);
        btn.onclick = () => {
            if (btn.dataset.armed !== 'true') {
                btn.dataset.armed = 'true';
                btn.textContent = 'Confirm';
                btn.classList.remove('btn-secondary');
                btn.classList.add('btn-danger');
                return;
            }
            deleteBalanceHistoryEntry(app, entry.id);
            renderBalanceHistoryContent(app, owner);
        };
        actionTd.appendChild(btn);
        tr.appendChild(actionTd);
        tbody.appendChild(tr);
    }
}

function renderBalanceHistoryContent(app, owner) {
    const record = findOwnerRecord(app, owner);
    if (!record) return;
    const isFixed = owner.kind === 'debt' && record.debtType === 'fixedAmount';
    const minLabel = isFixed ? 'Monthly amount' : 'Min. payment';
    const entries = getBalanceHistory(app, owner);

    document.getElementById('balanceHistoryName').textContent = record.name;
    document.getElementById('bhColMin').textContent = minLabel;
    document.querySelector('#balanceHistoryModal .bh-table').classList.toggle('bh-table--fixed', isFixed);
    document.getElementById('balanceHistoryEmpty').classList.toggle('hidden', entries.length > 1);

    renderHistoryChart(app, entries, isFixed, minLabel);
    renderHistoryRows(app, owner, entries, isFixed, minLabel);
}

export function showBalanceHistoryModal(app, owner) {
    const modal = document.getElementById('balanceHistoryModal');
    if (!modal || !findOwnerRecord(app, owner)) return;

    // A prior open's keydown listener may still be registered on `document`
    // (e.g. History clicked again for another row before the first close) --
    // drop it before attaching a new one so Escape/Tab never double-fire.
    if (modal._bhKeydownHandler) document.removeEventListener('keydown', modal._bhKeydownHandler);

    const lastFocused = document.activeElement;

    // Listens on `document`, not the modal element: right after opening, focus
    // is still on the button that was clicked (outside the modal's subtree)
    // until the setTimeout below lands it on the Close button, so a keydown
    // listener scoped to the modal would miss an Escape pressed in that window.
    function onKeydown(e) {
        if (e.key === 'Escape') { close(); return; }
        if (e.key === 'Tab') {
            const focusable = modal.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])');
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (!first || !last) return;
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault(); last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault(); first.focus();
            }
        }
    }

    function close() {
        destroyHistoryChart(app);
        modal.classList.add('hidden'); modal.classList.remove('flex-visible');
        document.removeEventListener('keydown', onKeydown);
        modal._bhKeydownHandler = null;
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    }

    modal.classList.add('flex-visible'); modal.classList.remove('hidden');
    renderBalanceHistoryContent(app, owner);
    setTimeout(() => document.getElementById('balanceHistoryCloseBtn')?.focus(), 50);

    document.getElementById('balanceHistoryClose').onclick = close;
    document.getElementById('balanceHistoryCloseBtn').onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };
    modal._bhKeydownHandler = onKeydown;
    document.addEventListener('keydown', onKeydown);
}
