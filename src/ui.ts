// The admin portal: one page, served inline so the Worker is a single artifact.
// The embedded script deliberately uses string concatenation rather than
// template literals, because this whole file is itself a template literal.

export const PORTAL_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TRUBBL Manager</title>
<style>
  :root {
    --bg: #12100e; --panel: #1c1917; --line: #322c28; --ink: #f2ece4;
    --muted: #a39a90; --accent: #c8963e; --danger: #c4553d; --ok: #6f9a52;
    --radius: 10px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  header {
    display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap;
    padding: 18px 20px; border-bottom: 1px solid var(--line); background: var(--panel);
  }
  header h1 { margin: 0; font-size: 19px; letter-spacing: 0.04em; text-transform: uppercase; }
  header .who { margin-left: auto; color: var(--muted); font-size: 13px; }
  nav { display: flex; gap: 4px; flex-wrap: wrap; padding: 10px 16px; border-bottom: 1px solid var(--line); }
  nav button {
    background: none; border: 1px solid transparent; color: var(--muted);
    padding: 6px 12px; border-radius: var(--radius); cursor: pointer; font: inherit;
  }
  nav button[aria-selected="true"] { background: var(--panel); color: var(--ink); border-color: var(--line); }
  main { padding: 20px; max-width: 1100px; }
  section[hidden] { display: none; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 0 0 12px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; margin-bottom: 16px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .tile { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px; }
  .tile .n { font-size: 26px; font-weight: 600; }
  .tile .k { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  th { color: var(--muted); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  tr:last-child td { border-bottom: none; }
  button.act {
    background: var(--panel); color: var(--ink); border: 1px solid var(--line);
    border-radius: 6px; padding: 5px 10px; cursor: pointer; font: inherit; font-size: 13px;
  }
  button.act:hover { border-color: var(--accent); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #17130c; font-weight: 600; }
  button.danger { border-color: var(--danger); color: var(--danger); }
  input, select {
    background: #0d0b0a; color: var(--ink); border: 1px solid var(--line);
    border-radius: 6px; padding: 6px 8px; font: inherit; font-size: 14px;
  }
  label { display: block; margin-bottom: 10px; font-size: 13px; color: var(--muted); }
  label input, label select { display: block; margin-top: 4px; width: 100%; max-width: 320px; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; border: 1px solid var(--line); }
  .pill.open { color: var(--ok); border-color: var(--ok); }
  .pill.overdue { color: var(--danger); border-color: var(--danger); }
  .pill.soon { color: var(--accent); border-color: var(--accent); }
  .muted { color: var(--muted); }
  .note { color: var(--muted); font-size: 13px; margin-top: 8px; }
  #toast {
    position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
    background: var(--panel); border: 1px solid var(--accent); color: var(--ink);
    padding: 10px 16px; border-radius: var(--radius); display: none; max-width: 90vw;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg: #f7f4ef; --panel: #fff; --line: #e2dbd1; --ink: #23201c; --muted: #6f675e; }
    input, select { background: #fff; }
  }
</style>
</head>
<body>
<header>
  <h1>TRUBBL Manager</h1>
  <span id="season" class="muted"></span>
  <span class="who" id="who"></span>
</header>
<nav id="tabs"></nav>
<main>
  <section id="tab-dashboard"></section>
  <section id="tab-preseason" hidden></section>
  <section id="tab-rounds" hidden></section>
  <section id="tab-fixtures" hidden></section>
  <section id="tab-extensions" hidden></section>
  <section id="tab-table" hidden></section>
  <section id="tab-coaches" hidden></section>
  <section id="tab-settings" hidden></section>
  <section id="tab-audit" hidden></section>
</main>
<div id="toast"></div>
<script>
var TABS = [
  ['dashboard', 'Dashboard'], ['preseason', 'Pre-season'], ['rounds', 'Rounds'], ['fixtures', 'Fixtures'],
  ['extensions', 'Extensions'], ['table', 'Table'], ['coaches', 'Coaches'],
  ['settings', 'Settings'], ['audit', 'Audit']
];
var current = 'dashboard';

function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function toast(message) {
  var el = document.getElementById('toast');
  el.textContent = message;
  el.style.display = 'block';
  setTimeout(function () { el.style.display = 'none'; }, 4000);
}
async function api(path, options) {
  var response = await fetch(path, Object.assign({ headers: { 'content-type': 'application/json' } }, options || {}));
  var body = await response.json().catch(function () { return {}; });
  if (!response.ok) throw new Error(body.error || ('HTTP ' + response.status));
  return body;
}
function post(path, payload) {
  return api(path, { method: 'POST', body: JSON.stringify(payload || {}) });
}
function day(iso) {
  if (!iso) return '—';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function forInput(iso) { return iso ? String(iso).slice(0, 10) : ''; }

function renderTabs() {
  document.getElementById('tabs').innerHTML = TABS.map(function (t) {
    return '<button role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === current) + '">' + t[1] + '</button>';
  }).join('');
}
function show(name) {
  current = name;
  TABS.forEach(function (t) { document.getElementById('tab-' + t[0]).hidden = t[0] !== name; });
  renderTabs();
  load(name);
}
document.getElementById('tabs').addEventListener('click', function (event) {
  var tab = event.target.getAttribute('data-tab');
  if (tab) show(tab);
});

function windowPill(view) {
  if (!view) return '';
  var cls = view.state === 'overdue' ? 'overdue' : view.state === 'closing_soon' ? 'soon' : 'open';
  var text = view.state === 'overdue'
    ? 'Overdue by ' + Math.abs(view.daysRemaining) + 'd'
    : view.daysRemaining === null ? view.state.replace('_', ' ') : view.daysRemaining + ' days left';
  return '<span class="pill ' + cls + '">' + esc(text) + '</span>';
}

async function load(name) {
  try {
    if (name === 'dashboard') return await loadDashboard();
    if (name === 'preseason') return await loadPreseason();
    if (name === 'rounds') return await loadRounds();
    if (name === 'fixtures') return await loadFixtures();
    if (name === 'extensions') return await loadExtensions();
    if (name === 'table') return await loadTable();
    if (name === 'coaches') return await loadCoaches();
    if (name === 'settings') return await loadSettings();
    if (name === 'audit') return await loadAudit();
  } catch (error) {
    toast(error.message);
  }
}

async function loadDashboard() {
  var data = await api('/api/overview');
  var el = document.getElementById('tab-dashboard');
  if (!data.season) {
    el.innerHTML = '<div class="card"><h2>No season yet</h2>' +
      '<p class="muted">Point the manager at a TourPlay season to import it.</p>' +
      '<div class="row"><label>TourPlay slug<input id="newslug" value="trubbl-season-7"></label>' +
      '<button class="act primary" id="createseason">Import season</button></div>' +
      '<p class="note">The slug is the part of the TourPlay URL after /blood-bowl/.</p></div>';
    document.getElementById('createseason').onclick = async function () {
      try {
        toast('Importing from TourPlay…');
        await post('/api/season', { tourplay_slug: document.getElementById('newslug').value.trim() });
        toast('Imported.');
        load('dashboard');
      } catch (error) { toast(error.message); }
    };
    return;
  }

  document.getElementById('season').textContent = data.season.name + ' · ' + data.season.tourplay_slug;
  var counts = data.counts;
  var round = data.round;

  var html = '<div class="tiles">' +
    '<div class="tile"><div class="n">' + (round ? round.number : '—') + '</div><div class="k">Round</div></div>' +
    '<div class="tile"><div class="n">' + counts.played + '/' + counts.fixtures + '</div><div class="k">Played</div></div>' +
    '<div class="tile"><div class="n">' + counts.outstanding + '</div><div class="k">Outstanding</div></div>' +
    '<div class="tile"><div class="n">' + counts.pendingExtensions + '</div><div class="k">Extension requests</div></div>' +
    '</div>';

  html += '<div class="card"><h2>Round ' + (round ? round.number : '') + ' ' + windowPill(data.window) + '</h2>' +
    '<p class="muted">Opens ' + day(round && round.opens_at) + ' · closes ' + day(round && round.closes_at) +
    ' · status <strong>' + esc(round ? round.status : '') + '</strong></p>' +
    '<div class="row"><button class="act" id="sync">Sync TourPlay</button>' +
    '<button class="act" id="chase">Post chase list to Discord</button>' +
    '<button class="act" id="runtick">Run the scheduler now</button></div>' +
    '<p class="note">Last synced ' + day(data.season.last_synced_at) +
    (data.season.last_sync_error ? ' · <span style="color:var(--danger)">' + esc(data.season.last_sync_error) + '</span>' : '') +
    '</p></div>';

  if (data.outstanding.length) {
    html += '<div class="card"><h2>Still to play</h2><table><tbody>' +
      data.outstanding.map(function (f) {
        return '<tr><td>' + esc(f.homeTeam) + ' <span class="muted">v</span> ' + esc(f.awayTeam) + '</td>' +
          '<td class="muted">' + esc(f.homeCoach) + ' v ' + esc(f.awayCoach) + '</td>' +
          '<td class="muted">' + (f.scheduledFor ? 'booked ' + day(f.scheduledFor) : f.chaseState) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  el.innerHTML = html;

  document.getElementById('sync').onclick = async function () {
    try { toast('Syncing…'); var r = await post('/api/sync'); toast('Synced ' + r.fixtures + ' fixtures, ' + r.coaches + ' coaches.'); load('dashboard'); }
    catch (error) { toast(error.message); }
  };
  document.getElementById('chase').onclick = async function () {
    try { var r = await post('/api/chase'); toast(r.posted ? 'Posted.' : ('Not posted: ' + (r.reason || r.error))); }
    catch (error) { toast(error.message); }
  };
  document.getElementById('runtick').onclick = async function () {
    try { var r = await post('/api/tick'); toast('Done. Opened ' + r.opened.length + ', closed ' + r.closed.length + ', nagged ' + r.nagged.length + '.'); load('dashboard'); }
    catch (error) { toast(error.message); }
  };
}

var VOTE_LABEL = {
  yes: ['Voted yes', 'open'],
  no:  ['Voted no', 'overdue'],
  '':  ['No response', 'soon']
};

async function loadPreseason() {
  var data = await api('/api/preseason');
  var el = document.getElementById('tab-preseason');
  if (!data.rows || !data.rows.length) {
    el.innerHTML = '<div class="card"><h2>Pre-season</h2><p class="muted">Nobody registered yet.</p></div>';
    return;
  }
  var c = data.counts;
  var html = '<div class="tiles">' +
    '<div class="tile"><div class="n">' + c.total + '</div><div class="k">On the list</div></div>' +
    '<div class="tile"><div class="n">' + c.confirmed + '</div><div class="k">Confirmed</div></div>' +
    '<div class="tile"><div class="n">' + c.awaitingTourplay + '</div><div class="k">Awaiting TourPlay</div></div>' +
    '<div class="tile"><div class="n">' + c.noResponse + '</div><div class="k">No response</div></div>' +
    '</div>';

  if (c.awaitingTourplay) {
    var waiting = data.rows.filter(function (r) { return r.poll_vote === 'yes' && !r.on_tourplay; })
      .map(function (r) { return esc(r.display_name); }).join(', ');
    html += '<div class="card"><h2>Still to register on TourPlay</h2><p>' + waiting +
      '</p><p class="note">They have said they are playing but have no TourPlay registration, ' +
      'so they cannot be drawn into fixtures yet.</p></div>';
  }

  html += '<div class="card"><h2>Season 7 sign-ups</h2><table><thead><tr>' +
    '<th>Coach (TourPlay)</th><th>Discord</th><th>Team</th><th>NAF</th>' +
    '<th>Poll</th><th>TourPlay</th><th>Division</th><th>Last season</th></tr></thead><tbody>' +
    data.rows.map(function (r) {
      var v = VOTE_LABEL[r.poll_vote] || VOTE_LABEL[''];
      var tp = r.on_tourplay
        ? '<span class="pill open">registered</span>'
        : '<span class="pill soon">not yet</span>';
      return '<tr>' +
        '<td>' + esc(r.display_name) + (r.preseason_note ? '<div class="muted" style="font-size:12px">' + esc(r.preseason_note) + '</div>' : '') + '</td>' +
        '<td class="muted">' + (r.discord_username ? '@' + esc(r.discord_username) : '—') + '</td>' +
        '<td class="muted">' + (esc(r.team_name) || '—') + (r.race ? ' · ' + esc(r.race) : '') + '</td>' +
        '<td class="muted">' + (r.naf_number || '—') + '</td>' +
        '<td><span class="pill ' + v[1] + '">' + v[0] + '</span></td>' +
        '<td>' + tp + '</td>' +
        '<td class="muted">' + (esc(r.division) || '—') + '</td>' +
        '<td class="muted">' + (esc(r.last_season_note) || '—') + '</td>' +
        '</tr>';
    }).join('') + '</tbody></table>' +
    '<p class="note">Everyone who voted in the sign-up poll or registered on TourPlay, plus any Season 6 coach ' +
    'who earned a promotion but has not yet responded. Team names stay blank until the season opens on ' +
    'TourPlay, which is when it stops hiding rosters.</p></div>';
  el.innerHTML = html;
}

async function loadRounds() {
  var data = await api('/api/rounds');
  var el = document.getElementById('tab-rounds');
  var html = '<div class="card"><h2>Lay out every window</h2><div class="row">' +
    '<label>First round opens<input type="date" id="firstopens"></label>' +
    '<label>Window length (days)<input type="number" id="wlen" value="21" min="1"></label>' +
    '<button class="act primary" id="layout">Apply to all rounds</button></div>' +
    '<p class="note">This overwrites every round window back to back. Individual dates can be changed below afterwards.</p></div>';

  html += '<div class="card"><h2>Rounds</h2><table><thead><tr><th>#</th><th>Opens</th><th>Closes</th>' +
    '<th>Status</th><th>Games</th><th></th></tr></thead><tbody>' +
    data.rounds.map(function (r) {
      return '<tr data-round="' + r.id + '">' +
        '<td>' + r.number + '</td>' +
        '<td><input type="date" class="opens" value="' + forInput(r.opens_at) + '"></td>' +
        '<td><input type="date" class="closes" value="' + forInput(r.closes_at) + '"></td>' +
        '<td><select class="status">' +
          ['pending', 'open', 'closed', 'settled'].map(function (s) {
            return '<option value="' + s + '"' + (s === r.status ? ' selected' : '') + '>' + s + '</option>';
          }).join('') + '</select></td>' +
        '<td class="muted">' + (r.total - r.outstanding) + '/' + r.total + '</td>' +
        '<td><button class="act saveround">Save</button></td></tr>';
    }).join('') + '</tbody></table></div>';
  el.innerHTML = html;

  document.getElementById('layout').onclick = async function () {
    try {
      var first = document.getElementById('firstopens').value;
      if (!first) return toast('Pick a start date first.');
      var r = await post('/api/windows/layout', { firstOpensAt: first, lengthDays: Number(document.getElementById('wlen').value) });
      toast('Laid out ' + r.rounds + ' windows.');
      load('rounds');
    } catch (error) { toast(error.message); }
  };
  el.querySelectorAll('.saveround').forEach(function (button) {
    button.onclick = async function () {
      var row = button.closest('tr');
      var id = row.getAttribute('data-round');
      try {
        await post('/api/rounds/' + id + '/window', {
          opens_at: row.querySelector('.opens').value || null,
          closes_at: row.querySelector('.closes').value || null
        });
        await post('/api/rounds/' + id + '/status', { status: row.querySelector('.status').value });
        toast('Round saved.');
      } catch (error) { toast(error.message); }
    };
  });
}

async function loadFixtures() {
  var rounds = await api('/api/rounds');
  var chosen = window.__round || (rounds.rounds.find(function (r) { return r.status === 'open'; }) || rounds.rounds[0] || {}).id;
  window.__round = chosen;
  var data = await api('/api/fixtures?round=' + chosen);
  var el = document.getElementById('tab-fixtures');

  var html = '<div class="card"><div class="row"><label>Round<select id="pickround">' +
    rounds.rounds.map(function (r) {
      return '<option value="' + r.id + '"' + (r.id === chosen ? ' selected' : '') + '>Round ' + r.number + '</option>';
    }).join('') + '</select></label></div></div>';

  html += '<div class="card"><h2>Fixtures</h2><table><thead><tr><th>#</th><th>Division</th><th>Match</th><th>Result</th>' +
    '<th>Status</th><th>Rule</th></tr></thead><tbody>' +
    data.fixtures.map(function (f) {
      var score = (f.homeScore === null ? '–' : f.homeScore) + ' : ' + (f.awayScore === null ? '–' : f.awayScore);
      return '<tr data-fixture="' + f.id + '">' +
        '<td class="muted">' + f.id + '</td>' +
        '<td class="muted">' + esc(f.divisionName || (f.isFriendly ? 'inter-div' : '\u2014')) + '</td>' +
        '<td>' + esc(f.homeTeam) + ' <span class="muted">v</span> ' + esc(f.awayTeam) +
          '<div class="muted" style="font-size:12px">' + esc(f.homeCoach) + ' v ' + esc(f.awayCoach) + '</div></td>' +
        '<td>' + score + '</td>' +
        '<td><span class="pill">' + esc(f.status.replace(/_/g, ' ')) + '</span>' +
          (f.isFriendly ? '<div class="muted" style="font-size:12px">friendly \u2014 no points</div>' : '') +
          (f.rulingReason ? '<div class="muted" style="font-size:12px">' + esc(f.rulingReason) + '</div>' : '') + '</td>' +
        '<td><div class="row">' +
          '<select class="kind">' +
            '<option value="concession">(a) one tried, no response \u2014 2-0</option>' +
            '<option value="no_agreement">(b) both tried, no agreement \u2014 1-1</option>' +
            '<option value="no_attempt">(c) neither tried \u2014 0-0</option>' +
            '<option value="double_forfeit">double forfeit \u2014 0-0, no points</option>' +
            '<option value="void">void \u2014 does not count</option></select>' +
          '<select class="fault"><option value="home">home did not respond</option>' +
            '<option value="away">away did not respond</option></select>' +
          '<input class="reason" placeholder="reason" style="width:140px">' +
          '<button class="act rule">Apply</button>' +
          (f.rulingKind ? '<button class="act danger revert">Undo</button>' : '') +
        '</div></td></tr>';
    }).join('') + '</tbody></table>' +
    '<p class="note">A ruling overrides whatever TourPlay says and survives every later sync. Undo hands the fixture back to TourPlay.</p></div>';
  el.innerHTML = html;

  document.getElementById('pickround').onchange = function (event) {
    window.__round = Number(event.target.value);
    load('fixtures');
  };
  el.querySelectorAll('.rule').forEach(function (button) {
    button.onclick = async function () {
      var row = button.closest('tr');
      try {
        var kind = row.querySelector('.kind').value;
        // Only a concession names a side; (b) and (c) are draws with nobody at fault.
        var needsFault = kind === 'concession' || kind === 'forfeit';
        await post('/api/fixtures/' + row.getAttribute('data-fixture') + '/rule', {
          kind: kind,
          atFault: needsFault ? row.querySelector('.fault').value : null,
          reason: row.querySelector('.reason').value
        });
        toast('Ruled, and announced in Discord.');
        load('fixtures');
      } catch (error) { toast(error.message); }
    };
  });
  el.querySelectorAll('.revert').forEach(function (button) {
    button.onclick = async function () {
      var row = button.closest('tr');
      try { await post('/api/fixtures/' + row.getAttribute('data-fixture') + '/revert'); toast('Ruling undone.'); load('fixtures'); }
      catch (error) { toast(error.message); }
    };
  });
}

async function loadExtensions() {
  var data = await api('/api/extensions?status=requested');
  var el = document.getElementById('tab-extensions');
  el.innerHTML = '<div class="card"><h2>Extension requests</h2>' +
    (data.extensions.length === 0 ? '<p class="muted">Nothing waiting.</p>' :
      '<table><thead><tr><th>Match</th><th>Asked by</th><th>Until</th><th>Reason</th><th></th></tr></thead><tbody>' +
      data.extensions.map(function (e) {
        return '<tr data-ext="' + e.id + '"><td>' + esc(e.home_team) + ' v ' + esc(e.away_team) + '</td>' +
          '<td>' + esc(e.coach) + '</td><td>' + day(e.extends_to) + '</td><td class="muted">' + esc(e.reason) + '</td>' +
          '<td><button class="act grant">Grant</button> <button class="act danger refuse">Refuse</button></td></tr>';
      }).join('') + '</tbody></table>') + '</div>';

  el.querySelectorAll('.grant, .refuse').forEach(function (button) {
    button.onclick = async function () {
      var row = button.closest('tr');
      try {
        await post('/api/extensions/' + row.getAttribute('data-ext'), {
          status: button.classList.contains('grant') ? 'granted' : 'refused'
        });
        toast('Done, and announced.');
        load('extensions');
      } catch (error) { toast(error.message); }
    };
  });
}

async function loadTable() {
  var data = await api('/api/standings');
  var groups = (data.divisions || []).filter(function (g) { return g.table.length; });
  if (!groups.length) {
    document.getElementById('tab-table').innerHTML = '<div class="card"><h2>League table</h2><p class="muted">No results yet.</p></div>';
    return;
  }
  document.getElementById('tab-table').innerHTML = groups.map(function (g) {
    var title = g.division ? esc(g.division.name) + ' Division' : 'League table';
    return '<div class="card"><h2>' + title + '</h2>' +
      '<table><thead><tr><th>#</th><th>Team</th><th>Coach</th><th>P</th><th>W</th><th>D</th><th>L</th>' +
      '<th>TD+</th><th>TD\u2212</th><th>Net TD</th><th>Net CAS</th><th>Bonus</th><th>Conc</th><th>Pts</th></tr></thead><tbody>' +
      g.table.map(function (r) {
        return '<tr><td>' + r.position + '</td><td>' + esc(r.teamName) + '</td>' +
          '<td class="muted">' + esc(r.coach) + '</td>' +
          '<td>' + r.played + '</td><td>' + r.won + '</td><td>' + r.drawn + '</td><td>' + r.lost + '</td>' +
          '<td>' + r.touchdownsFor + '</td><td>' + r.touchdownsAgainst + '</td>' +
          '<td>' + signed(r.netTouchdowns) + '</td><td>' + signed(r.netCasualties) + '</td>' +
          '<td class="muted">' + (r.bonusPoints ? '+' + r.bonusPoints : '') + '</td>' +
          '<td class="muted">' + (r.concessionsGiven || '') + '</td>' +
          '<td><strong>' + r.points + '</strong></td></tr>';
      }).join('') + '</tbody></table>' +
      '<p class="note">Points include \u00a72.4 bonuses (3+ TDs, no TDs conceded, 3+ casualties). ' +
      'Ties break on head-to-head, then net TD, then net CAS, then their sum. ' +
      'Conc counts unplayed games ruled against that team.</p></div>';
  }).join('');
}

function signed(value) { return (value > 0 ? '+' : '') + value; }

async function loadCoaches() {
  var data = await api('/api/coaches');
  var el = document.getElementById('tab-coaches');
  el.innerHTML = '<div class="card"><h2>Coaches</h2><table><thead><tr><th>Coach</th><th>Team</th><th>Division</th><th>NAF</th>' +
    '<th>Discord id</th><th>Email</th><th></th></tr></thead><tbody>' +
    data.coaches.map(function (c) {
      return '<tr data-coach="' + c.id + '"><td>' + esc(c.display_name) + '</td>' +
        '<td class="muted">' + esc(c.team_name) + ' · ' + esc(c.race) + '</td>' +
        '<td class="muted">' + esc(c.naf_number || '—') + '</td>' +
        '<td><input class="did" value="' + esc(c.discord_user_id || '') + '" style="width:150px"></td>' +
        '<td><input class="mail" value="' + esc(c.email || '') + '" style="width:170px"></td>' +
        '<td><button class="act savecoach">Save</button></td></tr>';
    }).join('') + '</tbody></table>' +
    '<p class="note">Coaches normally link themselves with <code>/trubbl link</code>. This is for when that goes wrong.</p></div>';

  el.querySelectorAll('.savecoach').forEach(function (button) {
    button.onclick = async function () {
      var row = button.closest('tr');
      try {
        await post('/api/coaches/' + row.getAttribute('data-coach'), {
          discord_user_id: row.querySelector('.did').value,
          email: row.querySelector('.mail').value
        });
        toast('Saved.');
      } catch (error) { toast(error.message); }
    };
  });
}

var SETTING_LABELS = {
  league_name: 'League name',
  points_win: 'Points for a win', points_draw: 'Points for a draw', points_loss: 'Points for a loss',
  bonus_touchdown_threshold: 'Bonus point at this many TDs scored (0 = off)',
  bonus_touchdown_points: 'Points for that TD bonus',
  bonus_shutout_points: 'Points for conceding no TDs',
  bonus_casualty_threshold: 'Bonus point at this many casualties (0 = off)',
  bonus_casualty_points: 'Points for that casualty bonus',
  concession_score_winner: 'Concession: TDs to the coach who tried',
  concession_score_loser: 'Concession: TDs to the coach who did not respond',
  no_agreement_score: 'No agreement reached: TDs to each side',
  round_length_days: 'Default window length (days)',
  nag_days_before_close: 'Chase on these days before the deadline',
  closing_soon_days: 'Treat as closing soon within (days)',
  auto_forfeit_on_close: 'Auto-forfeit when a window expires (true/false)',
  announce_channel_id: 'Discord: announcements channel id',
  chase_channel_id: 'Discord: chase channel id',
  admin_channel_id: 'Discord: admin channel id',
  discord_admin_role_ids: 'Discord: admin role ids (comma separated)'
};

async function loadSettings() {
  var data = await api('/api/settings');
  var el = document.getElementById('tab-settings');
  el.innerHTML = '<div class="card"><h2>Settings</h2>' +
    Object.keys(SETTING_LABELS).map(function (key) {
      return '<label>' + SETTING_LABELS[key] +
        '<input data-key="' + key + '" value="' + esc(data.settings[key] === undefined ? '' : data.settings[key]) + '"></label>';
    }).join('') +
    '<button class="act primary" id="savesettings">Save settings</button>' +
    '<p class="note">Auto-forfeit applies \u00a73.2(c) \u2014 a 0-0 draw \u2014 when a window expires with a game unplayed and ' +
    'no extension granted, because telling (a) from (b) needs to know who actually reached out. Re-rule by hand once you know. ' +
    'No ruling earns a \u00a72.4 bonus: left to the letter of the rules a 0-0 draw would pay the shutout bonus to both sides, ' +
    'making it worth more to ignore a fixture than to turn up and lose.</p></div>';

  // Per-division chase channels (§3.3 — each division has its own setup channel).
  try {
    var divs = await api('/api/divisions');
    if (divs.divisions.length) {
      el.insertAdjacentHTML('beforeend',
        '<div class="card"><h2>Division chase channels</h2><table><thead><tr><th>Division</th>' +
        '<th>Chase channel id</th><th></th></tr></thead><tbody>' +
        divs.divisions.map(function (d) {
          return '<tr data-div="' + d.id + '"><td>' + esc(d.name) + '</td>' +
            '<td><input class="chch" value="' + esc(d.chase_channel_id || '') + '" style="width:220px"></td>' +
            '<td><button class="act savediv">Save</button></td></tr>';
        }).join('') + '</tbody></table>' +
        '<p class="note">Where the "still to play" nags for that division are posted. Left blank, they fall back to the ' +
        'league-wide chase channel above. Inter-divisional friendlies are never chased.</p></div>');
      el.querySelectorAll('.savediv').forEach(function (button) {
        button.onclick = async function () {
          var row = button.closest('tr');
          try {
            await post('/api/divisions/' + row.getAttribute('data-div'),
              { chase_channel_id: row.querySelector('.chch').value });
            toast('Division channel saved.');
          } catch (error) { toast(error.message); }
        };
      });
    }
  } catch (error) { /* divisions not imported yet */ }

  document.getElementById('savesettings').onclick = async function () {
    var updates = {};
    el.querySelectorAll('input[data-key]').forEach(function (input) { updates[input.getAttribute('data-key')] = input.value; });
    try { await post('/api/settings', { settings: updates }); toast('Settings saved.'); }
    catch (error) { toast(error.message); }
  };
}

async function loadAudit() {
  var data = await api('/api/audit');
  document.getElementById('tab-audit').innerHTML = '<div class="card"><h2>Recent activity</h2><table><thead><tr>' +
    '<th>When</th><th>Who</th><th>What</th><th>Subject</th></tr></thead><tbody>' +
    data.audit.map(function (a) {
      return '<tr><td class="muted">' + esc(a.at) + '</td><td>' + esc(a.actor) + '</td>' +
        '<td>' + esc(a.action) + '</td><td class="muted">' + esc(a.subject || '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

(async function start() {
  try {
    var me = await api('/api/me');
    document.getElementById('who').textContent = me.email ? me.email + (me.isOwner ? ' (owner)' : '') : (me.reason || 'not signed in');
    if (!me.isAdmin) {
      document.querySelector('main').innerHTML =
        '<div class="card"><h2>No access</h2><p class="muted">' + esc(me.reason || 'You are not a league admin.') + '</p></div>';
      return;
    }
  } catch (error) {
    document.getElementById('who').textContent = 'sign-in check failed';
  }
  renderTabs();
  show('dashboard');
})();
</script>
</body>
</html>`;
