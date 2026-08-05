# i18n Support — Infrastructure + Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an i18n framework (locale storage, `t()` lookup with fallback, a Settings-modal language switcher, locale-aware currency/date formatting) and translate a pilot slice — nav, toolbar, Settings modal, and the Health dashboard — into Spanish and Polish.

**Architecture:** A new `src/i18n.js` module plus flat-keyed dictionaries in `src/locales/{en,es,pl}.js`. Static markup gets `data-i18n`/`data-i18n-attr` attributes applied by `applyStaticTranslations()`; the Health page calls `t()` directly when building its template literal. `formatCurrency`/`formatShortDate`/`formatMonthYear` in `utils.js` become locale-aware via `getIntlLocale()` with zero call-site changes anywhere else in the app.

**Tech Stack:** Vanilla ES6 modules, no build step, no external i18n library. Playwright (Python) for feature tests, Jest for pure-logic unit tests, matching the existing dual test setup.

## Global Constraints

- No inline `<script>`/`eval`, CSP is `script-src 'self' https://cdn.jsdelivr.net; style-src 'self'` — all dynamic text must be set via `textContent`/`setAttribute`, never `innerHTML` with unescaped content.
- Every feature module exports plain functions taking `app` as first arg where app state is needed; `DebtTrackerApp` gets a thin delegating method for any new app-facing action (matches `switchStorageBackend` pattern).
- Device UI preferences (theme, storage backend) are stored directly in `localStorage` under dedicated keys, bypassing `app.storageAdapter` — the locale preference follows this exact pattern under `debtTrackerLocale`.
- `APP_VERSION` in `src/utils.js` and the top `CHANGELOG.md` heading must move together (enforced by `tests/features/test_versioning.py`): `4.9.0` → `4.10.0`.
- Existing Jest assertions in `tests/unit/utils.test.js` (`formatCurrency(1234.5) === '$1,234.50'`, `formatShortDate('2026-08-02') === 'Aug 2, 2026'`, `formatMonthYear('2026-08-02') === 'Aug 2026'`) must keep passing unmodified — default locale must resolve to the Intl tag `'en-US'` exactly.
- `stryker.config.mjs`'s `mutate` array uses hardcoded line-range globs into `src/utils.js` (`7-78` and `241-244`) — any line inserted above those ranges must be reflected there or mutation testing silently mutates the wrong code.

---

### Task 1: Core i18n module, locale dictionaries, and unit tests

**Files:**
- Create: `src/locales/en.js`
- Create: `src/locales/es.js`
- Create: `src/locales/pl.js`
- Create: `src/i18n.js`
- Test: `tests/unit/i18n.test.js`

**Interfaces:**
- Produces (used by later tasks): `t(key, vars)`, `getCurrentLocale()`, `getIntlLocale()`, `getLocalePreference()`, `setLocalePreference(code)`, `applyStaticTranslations(root = document)`, `setLocale(app, code)`, `LOCALES` (array of `{code, name}`), `LOCALE_PREF_KEY` (string `'debtTrackerLocale'`).

- [ ] **Step 1: Create `src/locales/en.js`**

```js
// Canonical/fallback dictionary — every key used anywhere in the pilot
// scope (nav, toolbar, Settings modal, Health page) must exist here.
export default {
    'app.skipLink': 'Skip to main content',

    'toolbar.commandPaletteTitle': 'Quick jump (Ctrl+K)',
    'toolbar.commandPaletteAriaLabel': 'Open quick jump command palette',
    'toolbar.exportTitle': 'Export backup (debts, income, strategy) as JSON',
    'toolbar.exportAriaLabel': 'Export JSON',
    'toolbar.importTitle': 'Import from a previously exported JSON backup',
    'toolbar.importAriaLabel': 'Import JSON',
    'toolbar.theme': 'Theme',
    'toolbar.themeLight': '☀️ Light',
    'toolbar.themeDark': '🌙 Dark',
    'toolbar.themeHighContrast': '◐ High Contrast',
    'toolbar.settingsTitle': 'Settings',
    'toolbar.settingsAriaLabel': 'Open settings',
    'toolbar.helpTitle': 'Open usage guide',
    'toolbar.helpAriaLabel': 'Help',

    'nav.overview': 'Overview',
    'nav.manage': 'Manage',
    'nav.analyze': 'Analyze',
    'nav.health': 'Health',
    'nav.accounts': 'Accounts',
    'nav.income': 'Income',
    'nav.liabilities': 'Liabilities',
    'nav.recurring': 'Recurring',
    'nav.savings': 'Savings',
    'nav.strategy': 'Plan',
    'nav.reports': 'Reports',
    'nav.ledger': 'Ledger',
    'nav.reconcile': 'Reconcile',

    'settings.close': 'Close',
    'settings.title': 'Settings',
    'settings.reconciliationLabel': 'Reconciliations adjust the tracked balance',
    'settings.reconciliationHelp': 'When on, reconciling an account replaces its tracked balance with the statement balance you enter. When off, reconciliations are recorded and shown on the Ledger for transparency, but the tracked balance keeps being computed from your transactions.',
    'settings.dataStorageLabel': 'Data Storage',
    'settings.storageLocal': 'Local Storage (persists across visits)',
    'settings.storageSession': 'Session Storage (cleared when this tab closes)',
    'settings.dataStorageHelp': 'Local Storage keeps your data saved on this device between visits. Session Storage keeps it only for as long as this browser tab stays open, then clears it automatically when the tab closes.',
    'settings.language': 'Language',
    'settings.languageHelp': 'Translation is still expanding — some pages may remain in English.',
    'settings.done': 'Done',

    'health.title': 'Financial Health',
    'health.print': 'Print',
    'health.printTitle': 'Print this page',
    'health.printAriaLabel': 'Print the Health page',
    'health.subtitle': 'A one-glance assessment of your financial well-being for {month}.',
    'health.dtiTitle': 'Debt-to-Income Ratio',
    'health.dtiDesc': 'Monthly debt payments as a % of income. Under 28% is ideal; above 40% is a warning sign.',
    'health.dtiGaugeLabel': 'DTI',
    'health.perMonthDebt': '{amount}/mo debt',
    'health.perMonthIncome': '{amount}/mo income',
    'health.manageDebts': 'Manage debts',
    'health.savingsTitle': 'Savings Rate',
    'health.savingsDesc': 'Emergency + sinking fund contributions as a % of income. 20%+ is excellent.',
    'health.savingsGaugeLabel': 'Saved',
    'health.perMonthSaved': '{amount}/mo saved',
    'health.manageSavings': 'Manage savings',
    'health.efTitle': 'Emergency Fund Coverage',
    'health.efDesc': 'Months of expenses covered per emergency fund. 3–6 months is recommended.',
    'health.efEmptyMonths': '0 months',
    'health.efEmptySub': 'No emergency funds set up yet',
    'health.efSetUp': 'Set up emergency fund',
    'health.efManage': 'Manage emergency funds',
    'health.monthsUnit': 'mo',
    'health.unknownAccount': 'Unknown',
    'health.timelineTitle': 'Debt Payoff Timeline',
    'health.timelineDesc': 'Estimated years until debt-free at current minimum payments (avalanche strategy).',
    'health.debtFree': 'Debt Free!',
    'health.years': 'years',
    'health.estimatedPayoff': 'Estimated payoff',
    'health.originalDebtPaidOff': 'Original debt paid off',
    'health.balance': 'Balance',
    'health.monthsRemaining': 'months remaining',
    'health.unableToCalculate': 'Unable to calculate — check debt data',
    'health.goToPlan': 'Go to Plan',
    'health.cashFlowTitle': 'Monthly Cash Flow',
    'health.cashFlowDesc': 'Income versus all monthly outflows. Positive means money available after all obligations.',
    'health.income': 'Income',
    'health.debtPayments': 'Debt payments',
    'health.bills': 'Bills',
    'health.expenses': 'Expenses',
    'health.netRemaining': 'Net remaining',
    'health.viewBudget': 'View budget',
    'health.budgetTitle': 'Budget Allocation',
    'health.budgetDesc': 'Monthly spending by category as a % of income. Housing should stay under 28–36%.',
    'health.budgetEmptySub': 'Add income and expenses to see allocation',
    'health.editBudget': 'Edit budget',
    'health.perMonthSuffix': '/mo',
    'health.debtPaymentsCategory': 'Debt Payments',
    'health.otherCategory': 'Other',
    'health.status.healthy': 'Healthy',
    'health.status.moderate': 'Moderate',
    'health.status.highRisk': 'High Risk',
    'health.status.strong': 'Strong',
    'health.status.low': 'Low',
    'health.status.efExcellent': '6+ months — Excellent',
    'health.status.efGood': '3–6 months — Good',
    'health.status.efBuilding': '1–3 months — Building',
    'health.status.efCritical': 'Under 1 month — Critical',
    'health.status.onTrack': 'On Track',
    'health.status.longJourney': 'Long Journey',
    'health.status.extended': 'Extended',
    'health.status.surplus': 'Surplus',
    'health.status.breakEven': 'Break Even',
    'health.status.deficit': 'Deficit',
};
```

- [ ] **Step 2: Create `src/locales/es.js`**

```js
export default {
    'app.skipLink': 'Saltar al contenido principal',

    'toolbar.commandPaletteTitle': 'Salto rápido (Ctrl+K)',
    'toolbar.commandPaletteAriaLabel': 'Abrir paleta de comandos de salto rápido',
    'toolbar.exportTitle': 'Exportar copia de seguridad (deudas, ingresos, estrategia) como JSON',
    'toolbar.exportAriaLabel': 'Exportar JSON',
    'toolbar.importTitle': 'Importar desde una copia de seguridad JSON exportada previamente',
    'toolbar.importAriaLabel': 'Importar JSON',
    'toolbar.theme': 'Tema',
    'toolbar.themeLight': '☀️ Claro',
    'toolbar.themeDark': '🌙 Oscuro',
    'toolbar.themeHighContrast': '◐ Alto Contraste',
    'toolbar.settingsTitle': 'Configuración',
    'toolbar.settingsAriaLabel': 'Abrir configuración',
    'toolbar.helpTitle': 'Abrir guía de uso',
    'toolbar.helpAriaLabel': 'Ayuda',

    'nav.overview': 'Resumen',
    'nav.manage': 'Gestionar',
    'nav.analyze': 'Analizar',
    'nav.health': 'Salud',
    'nav.accounts': 'Cuentas',
    'nav.income': 'Ingresos',
    'nav.liabilities': 'Pasivos',
    'nav.recurring': 'Recurrentes',
    'nav.savings': 'Ahorros',
    'nav.strategy': 'Plan',
    'nav.reports': 'Informes',
    'nav.ledger': 'Libro Mayor',
    'nav.reconcile': 'Conciliar',

    'settings.close': 'Cerrar',
    'settings.title': 'Configuración',
    'settings.reconciliationLabel': 'Las conciliaciones ajustan el saldo registrado',
    'settings.reconciliationHelp': 'Cuando está activado, conciliar una cuenta reemplaza su saldo registrado con el saldo del estado de cuenta que ingreses. Cuando está desactivado, las conciliaciones se registran y se muestran en el Libro Mayor para mayor transparencia, pero el saldo registrado se sigue calculando a partir de tus transacciones.',
    'settings.dataStorageLabel': 'Almacenamiento de Datos',
    'settings.storageLocal': 'Almacenamiento Local (persiste entre visitas)',
    'settings.storageSession': 'Almacenamiento de Sesión (se borra al cerrar esta pestaña)',
    'settings.dataStorageHelp': 'El Almacenamiento Local guarda tus datos en este dispositivo entre visitas. El Almacenamiento de Sesión los conserva solo mientras esta pestaña del navegador esté abierta, y los borra automáticamente al cerrarla.',
    'settings.language': 'Idioma',
    'settings.languageHelp': 'La traducción sigue en expansión: algunas páginas pueden permanecer en inglés.',
    'settings.done': 'Listo',

    'health.title': 'Salud Financiera',
    'health.print': 'Imprimir',
    'health.printTitle': 'Imprimir esta página',
    'health.printAriaLabel': 'Imprimir la página de Salud',
    'health.subtitle': 'Una evaluación de un vistazo de tu bienestar financiero para {month}.',
    'health.dtiTitle': 'Relación Deuda-Ingreso',
    'health.dtiDesc': 'Pagos mensuales de deuda como % del ingreso. Menos del 28% es ideal; más del 40% es señal de alerta.',
    'health.dtiGaugeLabel': 'RDI',
    'health.perMonthDebt': '{amount}/mes de deuda',
    'health.perMonthIncome': '{amount}/mes de ingresos',
    'health.manageDebts': 'Gestionar deudas',
    'health.savingsTitle': 'Tasa de Ahorro',
    'health.savingsDesc': 'Aportes a fondo de emergencia + fondo de amortización como % del ingreso. 20%+ es excelente.',
    'health.savingsGaugeLabel': 'Ahorrado',
    'health.perMonthSaved': '{amount}/mes ahorrado',
    'health.manageSavings': 'Gestionar ahorros',
    'health.efTitle': 'Cobertura del Fondo de Emergencia',
    'health.efDesc': 'Meses de gastos cubiertos por fondo de emergencia. Se recomienda de 3 a 6 meses.',
    'health.efEmptyMonths': '0 meses',
    'health.efEmptySub': 'Aún no hay fondos de emergencia configurados',
    'health.efSetUp': 'Configurar fondo de emergencia',
    'health.efManage': 'Gestionar fondos de emergencia',
    'health.monthsUnit': 'mes',
    'health.unknownAccount': 'Desconocida',
    'health.timelineTitle': 'Cronograma de Pago de Deuda',
    'health.timelineDesc': 'Años estimados para quedar libre de deudas con los pagos mínimos actuales (estrategia avalancha).',
    'health.debtFree': '¡Libre de Deudas!',
    'health.years': 'años',
    'health.estimatedPayoff': 'Pago estimado',
    'health.originalDebtPaidOff': 'Deuda original pagada',
    'health.balance': 'Saldo',
    'health.monthsRemaining': 'meses restantes',
    'health.unableToCalculate': 'No se pudo calcular; revisa los datos de deuda',
    'health.goToPlan': 'Ir al Plan',
    'health.cashFlowTitle': 'Flujo de Caja Mensual',
    'health.cashFlowDesc': 'Ingresos frente a todas las salidas mensuales. Positivo significa dinero disponible después de todas las obligaciones.',
    'health.income': 'Ingresos',
    'health.debtPayments': 'Pagos de deuda',
    'health.bills': 'Facturas',
    'health.expenses': 'Gastos',
    'health.netRemaining': 'Neto restante',
    'health.viewBudget': 'Ver presupuesto',
    'health.budgetTitle': 'Asignación de Presupuesto',
    'health.budgetDesc': 'Gasto mensual por categoría como % del ingreso. La vivienda debe mantenerse por debajo del 28–36%.',
    'health.budgetEmptySub': 'Agrega ingresos y gastos para ver la asignación',
    'health.editBudget': 'Editar presupuesto',
    'health.perMonthSuffix': '/mes',
    'health.debtPaymentsCategory': 'Pagos de Deuda',
    'health.otherCategory': 'Otro',
    'health.status.healthy': 'Saludable',
    'health.status.moderate': 'Moderado',
    'health.status.highRisk': 'Alto Riesgo',
    'health.status.strong': 'Sólido',
    'health.status.low': 'Bajo',
    'health.status.efExcellent': '6+ meses — Excelente',
    'health.status.efGood': '3–6 meses — Bueno',
    'health.status.efBuilding': '1–3 meses — En Construcción',
    'health.status.efCritical': 'Menos de 1 mes — Crítico',
    'health.status.onTrack': 'En Camino',
    'health.status.longJourney': 'Camino Largo',
    'health.status.extended': 'Extendido',
    'health.status.surplus': 'Superávit',
    'health.status.breakEven': 'Punto de Equilibrio',
    'health.status.deficit': 'Déficit',
};
```

- [ ] **Step 3: Create `src/locales/pl.js`**

```js
export default {
    'app.skipLink': 'Przejdź do głównej treści',

    'toolbar.commandPaletteTitle': 'Szybkie przejście (Ctrl+K)',
    'toolbar.commandPaletteAriaLabel': 'Otwórz panel szybkich poleceń',
    'toolbar.exportTitle': 'Eksportuj kopię zapasową (długi, dochody, strategia) jako JSON',
    'toolbar.exportAriaLabel': 'Eksportuj JSON',
    'toolbar.importTitle': 'Importuj z wcześniej wyeksportowanej kopii zapasowej JSON',
    'toolbar.importAriaLabel': 'Importuj JSON',
    'toolbar.theme': 'Motyw',
    'toolbar.themeLight': '☀️ Jasny',
    'toolbar.themeDark': '🌙 Ciemny',
    'toolbar.themeHighContrast': '◐ Wysoki Kontrast',
    'toolbar.settingsTitle': 'Ustawienia',
    'toolbar.settingsAriaLabel': 'Otwórz ustawienia',
    'toolbar.helpTitle': 'Otwórz przewodnik użytkowania',
    'toolbar.helpAriaLabel': 'Pomoc',

    'nav.overview': 'Przegląd',
    'nav.manage': 'Zarządzaj',
    'nav.analyze': 'Analizuj',
    'nav.health': 'Kondycja',
    'nav.accounts': 'Konta',
    'nav.income': 'Dochody',
    'nav.liabilities': 'Zobowiązania',
    'nav.recurring': 'Cykliczne',
    'nav.savings': 'Oszczędności',
    'nav.strategy': 'Plan',
    'nav.reports': 'Raporty',
    'nav.ledger': 'Rejestr',
    'nav.reconcile': 'Uzgadnianie',

    'settings.close': 'Zamknij',
    'settings.title': 'Ustawienia',
    'settings.reconciliationLabel': 'Uzgodnienia korygują śledzone saldo',
    'settings.reconciliationHelp': 'Gdy włączone, uzgodnienie konta zastępuje śledzone saldo saldem z wyciągu, które wprowadzisz. Gdy wyłączone, uzgodnienia są rejestrowane i wyświetlane w Rejestrze dla przejrzystości, ale śledzone saldo jest nadal obliczane na podstawie Twoich transakcji.',
    'settings.dataStorageLabel': 'Przechowywanie Danych',
    'settings.storageLocal': 'Pamięć Lokalna (zachowywana między wizytami)',
    'settings.storageSession': 'Pamięć Sesji (czyszczona po zamknięciu karty)',
    'settings.dataStorageHelp': 'Pamięć Lokalna zachowuje Twoje dane na tym urządzeniu między wizytami. Pamięć Sesji przechowuje je tylko podczas gdy ta karta przeglądarki jest otwarta, a następnie automatycznie czyści po jej zamknięciu.',
    'settings.language': 'Język',
    'settings.languageHelp': 'Tłumaczenie jest wciąż rozszerzane — niektóre strony mogą pozostać w języku angielskim.',
    'settings.done': 'Gotowe',

    'health.title': 'Kondycja Finansowa',
    'health.print': 'Drukuj',
    'health.printTitle': 'Drukuj tę stronę',
    'health.printAriaLabel': 'Drukuj stronę Kondycji',
    'health.subtitle': 'Ocena Twojej kondycji finansowej na pierwszy rzut oka za {month}.',
    'health.dtiTitle': 'Wskaźnik Zadłużenia do Dochodu',
    'health.dtiDesc': 'Miesięczne spłaty długu jako % dochodu. Poniżej 28% jest idealne; powyżej 40% to sygnał ostrzegawczy.',
    'health.dtiGaugeLabel': 'WZD',
    'health.perMonthDebt': '{amount}/mies. długu',
    'health.perMonthIncome': '{amount}/mies. dochodu',
    'health.manageDebts': 'Zarządzaj długami',
    'health.savingsTitle': 'Wskaźnik Oszczędności',
    'health.savingsDesc': 'Wpłaty na fundusz awaryjny + fundusz celowy jako % dochodu. 20%+ jest doskonałe.',
    'health.savingsGaugeLabel': 'Zaoszczędzone',
    'health.perMonthSaved': '{amount}/mies. zaoszczędzone',
    'health.manageSavings': 'Zarządzaj oszczędnościami',
    'health.efTitle': 'Pokrycie Funduszu Awaryjnego',
    'health.efDesc': 'Miesiące wydatków pokryte przez fundusz awaryjny. Zalecane 3–6 miesięcy.',
    'health.efEmptyMonths': '0 miesięcy',
    'health.efEmptySub': 'Nie skonfigurowano jeszcze funduszu awaryjnego',
    'health.efSetUp': 'Skonfiguruj fundusz awaryjny',
    'health.efManage': 'Zarządzaj funduszami awaryjnymi',
    'health.monthsUnit': 'mies.',
    'health.unknownAccount': 'Nieznane',
    'health.timelineTitle': 'Harmonogram Spłaty Długu',
    'health.timelineDesc': 'Szacowana liczba lat do spłaty długu przy obecnych minimalnych płatnościach (strategia lawiny).',
    'health.debtFree': 'Bez Długów!',
    'health.years': 'lat',
    'health.estimatedPayoff': 'Szacowana spłata',
    'health.originalDebtPaidOff': 'Spłacony dług pierwotny',
    'health.balance': 'Saldo',
    'health.monthsRemaining': 'miesięcy pozostało',
    'health.unableToCalculate': 'Nie można obliczyć — sprawdź dane zadłużenia',
    'health.goToPlan': 'Przejdź do Planu',
    'health.cashFlowTitle': 'Miesięczny Przepływ Gotówki',
    'health.cashFlowDesc': 'Dochód w porównaniu do wszystkich miesięcznych wydatków. Wartość dodatnia oznacza dostępne środki po pokryciu wszystkich zobowiązań.',
    'health.income': 'Dochód',
    'health.debtPayments': 'Spłaty długu',
    'health.bills': 'Rachunki',
    'health.expenses': 'Wydatki',
    'health.netRemaining': 'Pozostało netto',
    'health.viewBudget': 'Zobacz budżet',
    'health.budgetTitle': 'Podział Budżetu',
    'health.budgetDesc': 'Miesięczne wydatki według kategorii jako % dochodu. Mieszkanie powinno pozostać poniżej 28–36%.',
    'health.budgetEmptySub': 'Dodaj dochody i wydatki, aby zobaczyć podział',
    'health.editBudget': 'Edytuj budżet',
    'health.perMonthSuffix': '/mies.',
    'health.debtPaymentsCategory': 'Spłaty Długu',
    'health.otherCategory': 'Inne',
    'health.status.healthy': 'Zdrowy',
    'health.status.moderate': 'Umiarkowany',
    'health.status.highRisk': 'Wysokie Ryzyko',
    'health.status.strong': 'Mocny',
    'health.status.low': 'Niski',
    'health.status.efExcellent': '6+ miesięcy — Doskonały',
    'health.status.efGood': '3–6 miesięcy — Dobry',
    'health.status.efBuilding': '1–3 miesiące — Budowanie',
    'health.status.efCritical': 'Poniżej 1 miesiąca — Krytyczny',
    'health.status.onTrack': 'Na Dobrej Drodze',
    'health.status.longJourney': 'Długa Droga',
    'health.status.extended': 'Przedłużony',
    'health.status.surplus': 'Nadwyżka',
    'health.status.breakEven': 'Próg Rentowności',
    'health.status.deficit': 'Deficyt',
};
```

- [ ] **Step 4: Create `src/i18n.js`**

```js
// Locale storage, string lookup with fallback, and static-markup translation.
// The locale *preference* is stored directly in localStorage under its own
// key (like debtTrackerTheme/debtTrackerStorageBackend) — a device display
// preference, not financial data, independent of app.storageAdapter.
import en from './locales/en.js';
import es from './locales/es.js';
import pl from './locales/pl.js';

export const LOCALES = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
    { code: 'pl', name: 'Polski' },
];
export const LOCALE_PREF_KEY = 'debtTrackerLocale';

const LOCALE_CODES = LOCALES.map(l => l.code);
const DEFAULT_LOCALE = 'en';
const DICTIONARIES = { en, es, pl };
// Intl locale tags used for Intl.NumberFormat/toLocaleDateString — kept
// separate from the app-facing short codes so the default ('en') resolves
// to exactly 'en-US', matching this app's pre-i18n hardcoded formatting.
const INTL_LOCALES = { en: 'en-US', es: 'es-ES', pl: 'pl-PL' };

function readStoredLocale() {
    try {
        const stored = localStorage.getItem(LOCALE_PREF_KEY);
        return LOCALE_CODES.includes(stored) ? stored : DEFAULT_LOCALE;
    } catch (_) {
        // localStorage unavailable (blocked, or a non-browser test runner) —
        // fall back to the default rather than throwing.
        return DEFAULT_LOCALE;
    }
}

let currentLocale = readStoredLocale();

export function getLocalePreference() {
    return readStoredLocale();
}

export function setLocalePreference(code) {
    const normalized = LOCALE_CODES.includes(code) ? code : DEFAULT_LOCALE;
    try {
        localStorage.setItem(LOCALE_PREF_KEY, normalized);
    } catch (_) { /* storage unavailable/blocked — locale still applies in-memory */ }
    return normalized;
}

export function getCurrentLocale() {
    return currentLocale;
}

export function getIntlLocale() {
    return INTL_LOCALES[currentLocale] || INTL_LOCALES[DEFAULT_LOCALE];
}

// Looks up `key` in the current locale's dictionary, falling back to the
// English dictionary, then to the raw key itself — a missing/mistyped key
// never throws or renders blank/undefined. `{token}` placeholders in the
// resolved string are replaced from `vars`; an unmatched placeholder is
// left as-is rather than silently dropped.
export function t(key, vars = {}) {
    const dict = DICTIONARIES[currentLocale] || DICTIONARIES[DEFAULT_LOCALE];
    const template = dict[key] ?? DICTIONARIES[DEFAULT_LOCALE][key] ?? key;
    return template.replace(/\{(\w+)\}/g, (match, name) =>
        (vars[name] !== undefined ? String(vars[name]) : match));
}

// Walks `[data-i18n]` (textContent) and `[data-i18n-attr]` (one or more
// "attr:key" pairs, comma-separated, e.g. "title:toolbar.settingsTitle,aria-label:toolbar.settingsAriaLabel")
// elements under `root` and applies the current locale's translations.
// Uses textContent/setAttribute only — never innerHTML — so no escaping is
// needed and the strict CSP is unaffected.
export function applyStaticTranslations(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-attr]').forEach(el => {
        el.getAttribute('data-i18n-attr').split(',').forEach(pair => {
            const [attr, key] = pair.split(':').map(s => s.trim());
            if (attr && key) el.setAttribute(attr, t(key));
        });
    });
}

// Persists the new locale, re-applies static translations, and re-renders
// the Health page (the only dynamic pilot content) if it's currently the
// active section.
export function setLocale(app, code) {
    currentLocale = LOCALE_CODES.includes(code) ? code : DEFAULT_LOCALE;
    setLocalePreference(currentLocale);
    applyStaticTranslations();
    const healthSection = document.getElementById('healthSection');
    if (app && healthSection && healthSection.classList.contains('active')
        && typeof app.renderHealthDashboard === 'function') {
        app.renderHealthDashboard();
    }
    return currentLocale;
}
```

- [ ] **Step 5: Write the Jest unit tests**

```js
// tests/unit/i18n.test.js
const { t, getCurrentLocale, LOCALES, LOCALE_PREF_KEY } = require('../../src/i18n.js');

describe('t()', () => {
    test('returns the English string for a known key with no localStorage/browser locale set', () => {
        expect(getCurrentLocale()).toBe('en');
        expect(t('nav.health')).toBe('Health');
    });

    test('interpolates a {token} placeholder from vars', () => {
        expect(t('health.perMonthSuffix')).toBe('/mo');
        expect(t('health.subtitle', { month: 'August 2026' }))
            .toBe('A one-glance assessment of your financial well-being for August 2026.');
    });

    test('leaves an unmatched {token} placeholder untouched rather than dropping it', () => {
        expect(t('health.subtitle', {})).toBe(
            'A one-glance assessment of your financial well-being for {month}.'
        );
    });

    test('falls back to the raw key for a key that exists in no dictionary, rather than throwing or returning blank/undefined', () => {
        expect(t('this.key.does.not.exist')).toBe('this.key.does.not.exist');
    });
});

describe('LOCALES', () => {
    test('exposes exactly the three pilot locales', () => {
        expect(LOCALES.map(l => l.code)).toEqual(['en', 'es', 'pl']);
    });
});

describe('LOCALE_PREF_KEY', () => {
    test('is the dedicated localStorage key, matching the debtTrackerTheme/debtTrackerStorageBackend pattern', () => {
        expect(LOCALE_PREF_KEY).toBe('debtTrackerLocale');
    });
});
```

- [ ] **Step 6: Run the new Jest tests and confirm they pass**

Run: `npm run test:unit -- i18n.test.js`
Expected: all 5 tests in `tests/unit/i18n.test.js` PASS. (There is no prior implementation to fail against — `src/i18n.js` was written in Step 4 — so this step is a pass-confirmation, not a red/green cycle.)

- [ ] **Step 7: Commit**

```bash
git add src/locales/en.js src/locales/es.js src/locales/pl.js src/i18n.js tests/unit/i18n.test.js
git commit -m "Add i18n core module and en/es/pl locale dictionaries (#35)"
```

---

### Task 2: Wire static-markup translation and the Settings-modal language switcher

**Files:**
- Modify: `index.html`
- Modify: `src/setupWizard.js`
- Modify: `src/app.js`
- Test: `tests/features/test_i18n.py` (created here, extended in Task 5)

**Interfaces:**
- Consumes: `applyStaticTranslations()`, `setLocale(app, code)`, `getCurrentLocale()`, `LOCALES`, `LOCALE_PREF_KEY` from Task 1's `src/i18n.js`.
- Produces: `DebtTrackerApp.setLocale(code)` delegating method (used by Task 5's tests and by `setupWizard.js`).

- [ ] **Step 1: Add `data-i18n`/`data-i18n-attr` attributes to the toolbar in `index.html`**

Replace lines 15, 21, 25, 28, 33-41 (skip link through the toolbar's Settings/Help buttons) with:

```html
    <a href="#main" class="skip-link" data-i18n="app.skipLink">Skip to main content</a>
```
```html
                    <button id="commandPaletteBtn" class="header-icon-btn" data-i18n-attr="title:toolbar.commandPaletteTitle,aria-label:toolbar.commandPaletteAriaLabel" title="Quick jump (Ctrl+K)" aria-label="Open quick jump command palette">
```
```html
                    <button id="exportJsonBtn" class="header-icon-btn" data-i18n-attr="title:toolbar.exportTitle,aria-label:toolbar.exportAriaLabel" title="Export backup (debts, income, strategy) as JSON" aria-label="Export JSON">
```
```html
                    <button id="importJsonBtn" class="header-icon-btn" data-i18n-attr="title:toolbar.importTitle,aria-label:toolbar.importAriaLabel" title="Import from a previously exported JSON backup" aria-label="Import JSON">
```
```html
                    <label for="themeSwitcher" class="sr-only" data-i18n="toolbar.theme">Theme</label>
                    <select id="themeSwitcher" class="header-theme-select" data-i18n-attr="aria-label:toolbar.theme" aria-label="Theme">
                        <option value="light" data-i18n="toolbar.themeLight">☀️ Light</option>
                        <option value="dark" data-i18n="toolbar.themeDark">🌙 Dark</option>
                        <option value="high-contrast" data-i18n="toolbar.themeHighContrast">◐ High Contrast</option>
                    </select>
                    <div class="header-toolbar-divider"></div>
                    <button id="settingsBtn" class="header-icon-btn" data-i18n-attr="title:toolbar.settingsTitle,aria-label:toolbar.settingsAriaLabel" title="Settings" aria-label="Open settings">⚙️</button>
                    <a id="helpBtn" class="header-icon-btn" data-i18n-attr="title:toolbar.helpTitle,aria-label:toolbar.helpAriaLabel" title="Open usage guide" aria-label="Help" href="guide.html" target="_blank" rel="noopener noreferrer">❓</a>
```

- [ ] **Step 2: Add `data-i18n` attributes to the nav in `index.html`**

Replace lines 68-92 (the three nav groups) with:

```html
                    <div class="nav-group">
                        <span class="nav-group-label" data-i18n="nav.overview">Overview</span>
                        <div class="nav-group-btns">
                            <button class="page-button" data-page="health" data-i18n="nav.health" aria-current="page">Health</button>
                            <button class="page-button" data-page="accounts" data-i18n="nav.accounts">Accounts</button>
                            <button class="page-button" data-page="income" data-i18n="nav.income">Income</button>
                        </div>
                    </div>
                    <div class="nav-group-sep" aria-hidden="true"></div>
                    <div class="nav-group">
                        <span class="nav-group-label" data-i18n="nav.manage">Manage</span>
                        <div class="nav-group-btns">
                            <button class="page-button" data-page="liabilities" data-i18n="nav.liabilities">Liabilities</button>
                            <button class="page-button" data-page="recurring" data-i18n="nav.recurring">Recurring</button>
                            <button class="page-button" data-page="savings" data-i18n="nav.savings">Savings</button>
                            <button class="page-button" data-page="strategy" data-i18n="nav.strategy">Plan</button>
                        </div>
                    </div>
                    <div class="nav-group-sep" aria-hidden="true"></div>
                    <div class="nav-group">
                        <span class="nav-group-label" data-i18n="nav.analyze">Analyze</span>
                        <div class="nav-group-btns">
                            <button class="page-button" data-page="reports" data-i18n="nav.reports">Reports</button>
                            <button class="page-button" data-page="ledger" data-i18n="nav.ledger">Ledger</button>
                            <button class="page-button" data-page="reconcile" data-i18n="nav.reconcile">Reconcile</button>
                        </div>
                    </div>
```

- [ ] **Step 3: Add `data-i18n` attributes and the language selector to the Settings modal in `index.html`**

Replace lines 1026-1049 (the whole `#settingsModal` block) with:

```html
    <div id="settingsModal" class="modal modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="settingsModalTitle" tabindex="-1">
        <div class="modal-content">
            <button id="settingsModalCloseBtn" data-i18n-attr="aria-label:settings.close" aria-label="Close" class="modal-close">&times;</button>
            <h3 id="settingsModalTitle" data-i18n="settings.title">Settings</h3>
            <div class="form-group modal-form-group">
                <label class="settings-toggle-row" for="settingReconciliationAdjusts">
                    <input type="checkbox" id="settingReconciliationAdjusts">
                    <span data-i18n="settings.reconciliationLabel">Reconciliations adjust the tracked balance</span>
                </label>
                <p class="modal-helper-text" data-i18n="settings.reconciliationHelp">When on, reconciling an account replaces its tracked balance with the statement balance you enter. When off, reconciliations are recorded and shown on the Ledger for transparency, but the tracked balance keeps being computed from your transactions.</p>
            </div>
            <div class="form-group modal-form-group">
                <label for="settingStorageBackend" data-i18n="settings.dataStorageLabel">Data Storage</label>
                <select id="settingStorageBackend">
                    <option value="local" data-i18n="settings.storageLocal">Local Storage (persists across visits)</option>
                    <option value="session" data-i18n="settings.storageSession">Session Storage (cleared when this tab closes)</option>
                </select>
                <p class="modal-helper-text" data-i18n="settings.dataStorageHelp">Local Storage keeps your data saved on this device between visits. Session Storage keeps it only for as long as this browser tab stays open, then clears it automatically when the tab closes.</p>
            </div>
            <div class="form-group modal-form-group">
                <label for="settingLocale" data-i18n="settings.language">Language</label>
                <select id="settingLocale">
                    <option value="en">English</option>
                    <option value="es">Español</option>
                    <option value="pl">Polski</option>
                </select>
                <p class="modal-helper-text" data-i18n="settings.languageHelp">Translation is still expanding — some pages may remain in English.</p>
            </div>
            <div class="modal-actions">
                <button id="settingsModalDoneBtn" class="btn btn-success" data-i18n="settings.done">Done</button>
            </div>
        </div>
    </div>
```

Note: the language `<option>` labels ("English", "Español", "Polski") intentionally have no `data-i18n` — a language picker should always show each option in its own language, regardless of the current UI locale, so a user can find their language even if the current locale renders differently than expected.

- [ ] **Step 4: Wire the language selector in `src/setupWizard.js`**

In `initSettingsModal`, add `localeSelect` alongside the existing element lookups, initialize it in `open()`, and persist it in `save()`:

```js
import { getSetting, setSetting, RECONCILIATION_ADJUSTS_BALANCE } from './settings.js';
import { getStorageBackendPreference } from './storageAdapters.js';
import { getCurrentLocale } from './i18n.js';
```

```js
export function initSettingsModal(app) {
    const modal = document.getElementById('settingsModal');
    const settingsBtn = document.getElementById('settingsBtn');
    const closeBtn = document.getElementById('settingsModalCloseBtn');
    const doneBtn = document.getElementById('settingsModalDoneBtn');
    const adjustsCheckbox = document.getElementById('settingReconciliationAdjusts');
    const storageSelect = document.getElementById('settingStorageBackend');
    const localeSelect = document.getElementById('settingLocale');
    if (!modal || !settingsBtn || !closeBtn || !doneBtn || !adjustsCheckbox || !storageSelect || !localeSelect) return;

    let lastFocused = null;

    const close = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex-visible');
        modal.onkeydown = null;
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };

    const open = () => {
        lastFocused = document.activeElement;
        adjustsCheckbox.checked = Boolean(getSetting(app, RECONCILIATION_ADJUSTS_BALANCE, false));
        storageSelect.value = getStorageBackendPreference();
        localeSelect.value = getCurrentLocale();
        modal.classList.add('flex-visible');
        modal.classList.remove('hidden');
        modal.onkeydown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
            }
        };
        setTimeout(() => adjustsCheckbox.focus(), 30);
    };

    const save = () => {
        setSetting(app, RECONCILIATION_ADJUSTS_BALANCE, adjustsCheckbox.checked);
        app.switchStorageBackend(storageSelect.value);
        app.setLocale(localeSelect.value);
        close();
    };

    settingsBtn.onclick = open;
    closeBtn.onclick = close;
    doneBtn.onclick = save;
    modal.onclick = (event) => {
        if (event.target === modal) close();
    };
}
```

- [ ] **Step 5: Add `applyStaticTranslations()` call and `setLocale` delegating method in `src/app.js`**

Add the import alongside the other feature-module imports (near the `setupWizard.js` import at line 115):

```js
import { applyStaticTranslations, setLocale as setLocaleFeature } from './i18n.js';
```

In the constructor, call it once early — right after the reduced-motion block and before `this.initializeEventListeners();` (around line 168-171):

```js
        applyStaticTranslations();

        const isFirstRun = this.storageAdapter.get(this.storageKey) === null;
```

Add the thin delegating method near `switchStorageBackend` (around line 538):

```js
    setLocale(code) {
        return setLocaleFeature(this, code);
    }
```

- [ ] **Step 6: Write the first Playwright tests in `tests/features/test_i18n.py`**

```python
#!/usr/bin/env python3
"""
i18n Tests
src/i18n.js provides locale storage (debtTrackerLocale in localStorage,
mirroring the debtTrackerTheme/debtTrackerStorageBackend pattern), t()
lookup with English fallback, and applyStaticTranslations() for [data-i18n]
markup. The pilot translates nav/toolbar/Settings modal/Health page into
Spanish (es) and Polish (pl); other pages remain English.
"""

import pytest

from tests.conftest import BASE_URL


@pytest.mark.feature
def test_default_locale_is_english(app_page):
    """With no debtTrackerLocale preference set, the app renders in English."""
    page = app_page

    nav_text = page.inner_text('.page-button[data-page="health"]')
    assert nav_text.strip() == 'Health'

    locale = page.evaluate("() => localStorage.getItem('debtTrackerLocale')")
    assert locale is None


@pytest.mark.feature
def test_settings_modal_has_language_selector_with_three_options(app_page):
    """The Settings modal exposes a language <select> with en/es/pl options."""
    page = app_page

    page.click('#settingsBtn')
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)

    values = page.eval_on_selector_all(
        '#settingLocale option', 'opts => opts.map(o => o.value)'
    )
    assert values == ['en', 'es', 'pl']

    current = page.evaluate("() => document.getElementById('settingLocale').value")
    assert current == 'en'


@pytest.mark.feature
def test_switching_to_spanish_translates_nav_and_persists(app_page):
    """Selecting Spanish and clicking Done translates the nav immediately
    and persists debtTrackerLocale to localStorage."""
    page = app_page

    page.click('#settingsBtn')
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)
    page.select_option('#settingLocale', 'es')
    page.click('#settingsModalDoneBtn')
    page.wait_for_timeout(200)

    nav_text = page.inner_text('.page-button[data-page="health"]')
    assert nav_text.strip() == 'Salud'

    locale = page.evaluate("() => localStorage.getItem('debtTrackerLocale')")
    assert locale == 'es'


@pytest.mark.feature
def test_switching_to_polish_translates_nav_and_persists(app_page):
    """Selecting Polish and clicking Done translates the nav immediately
    and persists debtTrackerLocale to localStorage."""
    page = app_page

    page.click('#settingsBtn')
    page.wait_for_selector('#settingsModal.flex-visible', timeout=5000)
    page.select_option('#settingLocale', 'pl')
    page.click('#settingsModalDoneBtn')
    page.wait_for_timeout(200)

    nav_text = page.inner_text('.page-button[data-page="health"]')
    assert nav_text.strip() == 'Kondycja'

    locale = page.evaluate("() => localStorage.getItem('debtTrackerLocale')")
    assert locale == 'pl'


@pytest.mark.feature
def test_locale_preference_persists_across_reload(page):
    """A previously-chosen locale is re-applied on the next page load."""
    page.add_init_script("""
        try { localStorage.setItem('debtTrackerLocale', 'es'); } catch (e) {}
    """)
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)

    nav_text = page.inner_text('.page-button[data-page="health"]')
    assert nav_text.strip() == 'Salud'


@pytest.mark.feature
def test_invalid_stored_locale_falls_back_to_english(page):
    """A tampered/invalid debtTrackerLocale value doesn't crash the app or
    leave it in a broken state — it silently falls back to English."""
    page.add_init_script("""
        try { localStorage.setItem('debtTrackerLocale', 'xx-BOGUS'); } catch (e) {}
    """)
    page.goto(BASE_URL, wait_until="networkidle", timeout=60000)

    nav_text = page.inner_text('.page-button[data-page="health"]')
    assert nav_text.strip() == 'Health'


@pytest.mark.feature
def test_untranslated_page_stays_readable_in_english_when_locale_is_spanish(app_page):
    """Accounts has no data-i18n markup yet (out of pilot scope) — switching
    to Spanish must not leave it blank or broken, just still in English."""
    page = app_page

    page.evaluate("() => window.app.setLocale('es')")
    page.click('.page-button[data-page="accounts"]')
    page.wait_for_timeout(200)

    heading = page.inner_text('#accountsSection h2')
    assert heading.strip() != ''
```

- [ ] **Step 7: Start the local server and run the new tests**

Run: `python -m http.server 5500` (in a separate terminal/background process, from the repo root)
Run: `pytest tests/features/test_i18n.py -v`
Expected: all 7 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add index.html src/setupWizard.js src/app.js tests/features/test_i18n.py
git commit -m "Wire static-markup translation and Settings-modal language switcher (#35)"
```

---

### Task 3: Translate the Health dashboard

**Files:**
- Modify: `src/health.js`
- Modify: `tests/features/test_i18n.py` (extend with Health-page assertions)

**Interfaces:**
- Consumes: `t(key, vars)`, `getIntlLocale()` from `src/i18n.js` (Task 1).

- [ ] **Step 1: Import `t`/`getIntlLocale` and translate the status-label helper functions**

At the top of `src/health.js`, change:

```js
import { computeMonthlyIncomeForMonth, formatCurrency, escapeHtml, renderChartDataTable } from './utils.js';
```

to:

```js
import { computeMonthlyIncomeForMonth, formatCurrency, escapeHtml, renderChartDataTable } from './utils.js';
import { t, getIntlLocale } from './i18n.js';
```

Replace the six status-label helper functions (originally lines 3-32) with:

```js
function dtiStatus(ratio) {
    if (ratio < 0.28) return { cls: 'health-status--green', label: t('health.status.healthy') };
    if (ratio < 0.40) return { cls: 'health-status--yellow', label: t('health.status.moderate') };
    return { cls: 'health-status--red', label: t('health.status.highRisk') };
}

function savingsStatus(ratio) {
    if (ratio >= 0.20) return { cls: 'health-status--green', label: t('health.status.strong') };
    if (ratio >= 0.10) return { cls: 'health-status--yellow', label: t('health.status.moderate') };
    return { cls: 'health-status--red', label: t('health.status.low') };
}

function emergencyStatus(months) {
    if (months >= 6) return { cls: 'health-status--green', label: t('health.status.efExcellent') };
    if (months >= 3) return { cls: 'health-status--green', label: t('health.status.efGood') };
    if (months >= 1) return { cls: 'health-status--yellow', label: t('health.status.efBuilding') };
    return { cls: 'health-status--red', label: t('health.status.efCritical') };
}

function timelineStatus(months) {
    if (months <= 24) return { cls: 'health-status--green', label: t('health.status.onTrack') };
    if (months <= 60) return { cls: 'health-status--yellow', label: t('health.status.longJourney') };
    return { cls: 'health-status--red', label: t('health.status.extended') };
}

function cashFlowStatus(net) {
    if (net > 0) return { cls: 'health-status--green', label: t('health.status.surplus') };
    if (net === 0) return { cls: 'health-status--yellow', label: t('health.status.breakEven') };
    return { cls: 'health-status--red', label: t('health.status.deficit') };
}
```

(`budgetCategoryStatusCls`, `statusFillCls`, `gaugeColor` are unchanged — no translatable text.)

- [ ] **Step 2: Translate the category-grouping logic in `renderHealthDashboard`**

Replace the "Budget Allocation" data-prep block (originally lines 123-148):

```js
    // ── Budget Allocation ──────────────────────────────────────────────────────
    const otherLabel = t('health.otherCategory');
    const billCatMap = {};
    for (const b of (app.bills || [])) {
        const cat = b.category || otherLabel;
        billCatMap[cat] = (billCatMap[cat] || 0) + (b.amount || 0);
    }
    const expCatMap = {};
    for (const e of (app.expenses || [])) {
        const cat = e.category || otherLabel;
        expCatMap[cat] = (expCatMap[cat] || 0) + (e.budgetAmount || 0);
    }
    const allCats = new Set([...Object.keys(billCatMap), ...Object.keys(expCatMap)]);
    const budgetCategories = [];
    for (const cat of allCats) {
        const total = (billCatMap[cat] || 0) + (expCatMap[cat] || 0);
        const pct   = monthlyIncome > 0 ? total / monthlyIncome : 0;
        budgetCategories.push({ cat, total, pct });
    }
    budgetCategories.sort((a, b) => b.total - a.total);
    if (totalDebtMin > 0) {
        budgetCategories.unshift({
            cat: t('health.debtPaymentsCategory'), total: totalDebtMin,
            pct: monthlyIncome > 0 ? totalDebtMin / monthlyIncome : 0,
            isDebt: true
        });
    }
```

- [ ] **Step 3: Add the locale-aware subtitle date and translate the full template literal**

Immediately before the `// ── HTML ──` comment (originally line 152), add:

```js
    const monthYearLong = now.toLocaleDateString(getIntlLocale(), { month: 'long', year: 'numeric' });
```

Replace the entire `section.innerHTML = \`...\`;` template literal (originally lines 153-339) with:

```js
    section.innerHTML = `
        <div class="health-header">
            <div class="page-header-row">
                <h2>${t('health.title')}</h2>
                <button type="button" class="page-print-btn" id="healthPrintBtn" title="${t('health.printTitle')}" aria-label="${t('health.printAriaLabel')}">🖨️ ${t('health.print')}</button>
            </div>
            <p class="health-subtitle">${t('health.subtitle', { month: monthYearLong })}</p>
        </div>
        <div class="health-metrics-grid">

            <!-- Debt-to-Income Ratio -->
            <div class="health-metric-card">
                <div class="health-card-header">
                    <span class="health-card-title">${t('health.dtiTitle')}</span>
                    <span class="health-badge ${dtiSt.cls}">${dtiSt.label}</span>
                </div>
                <p class="health-card-desc">${t('health.dtiDesc')}</p>
                <div class="health-gauge-wrap">
                    <canvas id="healthDtiGauge" class="health-gauge-canvas"></canvas>
                    <div class="health-gauge-center">
                        <span class="health-gauge-value">${dtiPct.toFixed(1)}%</span>
                        <span class="health-gauge-label">${t('health.dtiGaugeLabel')}</span>
                    </div>
                </div>
                <div class="health-metric-detail">
                    <span>${t('health.perMonthDebt', { amount: formatCurrency(totalDebtMin) })}</span>
                    <span>${t('health.perMonthIncome', { amount: formatCurrency(monthlyIncome) })}</span>
                </div>
                <a class="health-link" data-health-nav="liabilities">${t('health.manageDebts')} &rarr;</a>
            </div>

            <!-- Savings Rate -->
            <div class="health-metric-card">
                <div class="health-card-header">
                    <span class="health-card-title">${t('health.savingsTitle')}</span>
                    <span class="health-badge ${savingsSt.cls}">${savingsSt.label}</span>
                </div>
                <p class="health-card-desc">${t('health.savingsDesc')}</p>
                <div class="health-gauge-wrap">
                    <canvas id="healthSavingsGauge" class="health-gauge-canvas"></canvas>
                    <div class="health-gauge-center">
                        <span class="health-gauge-value">${savingsPct.toFixed(1)}%</span>
                        <span class="health-gauge-label">${t('health.savingsGaugeLabel')}</span>
                    </div>
                </div>
                <div class="health-metric-detail">
                    <span>${t('health.perMonthSaved', { amount: formatCurrency(totalSavingsContrib) })}</span>
                    <span>${t('health.perMonthIncome', { amount: formatCurrency(monthlyIncome) })}</span>
                </div>
                <a class="health-link" data-health-nav="savings">${t('health.manageSavings')} &rarr;</a>
            </div>

            <!-- Emergency Fund Coverage -->
            <div class="health-metric-card">
                <div class="health-card-header">
                    <span class="health-card-title">${t('health.efTitle')}</span>
                </div>
                <p class="health-card-desc">${t('health.efDesc')}</p>
                ${emergencyFunds.length === 0 ? `
                    <div class="health-empty-state">
                        <span class="health-empty-value">${t('health.efEmptyMonths')}</span>
                        <span class="health-empty-sub">${t('health.efEmptySub')}</span>
                    </div>
                    <a class="health-link" data-health-nav="savings">${t('health.efSetUp')} &rarr;</a>
                ` : emergencyFunds.map(fund => {
                    const coverageMonths = totalOutflow > 0 ? fund.currentAmount / totalOutflow : 0;
                    const coveragePct    = Math.min((coverageMonths / 6) * 100, 100);
                    const st             = emergencyStatus(coverageMonths);
                    const acctName       = (app.accounts || []).find(a => a.id === fund.accountId)?.name || t('health.unknownAccount');
                    return `
                        <div class="health-ef-row">
                            <div class="health-ef-header">
                                <span class="health-ef-name">${escapeHtml(acctName)}</span>
                                <span class="health-badge ${st.cls}">${coverageMonths.toFixed(1)} ${t('health.monthsUnit')}</span>
                            </div>
                            <div class="progress-bar health-compact-bar">
                                <div class="progress-fill ${statusFillCls(st.cls)}" data-progress-width="${Math.round(coveragePct)}"></div>
                            </div>
                            <div class="health-ef-detail">${escapeHtml(st.label)}</div>
                        </div>`;
                }).join('')}
                ${emergencyFunds.length > 0 ? `<a class="health-link" data-health-nav="savings">${t('health.efManage')} &rarr;</a>` : ''}
            </div>

            <!-- Debt Payoff Timeline -->
            <div class="health-metric-card">
                <div class="health-card-header">
                    <span class="health-card-title">${t('health.timelineTitle')}</span>
                    ${hasDebts && debtTimeline ? `<span class="health-badge ${timelineSt.cls}">${timelineSt.label}</span>` : ''}
                </div>
                <p class="health-card-desc">${t('health.timelineDesc')}</p>
                ${!hasDebts ? `
                    <div class="health-empty-state">
                        <span class="health-empty-value health-empty--green">${t('health.debtFree')}</span>
                    </div>
                ` : debtTimeline ? `
                    <div class="health-timeline-hero">
                        <span class="health-timeline-value">${timelineYears}</span>
                        <span class="health-timeline-unit">${t('health.years')}</span>
                    </div>
                    ${payoffDate ? `<div class="health-timeline-date">${t('health.estimatedPayoff')}: ${escapeHtml(payoffDate)}</div>` : ''}
                    <div class="health-progress-label">
                        <span>${t('health.originalDebtPaidOff')}</span>
                        <span>${debtProgress}%</span>
                    </div>
                    <div class="progress-bar health-compact-bar">
                        <div class="progress-fill ${statusFillCls(timelineSt.cls)}" data-progress-width="${debtProgress}"></div>
                    </div>
                    <div class="health-metric-detail">
                        <span>${t('health.balance')}: ${formatCurrency(totalDebtBalance)}</span>
                        <span>${timelineMonths} ${t('health.monthsRemaining')}</span>
                    </div>
                ` : `
                    <div class="health-empty-state">
                        <span class="health-empty-sub">${t('health.unableToCalculate')}</span>
                    </div>
                `}
                <a class="health-link" data-health-nav="strategy">${t('health.goToPlan')} &rarr;</a>
            </div>

            <!-- Monthly Cash Flow -->
            <div class="health-metric-card">
                <div class="health-card-header">
                    <span class="health-card-title">${t('health.cashFlowTitle')}</span>
                    <span class="health-badge ${cashFlowSt.cls}">${cashFlowSt.label}</span>
                </div>
                <p class="health-card-desc">${t('health.cashFlowDesc')}</p>
                <div class="health-cashflow-hero ${net >= 0 ? 'health-cashflow-hero--positive' : 'health-cashflow-hero--negative'}">
                    ${net >= 0 ? '+' : ''}${formatCurrency(net)}
                </div>
                <div class="health-cashflow-rows">
                    <div class="health-cashflow-row">
                        <span>${t('health.income')}</span>
                        <span class="health-cf-income">${formatCurrency(monthlyIncome)}</span>
                    </div>
                    ${totalDebtMin > 0 ? `<div class="health-cashflow-row">
                        <span>${t('health.debtPayments')}</span>
                        <span class="health-cf-out">&minus;${formatCurrency(totalDebtMin)}</span>
                    </div>` : ''}
                    ${totalBills > 0 ? `<div class="health-cashflow-row">
                        <span>${t('health.bills')}</span>
                        <span class="health-cf-out">&minus;${formatCurrency(totalBills)}</span>
                    </div>` : ''}
                    ${totalExpenses > 0 ? `<div class="health-cashflow-row">
                        <span>${t('health.expenses')}</span>
                        <span class="health-cf-out">&minus;${formatCurrency(totalExpenses)}</span>
                    </div>` : ''}
                    <div class="health-cashflow-row health-cashflow-row--total">
                        <span>${t('health.netRemaining')}</span>
                        <span class="${net >= 0 ? 'health-cf-income' : 'health-cf-deficit'}">${formatCurrency(net)}</span>
                    </div>
                </div>
                <a class="health-link" data-health-nav="liabilities">${t('health.viewBudget')} &rarr;</a>
            </div>

            <!-- Budget Allocation -->
            <div class="health-metric-card">
                <div class="health-card-header">
                    <span class="health-card-title">${t('health.budgetTitle')}</span>
                </div>
                <p class="health-card-desc">${t('health.budgetDesc')}</p>
                ${monthlyIncome === 0 || budgetCategories.length === 0 ? `
                    <div class="health-empty-state">
                        <span class="health-empty-sub">${t('health.budgetEmptySub')}</span>
                    </div>
                ` : budgetCategories.map(({ cat, total, pct, isDebt }) => {
                    const barPct   = Math.min(pct * 100, 100);
                    const stCls    = isDebt
                        ? (pct < 0.15 ? 'health-status--green' : pct < 0.20 ? 'health-status--yellow' : 'health-status--red')
                        : budgetCategoryStatusCls(pct, cat);
                    return `
                        <div class="health-budget-row">
                            <div class="health-budget-cat-hd">
                                <span class="health-budget-cat-name">${escapeHtml(cat)}</span>
                                <span class="health-badge health-badge--sm ${stCls}">${(pct * 100).toFixed(1)}%</span>
                            </div>
                            <div class="progress-bar health-compact-bar">
                                <div class="progress-fill ${statusFillCls(stCls)}" data-progress-width="${Math.round(barPct)}"></div>
                            </div>
                            <div class="health-budget-cat-amt">${formatCurrency(total)}${t('health.perMonthSuffix')}</div>
                        </div>`;
                }).join('')}
                ${budgetCategories.length > 0 ? `<a class="health-link" data-health-nav="liabilities">${t('health.editBudget')} &rarr;</a>` : ''}
            </div>

        </div>
    `;
```

Everything after this block (`section.querySelectorAll('[data-progress-width]')...` through the end of the file) is unchanged.

- [ ] **Step 4: Extend `tests/features/test_i18n.py` with Health-page assertions**

Append to the file:

```python
@pytest.mark.feature
def test_switching_to_spanish_translates_health_page_live(app_page):
    """Switching locale while Health is the active page re-renders it in
    the new language immediately, with no reload."""
    page = app_page

    page.evaluate("() => window.app.setLocale('es')")
    page.wait_for_timeout(200)

    title = page.inner_text('.health-metric-card .health-card-title')
    assert title.strip() == 'Relación Deuda-Ingreso'

    subtitle = page.inner_text('.health-subtitle')
    assert subtitle.startswith('Una evaluación de un vistazo')


@pytest.mark.feature
def test_switching_to_polish_translates_health_page_live(app_page):
    """Same as the Spanish case, for Polish."""
    page = app_page

    page.evaluate("() => window.app.setLocale('pl')")
    page.wait_for_timeout(200)

    title = page.inner_text('.health-metric-card .health-card-title')
    assert title.strip() == 'Wskaźnik Zadłużenia do Dochodu'


@pytest.mark.feature
def test_health_page_debt_free_state_translates(app_page):
    """The zero-debt empty state ('Debt Free!') translates too, not just
    the populated-data path."""
    page = app_page

    page.evaluate("""() => {
        window.app.debts = [];
        window.app.setLocale('es');
    }""")
    page.wait_for_timeout(200)

    value = page.inner_text('.health-empty-value.health-empty--green')
    assert value.strip() == '¡Libre de Deudas!'
```

- [ ] **Step 5: Run the extended test file**

Run: `pytest tests/features/test_i18n.py -v`
Expected: all 10 tests PASS (the 7 from Task 2 plus these 3).

- [ ] **Step 6: Commit**

```bash
git add src/health.js tests/features/test_i18n.py
git commit -m "Translate the Health dashboard into es/pl (#35)"
```

---

### Task 4: Locale-aware currency and date formatting app-wide

**Files:**
- Modify: `src/utils.js`
- Modify: `stryker.config.mjs`

**Interfaces:**
- Consumes: `getIntlLocale()` from `src/i18n.js` (Task 1).

- [ ] **Step 1: Confirm current line numbers before editing**

Run: `grep -n "^export function dailyCompoundInterest" src/utils.js`
Expected: `241:export function dailyCompoundInterest(balance, aprPct, days) {` (must match before proceeding — if it doesn't, the file has changed since this plan was written and the line-range math in Step 3 needs redoing).

- [ ] **Step 2: Make `formatCurrency`, `formatShortDate`, `formatMonthYear` locale-aware**

Change the top of `src/utils.js` from:

```js
// Formatting, date helpers, shared utilities

export const APP_VERSION = '4.9.0';


// Format a number as a USD currency string (e.g., 1234.5 → "$1,234.50")
export function formatCurrency(value) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}
```

to:

```js
// Formatting, date helpers, shared utilities
import { getIntlLocale } from './i18n.js';

export const APP_VERSION = '4.10.0';


// Format a number as a USD currency string (e.g., 1234.5 → "$1,234.50" in
// the default en-US locale; digit grouping/decimal separator/symbol
// placement follow the active UI locale via getIntlLocale()).
export function formatCurrency(value) {
    return new Intl.NumberFormat(getIntlLocale(), {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}
```

This inserts exactly 1 line (the new `import` statement), shifting every subsequent line in the file down by 1.

Then update `formatShortDate` and `formatMonthYear` (originally lines 41-54, now 42-55) from:

```js
export function formatShortDate(value) {
    const isBareDate = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = isBareDate ? new Date(`${value}T12:00:00`) : new Date(value);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
```

to:

```js
export function formatShortDate(value) {
    const isBareDate = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = isBareDate ? new Date(`${value}T12:00:00`) : new Date(value);
    return date.toLocaleDateString(getIntlLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}
```

and:

```js
export function formatMonthYear(value) {
    const isBareDate = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = isBareDate ? new Date(`${value}T12:00:00`) : new Date(value);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
```

to:

```js
export function formatMonthYear(value) {
    const isBareDate = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = isBareDate ? new Date(`${value}T12:00:00`) : new Date(value);
    return date.toLocaleDateString(getIntlLocale(), { month: 'short', year: 'numeric' });
}
```

- [ ] **Step 3: Update the Stryker mutation-testing line ranges**

Run: `grep -n "^export function dailyCompoundInterest\|^export function dateToISO" src/utils.js` and confirm the two functions now start 1 line later than before (`dateToISO` block ending the first mutate range, `dailyCompoundInterest` starting the second).

In `stryker.config.mjs`, change:

```js
        'src/utils.js:7-78', // formatCurrency..dateToISO (contiguous, all tested)
        'src/utils.js:241-244', // dailyCompoundInterest
```

to:

```js
        'src/utils.js:8-79', // formatCurrency..dateToISO (contiguous, all tested)
        'src/utils.js:242-245', // dailyCompoundInterest
```

(If Step 1/the grep in this step shows a different shift than exactly +1 — e.g. because the file changed since this plan was written — recompute both ranges by the actual delta instead of using these literal numbers.)

- [ ] **Step 4: Run the full Jest suite and confirm no regressions**

Run: `npm run test:unit`
Expected: all tests pass, including the pre-existing `formatCurrency(1234.5) === '$1,234.50'`, `formatShortDate('2026-08-02') === 'Aug 2, 2026'`, `formatMonthYear('2026-08-02') === 'Aug 2026'` assertions in `tests/unit/utils.test.js` — unchanged, because `getIntlLocale()` resolves to `'en-US'` by default (no `debtTrackerLocale` in Jest's Node environment, which has no `localStorage`).

- [ ] **Step 5: Add Playwright coverage for locale-aware formatting**

Append to `tests/features/test_i18n.py`:

```python
@pytest.mark.feature
def test_format_currency_is_locale_aware(app_page):
    """formatCurrency's digit grouping/decimal separator follow the active
    locale — Polish uses a comma decimal separator where en-US uses a
    period, without formatCurrency's call sites changing at all."""
    page = app_page

    result = page.evaluate("""async () => {
        const mod = await import('/src/utils.js');
        const before = mod.formatCurrency(1234.5);
        window.app.setLocale('pl');
        const after = mod.formatCurrency(1234.5);
        return { before, after };
    }""")

    assert result['before'] == '$1,234.50'
    assert result['before'] != result['after']
    assert ',' in result['after']


@pytest.mark.feature
def test_format_short_date_is_locale_aware(app_page):
    """formatShortDate's month name/ordering follow the active locale."""
    page = app_page

    result = page.evaluate("""async () => {
        const mod = await import('/src/utils.js');
        const before = mod.formatShortDate('2026-08-02');
        window.app.setLocale('es');
        const after = mod.formatShortDate('2026-08-02');
        return { before, after };
    }""")

    assert result['before'] == 'Aug 2, 2026'
    assert result['before'] != result['after']
```

- [ ] **Step 6: Run the Playwright i18n suite**

Run: `pytest tests/features/test_i18n.py -v`
Expected: all 12 tests PASS (the 10 from Tasks 2-3 plus these 2).

- [ ] **Step 7: Run the full existing Playwright suite to confirm no regressions elsewhere**

Run: `pytest tests/ -v -m "not slow"`
Expected: all tests pass — `formatCurrency`/`formatShortDate`/`formatMonthYear` are called from dozens of feature modules, so this confirms the locale-aware change doesn't alter any existing English-locale assertion anywhere in the app.

- [ ] **Step 8: Commit**

```bash
git add src/utils.js stryker.config.mjs tests/features/test_i18n.py
git commit -m "Make formatCurrency/formatShortDate/formatMonthYear locale-aware (#35)"
```

---

### Task 5: Documentation and version bump

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:** None (documentation only — `APP_VERSION` was already bumped to `'4.10.0'` in Task 4 Step 2).

- [ ] **Step 1: Add an Internationalization section to `CLAUDE.md`**

Add a new subsection under "Cross-cutting features" (after the "Reduced motion" bullet, before the "## Security constraints" heading):

```markdown
- **Internationalization** — `src/i18n.js` provides `t(key, vars)` string lookup (falls back to English, then to the raw key, so a missing/mistyped key never crashes or renders blank), `getCurrentLocale()`/`getIntlLocale()`, and `applyStaticTranslations()` which walks `[data-i18n]` (textContent) and `[data-i18n-attr]` (comma-separated `attr:key` pairs, e.g. `"title:toolbar.settingsTitle,aria-label:toolbar.settingsAriaLabel"`) elements and sets translated text via `textContent`/`setAttribute` — never `innerHTML`, so the CSP is unaffected. Locale dictionaries live in `src/locales/{en,es,pl}.js` as flat dot-keyed string maps; `en.js` is canonical, `es.js`/`pl.js` only need pilot-scope keys. The locale preference is stored directly under `debtTrackerLocale` in `localStorage` (same pattern as `debtTrackerTheme`/`debtTrackerStorageBackend` — a device preference, not app data). Only nav, the toolbar, the Settings modal, and the Health page (`health.js`) are translated so far; other pages remain English pending follow-up issues. `formatCurrency`/`formatShortDate`/`formatMonthYear` in `utils.js` read `getIntlLocale()` instead of a hardcoded `'en-US'`, so number/date formatting conventions follow the active locale app-wide with no call-site changes. See `docs/superpowers/specs/2026-08-04-i18n-support-design.md`.
```

- [ ] **Step 2: Add a Features blurb to `README.md`**

Find the "### Navigation & Accessibility" section (line 72) and add a new bullet at the end of that section's list (before the next `###` heading):

```markdown
- **Language support (English / Español / Polski)** — switch languages from the Settings modal (gear icon). Navigation, the toolbar, Settings, and the Health dashboard are translated, with number/date formatting following the selected language; other pages are being translated incrementally.
```

- [ ] **Step 3: Add a `CHANGELOG.md` entry**

Add a new heading above the existing `## [4.9.0]` entry:

```markdown
## [4.10.0] — 2026-08-04

### Added
- **i18n infrastructure + Spanish/Polish pilot (#35)** — new `src/i18n.js` module (`t()` lookup with English fallback, `applyStaticTranslations()` for static markup, locale persisted under `debtTrackerLocale`) and `src/locales/{en,es,pl}.js` dictionaries. Navigation, the toolbar, the Settings modal, and the Health dashboard are translated into Spanish and Polish, selectable from a new Language control in Settings. `formatCurrency`/`formatShortDate`/`formatMonthYear` now format numbers/dates per the active locale everywhere in the app, not just the translated pages.

### Known limitations
- Only nav/toolbar/Settings/Health are translated — Accounts, Income, Liabilities, Recurring, Savings, Plan, Reports, Ledger, and Reconcile remain English pending follow-up issues.
- No grammatical pluralization — every translated string uses one fixed form regardless of count (e.g. Polish would grammatically need a different word form for 1 vs. 2-4 vs. 5+ months).
- No browser-language auto-detection on first run; the locale defaults to English until a user explicitly picks one in Settings.
```

- [ ] **Step 4: Run the versioning test**

Run: `pytest tests/features/test_versioning.py -v`
Expected: PASS — confirms `APP_VERSION` (`'4.10.0'`, set in Task 4) and the new `CHANGELOG.md` heading agree, and headings stay in descending order.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md CHANGELOG.md
git commit -m "Document i18n support and bump version to 4.10.0 (#35)"
```

---

### Task 6: Full verification pass

**Files:** None (verification only).

- [ ] **Step 1: Run the full Jest unit + mutation-adjacent suite**

Run: `npm run test:unit`
Expected: all tests PASS (no regressions from Tasks 1-4).

- [ ] **Step 2: Run the full Python test suite**

Run: `pytest tests/ -v -m "not slow"`
Expected: all tests PASS, including every test in `tests/features/test_i18n.py` (12 tests) and every pre-existing test file.

- [ ] **Step 3: Manual smoke check**

Run: `python -m http.server 5500` (if not already running)
Open `http://localhost:5500/` in a browser, open Settings, switch to Polski, confirm the nav/toolbar/Settings modal/Health page render in Polish with no visible untranslated placeholders (raw `key.like.this` text) or layout breakage from longer Polish strings, then switch back to English and confirm it reverts cleanly.

- [ ] **Step 4: Run the security test suite specifically**

Run: `pytest tests/security/ -v`
Expected: all tests PASS — confirms the new `data-i18n`/`data-i18n-attr` attributes and `textContent`-only translation approach introduced no CSP or `innerHTML`-escaping violations.
