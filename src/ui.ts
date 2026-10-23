// The admin portal: one page, served inline so the Worker is a single artifact.
// The embedded script deliberately uses string concatenation rather than
// template literals, because this whole file is itself a template literal.

import { FONT_LINKS, THEME_CSS } from './theme.js';

// Portal-only furniture. Everything shared with the public rules pack —
// colours, type, tables, buttons, pills — comes from src/theme.ts.
const PORTAL_CSS = `
header {
  display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap;
  padding: 16px 20px; border-bottom: 1px solid var(--line); background: var(--panel);
}
header h1 { font: var(--display); font-size: 26px; letter-spacing: 0.05em; }
header h1 .acc { color: var(--accent); }
header .who { margin-left: auto; color: var(--muted); font-size: 13px; }
nav { display: flex; gap: 4px; flex-wrap: wrap; padding: 10px 16px; border-bottom: 1px solid var(--line); }
nav button {
  background: none; border: 1px solid transparent; color: var(--muted);
  padding: 6px 12px; font-size: 14px;
}
nav button[aria-selected="true"] { background: var(--panel); color: var(--ink); border-color: var(--line); }
main { padding: 20px; max-width: 1100px; }
section[hidden] { display: none; }
main h2 {
  font: var(--display); font-size: 17px; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--muted); margin: 0 0 12px;
}
main .card { margin-bottom: 16px; }
main .tiles { margin-bottom: 16px; }
button.act { font-size: 13px; padding: 5px 10px; border-radius: 6px; }
#toast {
  position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
  background: var(--panel); border: 1px solid var(--accent); color: var(--ink);
  padding: 10px 16px; border-radius: var(--radius); display: none; max-width: 90vw;
  box-shadow: 0 6px 24px var(--shadow);
}
`;

export const PORTAL_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TRUBBL Manager</title>
${FONT_LINKS}
<style>${THEME_CSS}${PORTAL_CSS}</style>
</head>
<body>
<header>
  <h1>TR<span class="acc">U</span>BBL Manager</h1>
  <span id="season" class="muted"></span>
  <span class="who" id="who"></span>
</header>
<nav id="tabs"></nav>
<main>
  <section id="tab-dashboard"></section>
  <section id="tab-preseason" hidden></section>
  <section id="tab-rounds" hidden></section>
  <section id="tab-fixtures" hidden></section>
  <section id="tab-coaches" hidden></section>
  <section id="tab-settings" hidden></section>
  <section id="tab-audit" hidden></section>
</main>
<div id="toast"></div>
<script>
var TABS = [
  ['dashboard', 'Dashboard'], ['preseason', 'Pre-season'], ['rounds', 'Rounds'], ['fixtures', 'Results'],
  ['coaches', 'Coaches'], ['settings', 'Settings'], ['audit', 'Audit']
];
var current = 'dashboard';

function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// TourPlay names divisions "Premier Division"; one added by hand may be just
// "Premier". Append the word only when it is missing.
function divisionTitle(name) {
  var trimmed = String(name || '').trim();
  return /\bdivisions?$/i.test(trimmed) ? trimmed : trimmed + ' Division';
}
// A hidden roster gives a two-letter code rather than a team name, and the
// codes are not unique. Show the coach until the real name arrives.
function teamLabel(name, provisional, coach) {
  if (provisional && coach) return coach;
  return name || coach || 'TBC';
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
  var round = data.round;
  var reported = data.reported || [];

  var html = '';
  if (data.discord && data.discord.authError) {
    html += '<div class="card" style="border-color:var(--danger)"><h2 style="color:var(--danger)">The bot cannot post to Discord</h2>' +
      '<p>Discord has rejected commish-bot\'s token since ' + day(data.discord.authError.since) +
      ' (' + esc(data.discord.authError.error) + '). Nothing the bot posts is getting through, including round announcements.</p>' +
      '<p class="note">Fix: put the current bot token into the Worker secret <code>DISCORD_BOT_TOKEN</code>. Missed round announcements go out on the next daily run. ' +
      (data.discord.alertWebhook ? 'Alarms are going to the alert webhook.' : 'No alert webhook is configured, so this banner is the only warning.') +
      '</p></div>';
  }

  var lastRead = data.season.last_synced_at;
  var stale = !lastRead || (Date.now() - new Date(lastRead).getTime()) > 36 * 3600 * 1000;
  if (data.season.last_sync_error || stale) {
    html += '<div class="card" style="border-color:var(--danger)"><h2 style="color:var(--danger)">TourPlay\'s feed is not being read</h2>' +
      '<p>Last good read ' + day(lastRead) + '.' +
      (data.season.last_sync_error ? ' Last error: ' + esc(data.season.last_sync_error) : '') + '</p>' +
      '<p class="note">Results come from TourPlay\'s own bot in #league-result-input. Until this clears, ' +
      'results reported on TourPlay will not appear here or in <code>/trubbl status</code>.</p></div>';
  }

  html += '<div class="tiles">' +
    '<div class="tile"><div class="n">' + (round ? round.number : '—') + '</div><div class="k">Round</div></div>' +
    '<div class="tile"><div class="n">' + reported.length + '</div><div class="k">Results reported this round</div></div>' +
    '</div>';

  html += '<div class="card"><h2>Round ' + (round ? round.number : '') + ' ' + windowPill(data.window) + '</h2>' +
    '<p class="muted">Opens ' + day(round && round.opens_at) + ' · closes ' + day(round && round.closes_at) +
    ' · status <strong>' + esc(round ? round.status : '') + '</strong></p>' +
    '<div class="row"><button class="act" id="sync">Read TourPlay\'s feed now</button>' +
    '<button class="act" id="runtick">Run the scheduler now</button></div>' +
    '<p class="note">TourPlay\'s feed last read ' + day(lastRead) + '. The scheduler reads it every morning at 08:00 UTC.</p></div>';

  if (reported.length) {
    html += '<div class="card"><h2>Results reported this round</h2><table><tbody>' +
      reported.map(function (f) {
        return '<tr><td>' + esc(f.divisionName || '') + '</td><td>' + esc(f.homeTeam) + ' <strong>' + f.homeScore + '–' + f.awayScore +
          '</strong> ' + esc(f.awayTeam) + '</td><td class="muted">' + esc(f.homeCoach) + ' v ' + esc(f.awayCoach) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  el.innerHTML = html;

  document.getElementById('sync').onclick = async function () {
    try { toast('Reading…'); var r = await post('/api/sync'); toast('Read ' + r.read + ' posts: ' + r.results + ' results, ' + r.schedules + ' dates.'); load('dashboard'); }
    catch (error) { toast(error.message); }
  };
  document.getElementById('runtick').onclick = async function () {
    try { var r = await post('/api/tick'); toast('Done. Opened ' + r.opened.length + ', closed ' + r.closed.length + '.'); load('dashboard'); }
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
    '<label>Window length (days)<input type="number" id="wlen" value="14" min="1"></label>' +
    '<label>First round (days)<input type="number" id="wfirst" value="21" min="1"></label>' +
    '<button class="act primary" id="layout">Apply to all rounds</button></div>' +
    '<p class="note">This overwrites every round window back to back. The first round can run longer to let ' +
    'people get set up. Individual dates can be changed below afterwards.</p></div>';

  html += '<div class="card"><h2>Rounds</h2><table><thead><tr><th>#</th><th>Opens</th><th>Closes</th>' +
    '<th>Status</th><th>Results</th><th></th></tr></thead><tbody>' +
    data.rounds.map(function (r) {
      return '<tr data-round="' + r.id + '">' +
        '<td>' + r.number + '</td>' +
        '<td><input type="date" class="opens" value="' + forInput(r.opens_at) + '"></td>' +
        '<td><input type="date" class="closes" value="' + forInput(r.closes_at) + '"></td>' +
        '<td><select class="status">' +
          ['pending', 'open', 'closed', 'settled'].map(function (s) {
            return '<option value="' + s + '"' + (s === r.status ? ' selected' : '') + '>' + s + '</option>';
          }).join('') + '</select></td>' +
        '<td class="muted">' + r.reported + ' reported</td>' +
        '<td><button class="act saveround">Save</button></td></tr>';
    }).join('') + '</tbody></table></div>';
  el.innerHTML = html;

  document.getElementById('layout').onclick = async function () {
    try {
      var first = document.getElementById('firstopens').value;
      if (!first) return toast('Pick a start date first.');
      var r = await post('/api/windows/layout', {
        firstOpensAt: first,
        lengthDays: Number(document.getElementById('wlen').value),
        firstRoundDays: Number(document.getElementById('wfirst').value)
      });
      toast('Laid out ' + r.rounds + ' windows, first round ' + r.firstRoundDays + ' days.');
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

  html += '<div class="card"><h2>Fixtures and results</h2><table><thead><tr><th>Division</th><th>Match</th><th>Result</th>' +
    '<th>Status</th></tr></thead><tbody>' +
    data.fixtures.map(function (f) {
      var score = f.status === 'played' ? f.homeScore + ' : ' + f.awayScore : '\u2014';
      return '<tr>' +
        '<td class="muted">' + esc(f.divisionName || '\u2014') + '</td>' +
        '<td>' + esc(teamLabel(f.homeTeam, f.homeTeamProvisional, f.homeCoach)) +
          ' <span class="muted">v</span> ' +
          esc(teamLabel(f.awayTeam, f.awayTeamProvisional, f.awayCoach)) +
          '<div class="muted" style="font-size:12px">' + esc(f.homeCoach) + ' v ' + esc(f.awayCoach) + '</div></td>' +
        '<td>' + score + '</td>' +
        '<td><span class="pill">' + esc(f.status.replace(/_/g, ' ')) + '</span>' +
          (f.scheduledFor && f.status !== 'played' ? '<div class="muted" style="font-size:12px">' + day(f.scheduledFor) + '</div>' : '') +
        '</td></tr>';
    }).join('') + '</tbody></table>' +
    '<p class="note">Results and agreed dates come from TourPlay\'s own posts in #league-result-input. ' +
    'A fixture from a round drawn after 29 September only appears here once it has been scheduled or played on TourPlay, ' +
    'so this list is not the full draw. TourPlay holds the draw and the table.</p></div>';
  el.innerHTML = html;

  document.getElementById('pickround').onchange = function (event) {
    window.__round = Number(event.target.value);
    load('fixtures');
  };
}

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
    '<p class="note">Discord ids were filled in from the sign-up poll. Edit one here if a coach changes account.</p></div>';

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
  round_length_days: 'Window length (days)',
  first_round_length_days: 'First round window length (days)',
  dates_channel_id: 'Discord: season dates channel id',
  announce_channel_id: 'Discord: announcements channel id',
  tourplay_feed_channel_id: 'Discord: channel where TourPlay\'s bot posts results',
  alert_discord_user_id: 'Discord: user id to mention in alarms'
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
    '<p class="note">The bot reads results from TourPlay\'s own posts and keeps the round calendar. ' +
    'It no longer chases games, keeps a table or takes rulings: those need data TourPlay\'s feed does not carry.</p></div>';

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
