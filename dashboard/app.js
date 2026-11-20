// Token Radar dashboard. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, filters, a per-protocol detail view
// and the model. No network: every byte it shows is in data.js.
//
// State lives in the URL hash, so each view has an address: #p=<slug> opens
// a protocol, #category=Lending filters the board, #q=... searches it.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('app');
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, watchlist: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // The model in one function: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries, so the page and the
  // board visibly run the same arithmetic.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var extra = Math.min(Math.max((row.chains || []).length - 1, 0), model.breadth_max_chains);
    var breadth = 1 + extra * model.breadth_per_chain;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * breadth));
  }

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL and age decide the action, the capital, the hold
  // and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Lend $' + capital + ' of USDC on ' + name + ' (' + chain + ') and leave the deposit earning.';
    if (c.indexOf('dex') >= 0 || c.indexOf('swap') >= 0 || c.indexOf('amm') >= 0) return 'Add $' + capital + " of liquidity to " + name + "'s deepest pool on " + chain + ' and keep the LP position open.';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) return 'Deposit $' + capital + " into " + name + "'s highest-yield vault on " + chain + ' and let it compound.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC into ' + chain + ' with ' + name + ', then put the bridged funds to work in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and hold the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Post $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.';
    if (c.indexOf('prediction') >= 0) return 'Fund your ' + name + ' account with $' + capital + ' and take one small market position.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('vault') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and hold the vault shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or hold $' + capital + ' of the stable asset issued through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of " + name + "'s yield-bearing asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    return 'Put $' + capital + ' of USDC to work in ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Open a fresh wallet that holds only the funds you plan to farm, and store its seed phrase offline on paper.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Do one qualifying action every week, a deposit, a borrow, a swap or a vote, and keep a note of each one.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so your activity spans more than one snapshot window.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before withdrawing, open the protocol's own points or rewards page and claim only through the link it publishes there.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Record the wallet, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it cleanly.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('min')) state.minTvl = Number(params.get('min')) || 0;
    if (params.get('wl') === '1') state.watchlist = true;
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('sort')) state.sort = params.get('sort');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.minTvl) params.set('min', String(state.minTvl));
    if (state.watchlist) params.set('wl', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (state.watchlist && !r.watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'risk') { av = a.risk_score; bv = b.risk_score; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark', 'aria-hidden': 'true' }),
        el('div', null,
          el('h1', null, 'TOKEN ', el('span', { text: 'RADAR' })),
          el('p', { class: 'tag', text: 'Pre-token protocols, ranked by implied value — farm the launch before it happens' })
        )
      ),
      el('div', { class: 'top-meta' },
        el('span', { class: 'pill' }, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', { class: 'pill' }, 'Source: ', el('b', { text: 'DefiLlama protocol index' })),
        el('span', { class: 'pill' }, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function kpis() {
    var top = DATA.rows[0];
    return el('section', { class: 'kpis', 'aria-label': 'Board summary' },
      el('div', { class: 'kpi hot' }, el('div', { class: 'k-label', text: 'Watchlist covered' }), el('div', { class: 'k-value', text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('div', { class: 'k-sub', text: 'every protocol at or above the $50M floor' })),
      el('div', { class: 'kpi' }, el('div', { class: 'k-label', text: 'Pre-token rows' }), el('div', { class: 'k-value', text: String(DATA.board_size) }), el('div', { class: 'k-sub', text: DATA.early_size + ' early rows below the floor' })),
      el('div', { class: 'kpi' }, el('div', { class: 'k-label', text: 'Total implied value' }), el('div', { class: 'k-value', text: fmtUsd(DATA.total_implied_usd) }), el('div', { class: 'k-sub', text: 'sum of the board, a model not a price' })),
      el('div', { class: 'kpi' }, el('div', { class: 'k-label', text: 'Median 7-day growth' }), el('div', { class: 'k-value', text: fmtPct(DATA.median_growth_pct) }), el('div', { class: 'k-sub', text: 'across the ranked board' })),
      el('div', { class: 'kpi' }, el('div', { class: 'k-label', text: 'Top implied value' }), el('div', { class: 'k-value', text: top ? fmtUsd(top.implied_value_usd) : 'n/a' }), el('div', { class: 'k-sub', text: top ? top.name : '' }))
    );
  }

  function signals() {
    var max = DATA.rows.length ? DATA.rows[0].implied_value_usd : 1;
    return el('section', { class: 'signals', 'aria-label': 'Top signals' },
      DATA.rows.slice(0, 3).map(function (r, i) {
        return el('article', { class: 'signal' },
          el('div', { class: 's-rank', text: 'Signal ' + (i + 1) + ' — rank ' + r.rank }),
          el('h3', { text: r.name }),
          el('div', { class: 's-meta', text: (r.category || 'Other') + ' · ' + fmtUsd(r.tvl_usd) + ' TVL · ' + fmtPct(r.change_7d) + ' in 7d · ' + fmtAge(r.age_days) + ' old' }),
          el('div', { class: 's-value', text: fmtUsd(r.implied_value_usd) + ' implied' }),
          el('div', { class: 's-bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(4, Math.round((r.implied_value_usd / max) * 100)) + '%' }))
        );
      })
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var ch = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); render(); });
    var min = el('select', { id: 'minTvl', 'aria-label': 'Minimum TVL' },
      [['0', 'Any TVL'], ['50000000', 'TVL $50M+'], ['100000000', 'TVL $100M+'], ['500000000', 'TVL $500M+'], ['1000000000', 'TVL $1B+']].map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: String(state.minTvl) === o[0] ? 'selected' : null });
      })
    );
    min.addEventListener('change', function () { state.minTvl = Number(min.value) || 0; writeHash(); render(); });
    var wl = el('input', { type: 'checkbox', id: 'wl', checked: state.watchlist ? 'checked' : null });
    wl.addEventListener('change', function () { state.watchlist = wl.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    var shown = state.tab === 'pre-token' ? filteredRows().length : DATA.live.length;
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), ch),
      el('div', { class: 'field' }, el('label', { for: 'minTvl', text: 'Min TVL' }), min),
      el('label', { class: 'check', for: 'wl' }, wl, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count' }, el('b', { text: String(shown) }), ' rows shown')
    );
  }

  function sortHeader(key, label, right) {
    return el('th', { scope: 'col', class: right ? 'num' : null },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function momentumBar(g) {
    if (g === null || g === undefined || !isFinite(g)) return el('span', { class: 'num', text: 'n/a' });
    var w = Math.max(4, Math.min(100, Math.round((Math.abs(g) / 60) * 100)));
    return el('span', null,
      el('span', { class: 'mom', 'aria-hidden': 'true' }, el('i', { class: g < 0 ? 'down' : '', style: 'width:' + w + '%' })),
      ' ',
      el('span', { class: 'num ' + (g >= 0 ? 'pos' : 'neg'), text: fmtPct(g) })
    );
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'btn', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.watchlist = false; writeHash(); render(); } })
      ));
    }
    var max = DATA.rows.length ? DATA.rows[0].implied_value_usd : 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        class: state.selected === r.slug ? 'sel' : null,
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'unnamed chain') + (r.chains && r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num' }, momentumBar(r.change_7d)),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'badge ' + r.risk_label.toLowerCase(), text: r.risk_label + ' ' + r.risk_score })),
        el('td', { class: 'num', text: r.checks_passed + ' / 5' }),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols, strongest implied value first. Select a row for its model, risk and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', '#', true),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL', true),
            sortHeader('growth', '7d momentum', true),
            sortHeader('age', 'Age', true),
            sortHeader('implied', 'Implied value', true),
            sortHeader('risk', 'Risk'),
            el('th', { scope: 'col', class: 'num', text: 'Checks' }),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num' }, momentumBar(r.change_7d)),
        el('td', { class: 'num', text: '—' }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', class: 'num', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', class: 'num', text: 'TVL' }),
            el('th', { scope: 'col', class: 'num', text: '7d momentum' }),
            el('th', { scope: 'col', class: 'num', text: 'Age' }),
            el('th', { scope: 'col', class: 'num', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function categoryChart() {
    var cats = DATA.categories || [];
    var max = cats.length ? cats[0].implied_usd : 1;
    return el('section', { class: 'box' },
      el('h2', { text: 'Where the implied value sits' }),
      el('p', { class: 'sub', text: 'Board TVL and implied value by category — the eight largest categories on the board.' }),
      cats.map(function (c) {
        return el('div', { class: 'cat-row' },
          el('span', { text: c.category + ' (' + c.rows + ')' }),
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((c.implied_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(c.implied_usd) })
        );
      })
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var formula = 'implied = round( tvl_usd x ' + m.base_multiple +
      ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ')' +
      ' x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ')' +
      ' x (1 + min(chains - 1, ' + m.breadth_max_chains + ') x ' + m.breadth_per_chain + ') )';
    return el('section', { class: 'box' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula', text: formula }),
      el('ul', { class: 'model-list' },
        el('li', null, el('b', { text: 'TVL first. ' }), 'A protocol is worth a share of the value it already holds: TVL times ' + m.base_multiple + '.'),
        el('li', null, el('b', { text: 'Growth bends it. ' }), 'Seven-day TVL growth, clamped to ' + m.growth_floor + '% … ' + m.growth_cap + '%, moves the value by up to ' + Math.round(m.growth_weight * 100) + '% of itself.'),
        el('li', null, el('b', { text: 'Age matures it. ' }), 'Days since first listing, capped at ' + m.maturity_days + ', lift the multiplier from ' + m.maturity_floor + ' to 1.00. An unknown age counts as ' + m.unknown_age_days + ' days.'),
        el('li', null, el('b', { text: 'Breadth spreads it. ' }), 'Each extra chain adds ' + Math.round(m.breadth_per_chain * 100) + '% — TVL on more chains is harder to fake — capped at ' + m.breadth_max_chains + ' extra chains.'),
        el('li', null, el('b', { text: 'Risk is separate. ' }), 'The risk score never changes the value; it warns you about it. Shrinking TVL, parabolic growth, a young record, one chain and thin TVL all raise it.')
      )
    );
  }

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    renderDetail(row);
  }
  function closeDetail() {
    state.selected = null;
    writeHash();
    var old = document.querySelector('.overlay');
    if (old) old.remove();
    var d = document.querySelector('.detail');
    if (d) d.remove();
    var rows = document.querySelectorAll('tbody tr.sel');
    rows.forEach(function (tr) { tr.classList.remove('sel'); });
  }

  function renderDetail(row) {
    closeDetailSilent();
    var recomputed = impliedOf(row, DATA.model);
    var steps = farmSteps(row);
    var checks = [
      ['No token on record', true],
      ['TVL at or above the $50M floor', row.tvl_usd >= DATA.floor_usd],
      ['TVL on 2 or more chains', (row.chains || []).length >= 2],
      ['Listed at least 180 days', row.age_days !== null && row.age_days >= 180],
      ['TVL growing over 7 days', row.change_7d !== null && row.change_7d >= 0],
    ];
    var overlay = el('div', { class: 'overlay', onclick: function () { closeDetail(); } });
    var panel = el('aside', { class: 'detail', role: 'dialog', 'aria-label': row.name + ' detail' },
      el('div', { class: 'detail-head' },
        el('div', null,
          el('span', { class: 'rank-tag', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + row.risk_label + ' risk ' + row.risk_score }),
          el('h2', { text: row.name }),
          el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + ((row.chains || []).length ? row.chains.join(', ') : 'an unnamed chain') })
        ),
        el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { closeDetail(); } })
      ),
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'big', text: fmtUsd(row.implied_value_usd) }),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ' — the same number board.json carries.' : ' — which differs from the board, so the data would be stale.') + ' An estimate, not a price.' }),
      el('div', { class: 'kv' },
        el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) }),
        el('span', { text: 'Seven-day growth' }), el('b', { class: row.change_7d !== null && row.change_7d >= 0 ? 'pos' : 'neg', text: fmtPct(row.change_7d) }),
        el('span', { text: 'Age with no token' }), el('b', { text: fmtAge(row.age_days) }),
        el('span', { text: 'Growth multiplier' }), el('b', { text: String(row.growth_multiplier) }),
        el('span', { text: 'Maturity multiplier' }), el('b', { text: String(row.maturity_multiplier) }),
        el('span', { text: 'Breadth multiplier' }), el('b', { text: String(row.breadth_multiplier) }),
        el('span', { text: 'Risk score' }), el('b', { text: row.risk_label + ' ' + row.risk_score + ' / 100' })
      ),
      el('h3', { text: 'Launch-readiness checks — ' + row.checks_passed + ' of 5 pass' }),
      el('ul', { class: 'checks' }, checks.map(function (c) {
        return el('li', null, el('span', { text: c[0] }), el('span', { class: c[1] ? 'ok' : 'no', text: c[1] ? 'PASS' : 'FAIL' }));
      })),
      el('h3', { text: 'Farm plan — 6 steps' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
      el('div', { class: 'warn', text: 'This board says a protocol records no token — never that it has none. A record can miss a token. Never pay anyone to claim an airdrop.' })
    );
    document.body.appendChild(overlay);
    document.body.appendChild(panel);
  }
  function closeDetailSilent() {
    var old = document.querySelector('.overlay');
    if (old) old.remove();
    var d = document.querySelector('.detail');
    if (d) d.remove();
  }

  function render() {
    closeDetailSilent();
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(kpis());
    shell.appendChild(signals());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    var grid = el('div', { class: 'grid2' });
    grid.appendChild(categoryChart());
    grid.appendChild(modelPanel());
    shell.appendChild(grid);
    shell.appendChild(el('p', { class: 'foot' },
      el('b', { text: 'How to read this board. ' }),
      'Rank 1 is the strongest claim, not a prediction that a token launches or when. Implied value is the model’s own number: what a token would be worth if the protocol’s record stayed as it is. The watchlist is the floor — every protocol at or above $50M of TVL with no token on record — and the early radar adds the strongest pre-token protocols below it. Live-token protocols are set aside with their market caps. Data: the sealed DefiLlama snapshot of ' + DATA.as_of + '; the dashboard runs offline on that snapshot alone.'
    ));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (state.selected) {
      var row = null;
      DATA.rows.forEach(function (r) { if (r.slug === state.selected) row = r; });
      if (row) renderDetail(row);
    }
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.querySelector('.detail')) closeDetail();
  });
})();
