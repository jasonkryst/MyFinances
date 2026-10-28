#!/usr/bin/env python3
"""
Phone-width clipping regression (issue #426, UX review 2026-10-28).

Cards use overflow:hidden for rounded corners, so content wider than the card is
silently cut off (Health "$8...", Reports Print button) instead of causing page
scroll. document.scrollWidth never notices. This test walks every top-level page
and Reports sub-tab at 390x844 with realistic data and asserts that no visible
text inside a card-like container extends past the container's right edge.
Text is measured with Range client rects, so padding is not counted as overflow.
Text inside a nested horizontal scroller (overflow-x auto/scroll) is exempt:
that content is reachable by scrolling.
"""

import pytest

PHONE = {"width": 390, "height": 844}

SEED = """
() => {
const a = window.app;
a.persons = [{id:1,name:'Alex'},{id:2,name:'Sam'}];
a.accounts = [
 {id:1,name:'Everyday Checking',type:'Checking',startingBalance:3850.42,interestRate:0.01,minimumPayment:0,archived:false},
 {id:2,name:'High-Yield Savings',type:'Savings',startingBalance:18250,interestRate:4.25,minimumPayment:0,archived:false},
 {id:3,name:'Alex 401(k)',type:'Retirement',retirementSubtype:'401k',startingBalance:64200,rateOfReturn:7,employerMatchPercent:4,archived:false}
];
a.incomes = [
 {id:1,name:'Alex Paycheck',amount:3200,firstPayDate:'2026-10-02',frequency:'biweekly',category:'Salary',isVariable:false,accountId:1,personId:1,withholdingPercent:22},
 {id:2,name:'Sam Freelance Design',amount:1400,firstPayDate:'2026-10-15',frequency:'monthly',category:'Freelance',isVariable:true,accountId:1,personId:2,withholdingPercent:0}
];
a.bonuses = [{id:1,name:'Year-end bonus',amount:4000,date:'2026-12-18',category:'Other',accountId:1,purpose:'savings'}];
a.debts = [
 {id:1,name:'Chase Sapphire',category:'Credit Card',debtType:'creditCard',priority:null,accountId:1,accountBalance:6420.18,originalBalance:7800,interestRate:23.99,minimumPayment:165,originalMinimumPayment:190,dueDate:12,creditLimit:10000,personIds:[1,2],ownershipSplit:{1:0.6,2:0.4},notes:'',archived:false},
 {id:2,name:'Citi Double Cash',category:'Credit Card',debtType:'creditCard',accountId:1,accountBalance:2310.55,originalBalance:2310.55,interestRate:19.49,minimumPayment:60,originalMinimumPayment:60,dueDate:20,creditLimit:5000,personIds:[1],archived:false},
 {id:3,name:'Honda CR-V Loan',category:'Auto Loan',debtType:'fixedAmount',accountId:1,accountBalance:14780,originalBalance:24500,interestRate:5.9,minimumPayment:452,originalMinimumPayment:452,fixedAmount:452,fixedStartDate:'2024-03-01',fixedEndDate:'2029-03-01',dueDate:5,personIds:[1,2],ownershipSplit:{1:0.5,2:0.5},archived:false},
 {id:4,name:'Medical Payment Plan',category:'Medical',debtType:'fixedAmount',accountId:1,accountBalance:1850,originalBalance:3000,interestRate:0,minimumPayment:150,originalMinimumPayment:150,fixedAmount:150,fixedStartDate:'2026-01-15',fixedEndDate:'2027-04-15',dueDate:15,personIds:[2],archived:false},
 {id:5,name:'Best Buy Card',category:'Credit Card',debtType:'creditCard',accountId:1,accountBalance:3120,originalBalance:2400,interestRate:27.99,minimumPayment:95,originalMinimumPayment:95,dueDate:25,creditLimit:3500,personIds:[],archived:false}
];
const E=(id,name,amt,d,cat)=>({id,name,budgetAmount:amt,date:new Date(d+'T00:00:00'),category:cat,accountId:1});
a.expenses = [
 E(1,'Groceries - Kroger',142.37,'2026-10-04','Groceries'),E(2,'Shell Gas',48.2,'2026-10-07','Transportation'),
 E(3,'Dinner out',86,'2026-10-11','Dining'),E(4,'Costco',231.9,'2026-10-14','Groceries'),
 E(5,'Pharmacy',27.45,'2026-10-18','Health'),E(6,'Movie night',34,'2026-10-21','Entertainment'),
 E(7,'Groceries - Aldi',98.1,'2026-09-26','Groceries'),E(8,'Car repair',412,'2026-09-12','Transportation')
];
const R=(id,name,type,amount,freq,day,cat,acct,extra={})=>Object.assign({id,name,type,amount,frequency:freq,dayOfMonth:day,category:cat,accountId:acct,targetAccountId:null,startDate:'2026-01-01',endDate:null,paused:false,pauseUntil:null,archived:false,skippedMonths:[],paidMonths:[],paidAmounts:{}},extra);
a.recurringTemplates = [
 R(1,'Netflix','subscription',15.49,'monthly',9,'Entertainment',1),
 R(2,'Spotify Family','subscription',16.99,'monthly',14,'Entertainment',1),
 R(3,'Rent','subscription',1850,'monthly',1,'Housing',1),
 R(4,'Electric - Duke Energy','subscription',134.5,'monthly',22,'Utilities',1),
 R(5,'Internet - Xfinity','subscription',79.99,'monthly',17,'Utilities',1),
 R(6,'Car Insurance','subscription',612,'quarterly',3,'Insurance',1),
 R(7,'Amazon Prime','subscription',139,'yearly',11,'Shopping',1),
 R(8,'Rental income - garage','income',250,'monthly',6,'Other',1),
 R(9,'Auto-save to HYSA','transfer',400,'monthly',3,'Other',1,{targetAccountId:2}),
 R(10,'Gym membership (paused)','subscription',39,'monthly',2,'Health',1,{paused:true})
];
a.emergencyFunds = [{id:1,accountId:2,targetAmount:24000,currentAmount:18250,monthlyContribution:400,autoContribute:true,autoSyncBalance:true,notes:'6 months of expenses'}];
a.sinkingFunds = [
 {id:1,name:'Vacation 2027',allocationMethod:'fixed',monthlyAllocation:150,targetAmount:3000,currentAmount:1100,autoContribute:true,accountId:2,notes:'',order:0,archived:false},
 {id:2,name:'Car registration',allocationMethod:'annual',monthlyAllocation:0,targetAmount:480,currentAmount:480,autoContribute:false,accountId:2,notes:'',order:1,archived:false},
 {id:3,name:'Holiday gifts',allocationMethod:'target_date',monthlyAllocation:0,targetAmount:900,currentAmount:210,autoContribute:true,accountId:2,notes:'',order:2,archived:false}
];
a.reconciliations = [
 {id:1,accountId:1,date:'2026-09-30',statementStartDate:'2026-09-01',statementEndDate:'2026-09-30',previousBalance:3200,statementBalance:3412.77,difference:0,note:'September statement',createdAt:'2026-10-01T10:00:00.000Z'},
 {id:2,accountId:2,date:'2026-09-30',statementStartDate:null,statementEndDate:null,previousBalance:17400,statementBalance:17921.3,difference:-12.5,note:'',createdAt:'2026-10-01T10:05:00.000Z'}
];
const snaps=[['2026-05-01',41000,48000],['2026-06-01',44500,47200],['2026-07-01',47800,46100],['2026-08-01',50200,45300],['2026-09-01',53900,44200],['2026-10-01',57100,43100]];
a.monthlySnapshots = snaps.map(([d,as,li])=>({date:d,totalAssets:as+60000,totalLiabilities:li,netWorth:as+60000-li,debtPaymentMade:900,incomeReceived:6800,source:'auto'}));
a.retirementSnapshots = [
 {id:1,accountId:3,date:'2026-07-01',balance:58100,contribution:900},
 {id:2,accountId:3,date:'2026-08-01',balance:60400,contribution:900},
 {id:3,accountId:3,date:'2026-09-01',balance:62100,contribution:900},
 {id:4,accountId:3,date:'2026-10-01',balance:64200,contribution:900}
];
a.retirementTargetDate='2054-06-01';
a.homePurchasePlan=null;
a.saveToStorage(); a.updateUI();
return a.debts.length;
}
"""

CARD_SELECTORS = [
    ".health-metric-card", ".card", ".account-card", ".income-card", ".debt-card",
    ".savings-card", ".retire-card", ".retirement-account-card", ".dashboard-card",
    ".rpt-chart-card", ".nw-report-stat", ".rpt-month-nav", ".comparison-card",
    ".summary-card", ".stat-card", ".nw-history-card", ".acct-mf-section",
]

CHECK_JS = """([cardSelectors]) => {
    const sels = cardSelectors.join(',');
    const isVisible = (el) => {
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    // Any rounded element that clips (overflow hidden/clip) also counts as a card.
    const clipping = [...document.querySelectorAll('body *')].filter(el => {
        const cs = getComputedStyle(el);
        return (cs.overflowX === 'hidden' || cs.overflowX === 'clip')
            && (parseFloat(cs.borderTopLeftRadius) > 0)
            && !['BUTTON', 'INPUT', 'SELECT', 'CANVAS'].includes(el.tagName)
            && !el.closest('.sr-only');
    });
    const containers = new Set([...document.querySelectorAll(sels), ...clipping]);
    const bad = [];
    for (const card of containers) {
        if (!isVisible(card)) continue;
        const cr = card.getBoundingClientRect();
        const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) {
            if (!n.nodeValue.trim()) continue;
            const el = n.parentElement;
            if (!el || !isVisible(el) || el.closest('.sr-only, [hidden], script, style')) continue;
            let scroller = false;
            for (let p = el; p && p !== card; p = p.parentElement) {
                const o = getComputedStyle(p).overflowX;
                if (o === 'auto' || o === 'scroll') { scroller = true; break; }
            }
            if (scroller) continue;
            const range = document.createRange();
            range.selectNodeContents(n);
            for (const r of range.getClientRects()) {
                if (r.width === 0 || r.height === 0) continue;
                if (r.right > cr.right + 1) {
                    bad.push({
                        card: card.tagName + '.' + String(card.className).slice(0, 50),
                        text: n.nodeValue.trim().slice(0, 40),
                        over: Math.round((r.right - cr.right) * 10) / 10,
                    });
                    break;
                }
            }
        }
    }
    return {
        bad: bad.slice(0, 8),
        cards: containers.size,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
    };
}"""

PAGES = ["health", "accounts", "income", "liabilities", "recurring", "savings",
         "strategy", "reports", "ledger", "reconcile", "retirement", "people"]
REPORT_TABS = ["calendar", "spending", "incomeexp", "moneyflow", "variance",
               "networth", "forecast", "summary"]


@pytest.fixture
def phone_page(app_page):
    page = app_page
    page.set_viewport_size(PHONE)
    page.evaluate(SEED)
    page.reload()
    return page


def _check(page, label):
    page.wait_for_timeout(400)
    res = page.evaluate(CHECK_JS, [CARD_SELECTORS])
    assert res["scrollWidth"] <= res["innerWidth"], f"{label}: page scrolls horizontally ({res['scrollWidth']} > {res['innerWidth']})"
    assert not res["bad"], f"{label}: text clipped past card edge: {res['bad']}"
    return res


def _go(page, name):
    page.evaluate("(n) => window.app.switchPage(n)", name)
    page.wait_for_timeout(600)


@pytest.mark.ui
@pytest.mark.parametrize("name", PAGES)
def test_no_card_clipping_on_page(phone_page, name):
    _go(phone_page, name)
    _check(phone_page, name)


@pytest.mark.ui
def test_no_card_clipping_on_savings_subtabs(phone_page):
    page = phone_page
    for sub in ["sinking", "home"]:
        _go(page, "savings")
        page.evaluate("(s) => document.querySelector(`[data-savings-subtab='${s}']`).click()", sub)
        _check(page, f"savings/{sub}")


@pytest.mark.ui
def test_no_card_clipping_on_plan_after_calculate(phone_page):
    page = phone_page
    _go(page, "strategy")
    page.fill("#monthlyPayment", "2200")
    page.click("#calculateBtn")
    page.wait_for_selector(".comparison-table", state="attached", timeout=15000)
    page.wait_for_timeout(1500)
    _check(page, "plan/overview")
    for tab in ["debt-summary", "schedule"]:
        page.evaluate("(t) => document.querySelector(`[data-rtab='${t}']`).click()", tab)
        _check(page, f"plan/{tab}")


@pytest.mark.ui
@pytest.mark.parametrize("tab", REPORT_TABS)
def test_no_card_clipping_on_reports_subtab(phone_page, tab):
    page = phone_page
    _go(page, "reports")
    page.evaluate("(t) => document.querySelector(`[data-rptab='${t}']`).click()", tab)
    page.wait_for_timeout(1000)
    _check(page, f"reports/{tab}")


@pytest.mark.ui
def test_checker_detects_clipping(phone_page):
    """Negative control: the geometry check must flag text cut off by an overflow:hidden card."""
    page = phone_page
    page.evaluate("""() => {
        const c = document.createElement('div');
        c.className = 'card';
        c.style.width = '120px';
        c.style.overflow = 'hidden';
        c.style.borderRadius = '8px';
        c.style.whiteSpace = 'nowrap';
        c.textContent = 'This sentence is much wider than its card';
        document.body.prepend(c);
    }""")
    res = page.evaluate(CHECK_JS, [CARD_SELECTORS])
    assert any("sentence" in b["text"] for b in res["bad"])
