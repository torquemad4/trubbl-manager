// The public rules pack, served at trubbl-rules.torquemada.uk. No Access in
// front of it: the whole point is that a coach can read it on their phone in
// the pub without logging in to anything.
//
// It shares src/theme.ts with the admin portal, so the two surfaces stay in
// step. Everything else lives here, because one file that is entirely the
// document is easier to edit between seasons than a template plus content.

import { FONT_LINKS, THEME_CSS } from './theme.js';

const PAGE_CSS = `
body { padding-bottom: 80px; }

.masthead { border-bottom: 1px solid var(--line); background: var(--panel); }
.masthead .inner {
  max-width: 1120px; margin: 0 auto; padding: 34px 24px 26px;
  display: flex; align-items: flex-end; gap: 20px; flex-wrap: wrap;
}
.masthead .meta { margin-left: auto; text-align: right; color: var(--muted); font-size: 12.5px; }
.masthead .meta .eyebrow { display: block; margin-bottom: 4px; }
#themer { font-size: 12px; padding: 5px 11px; margin-top: 10px; }

.shell { max-width: 1120px; margin: 0 auto; padding: 0 24px; display: flex; gap: 40px; align-items: flex-start; }
nav.toc {
  position: sticky; top: 24px; width: 232px; flex: none; padding: 26px 0 40px;
  font-size: 13.5px; max-height: calc(100vh - 48px); overflow-y: auto;
}
nav.toc ol { list-style: none; margin: 0; padding: 0; }
nav.toc > ol > li { margin-bottom: 14px; }
nav.toc ol ol { margin: 4px 0 0 0; }
nav.toc a { display: block; padding: 3px 0 3px 10px; text-decoration: none; color: var(--muted); border-left: 2px solid transparent; }
nav.toc a:hover { color: var(--ink); }
nav.toc a.top { color: var(--ink); font-weight: 600; letter-spacing: 0.02em; }
nav.toc a.here { color: var(--accent); border-left-color: var(--accent); }

article { flex: 1; min-width: 0; padding: 26px 0 40px; max-width: 74ch; }
article > p:first-of-type { font-size: 17px; color: var(--muted); }

h2.part {
  font-size: 30px; margin: 46px 0 6px; padding-top: 22px; border-top: 2px solid var(--line);
  display: flex; align-items: baseline; gap: 14px;
}
h2.part:first-child { margin-top: 0; padding-top: 0; border-top: none; }
h2.part .num { color: var(--accent); font-size: 20px; }
h3.clause { font-size: 23px; margin: 30px 0 10px; display: flex; align-items: baseline; gap: 12px; }
h3.clause .num { color: var(--accent); font-size: 15px; letter-spacing: 0.1em; }
h3.clause a.link { opacity: 0; text-decoration: none; font: 400 14px var(--body); color: var(--muted); }
h3.clause:hover a.link { opacity: 1; }

article ul, article ol.body { padding-left: 22px; margin: 0 0 14px; }
article li { margin-bottom: 7px; }
ul.points { list-style: none; padding: 0; max-width: 420px; }
ul.points li { display: flex; justify-content: space-between; gap: 16px; padding: 8px 0; margin: 0; border-bottom: 1px dotted var(--line); }
ul.points li b { font-variant-numeric: tabular-nums; color: var(--accent); }
ol.tiebreak { counter-reset: tb; list-style: none; padding: 0; max-width: 420px; }
ol.tiebreak li { counter-increment: tb; padding-left: 34px; position: relative; }
ol.tiebreak li::before {
  content: counter(tb); position: absolute; left: 0; top: 0;
  font: var(--display); font-size: 15px; color: var(--accent);
  width: 22px; height: 22px; line-height: 23px; text-align: center;
  border: 1px solid var(--line); border-radius: 50%;
}

dl.cmds { margin: 0 0 22px; }
dl.cmds dt {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14.5px;
  color: var(--accent); margin-top: 16px; word-break: break-word;
}
dl.cmds dd { margin: 4px 0 0; }
dl.cmds dd .when { display: block; color: var(--muted); font-size: 14px; margin-top: 3px; }

dl.outcomes { margin: 0 0 16px; }
dl.outcomes dt { font-weight: 600; margin-top: 12px; }
dl.outcomes dd { margin: 3px 0 0; color: var(--muted); }
dl.outcomes dd b { color: var(--accent); font-weight: 600; }

.fn { font-size: 13.5px; color: var(--muted); border-top: 1px solid var(--line); margin-top: 20px; padding-top: 12px; }
.fn p { margin: 0 0 8px; }
.fn sup { color: var(--accent); }
sup.ref { color: var(--accent); font-size: 0.72em; }

.new { border-left: 3px solid var(--accent); background: var(--tint); border-radius: var(--radius); padding: 12px 16px; margin: 16px 0; font-size: 14.5px; }
.new b { color: var(--accent); text-transform: uppercase; font-size: 11.5px; letter-spacing: 0.09em; display: block; margin-bottom: 4px; }

footer { border-top: 1px solid var(--line); margin-top: 50px; padding: 22px 0 0; color: var(--muted); font-size: 13.5px; }

@media (max-width: 900px) {
  .shell { display: block; padding: 0 18px; }
  nav.toc { position: static; width: auto; max-height: none; padding: 20px 0 0; border-bottom: 1px solid var(--line); }
  nav.toc > ol { columns: 2; column-gap: 24px; }
  article { padding-top: 20px; }
  .masthead .inner { padding: 26px 18px 20px; }
  .masthead .meta { margin-left: 0; text-align: left; width: 100%; }
}
`;

// Every heading here is also a TOC entry; the ids are what the sidebar links to.
const BODY = String.raw`
<h2 class="part" id="s1"><span class="num">1</span> About TRUBBL</h2>

<h3 class="clause" id="s1-1"><span class="num">1.1</span> Who we Are <a class="link" href="#s1-1">#</a></h3>
<p>The Reading Undependent Blood Bowl League (TRUBBL) is a league-style competition for Games Workshop's <i>Blood Bowl: Third Season</i> (a.k.a. BB2025) based in Reading, Berkshire. We are an independent league, meaning we are not associated with any shops, venues or organisations &ndash; just some folks who love the game and wanted to play a little closer to home.</p>
<p>TRUBBL is run by Lord Commissioner Torquemada (Karl Sainz). All league management is done via TourPlay, and using it is a requirement to take part. The app is completely free to use for coaches and makes it a breeze to keep track of what happens during and in between games (plus, it makes the Lord Commissioner's life much easier!). Though TourPlay does charge the league admin a small amount, there is no fee for playing in TRUBBL. Donations for end-of-season awards or TourPlay costs are gratefully accepted, but in no way required or expected.</p>

<h3 class="clause" id="s1-2"><span class="num">1.2</span> Contact <a class="link" href="#s1-2">#</a></h3>
<p>Our main point of contact is our official Discord community. If you're interested in the league, or just want to chat Blood Bowl with us, feel free to join in! To contact the Lord Commissioner directly, email <a href="mailto:torquemadabb@pm.me">torquemadabb@pm.me</a>.</p>
<p>The channels you will actually use:</p>
<ul>
  <li><b>#league-announcements</b> &ndash; season start, rules changes, and anything else official.</li>
  <li><b>#season-7-dates</b> &ndash; each round's window is posted here as it opens, with its closing date, and again a few days before it closes naming anyone whose game is still outstanding.</li>
  <li><b>#games-setup-premier</b>, <b>#games-setup-second</b>, <b>#games-setup-third</b> &ndash; arrange your fixtures in your own division's channel. <b>#setup-games-interdivisional</b> is for friendlies (see <a href="#s3-3-2">&sect;3.3.2</a>).</li>
  <li><b>#league-result-input</b> &ndash; a live feed of what is being entered on TourPlay while games are in progress.</li>
</ul>
<p>Everyone playing this season carries the <b>S7 Coach</b> role, plus a role for their division &ndash; Premier Division, Second Division or Third Division. That is so the Lord Commissioner can tag the people a message actually concerns, rather than pinging the whole server.</p>
<p>If you want to meet us in person, check Discord to see when games have been scheduled, and come say hi! You can usually find some of us at the Reading Biscuit Factory on weekday evenings or the odd Saturday morning.</p>

<h3 class="clause" id="s1-3"><span class="num">1.3</span> Venues <a class="link" href="#s1-3">#</a></h3>
<p>We are not tied to any shop or venue &ndash; you can play wherever you and your opponent choose. However, we usually play in one of these two places:</p>
<ul>
  <li><b>Reading Biscuit Factory</b>, 1 Queens Walk, RG1 7QE. Craft beer and a wide open bar / remote-work space with big tables that are perfect for BB.</li>
  <li><b>The Castle Tap</b>, 120 Castle St, RG1 7RJ. A friendly and alternative pub with a great selection of booze, and delicious cheese boards. We recommend booking in advance if you are planning to play here on a Friday or weekend evening as it can get quite full, but it is usually quiet on weekdays or early weekend afternoons.</li>
</ul>
<p>When organising games, do check if there is another game happening at the same time, as it is always nice to have games side by side. Also, remember the venues are not charging us anything for the 2&ndash;3 hours we are taking up their tables, so please be considerate of other patrons and consider getting a drink or two while you are there.</p>
<p>Alternatively, Reading's local games shop <b>Eclectic Games</b> is at 21 Duke Street, and has a games room available for hire. Eclectic also stocks Blood Bowl merch, paints and other goodies, so if you need any hobby supplies, give them a look!</p>

<h2 class="part" id="s2"><span class="num">2</span> League Rules</h2>

<h3 class="clause" id="s2-1"><span class="num">2.1</span> The Golden Rule <a class="link" href="#s2-1">#</a></h3>
<p>TRUBBL is a casual, no-stress league. This doesn't mean we don't play to win &ndash; some of our coaches are very competitive people! It just means that we want to be as welcoming as possible, and let people have a good time whatever their life circumstances, skill level, and interest in competitive play. So far, we haven't needed any kind of code of conduct, and we hope to continue that way. The only rule we have is very simple:</p>
<div class="callout">
  <p class="shout">Don't be a dick</p>
  <p>Blood Bowl can be a rough game sometimes. If you dice someone, be kind, have some empathy, and don't rub it in. If you get diced, understand your opponent deserves to have fun too, and try not to get too salty if they keep punching your players into the CAS box.</p>
</div>
<p>This is not to say you shouldn't take every block you can in a game that's already decided to get SPP, or foul on turn 16 against an opponent who might still overtake you in the rankings. Any and all in-game actions that can give your team a better shot at the title are completely legitimate! All we ask is that you are considerate in the way you behave while you're stomping your opponent's team into the dirt, especially if they are a newer coach or they're having a bad season.</p>

<h3 class="clause" id="s2-2"><span class="num">2.2</span> League Management <a class="link" href="#s2-2">#</a></h3>
<p>Use of TourPlay for the league is mandatory, but how you use TourPlay is largely up to you. All we need from a league management perspective is that all SPP-generating events (casualties, touchdowns, interceptions etc) and MNGs / permanent injuries are logged on the correct players by the end of the game. Logging Badly Hurt injury results, or fouls and send-offs, is entirely optional. Likewise, don't feel like you have to bother with tracking turns on TourPlay if you prefer doing it the old-fashioned way.</p>
<p>Having said that, anything you put into TourPlay during the game will be shown on the app for other coaches, and reported in the #league-result-input channel. So if you want people to be able to follow your game as it develops and cheer or boo along in the Discord, then by all means put everything in!</p>
<p>Changes to your team (such as spending SPP, hiring new players etc) can be made at any time up until your next match. This means you can make last-minute changes to give yourself just the amount of inducement cash you need for your next match. That's fine, but it can lead to a situation where both coaches are stuck waiting for each other to update their teams. To avoid this, the coach with the lowest current TV can request that their opponent make all their changes first and then <b>freeze</b> their team ahead of a match. If you want to do this, please request the freeze as soon as possible after your previous game in your division's games-setup channel, tagging your opponent and the Lord Commissioner.</p>

<h3 class="clause" id="s2-3"><span class="num">2.3</span> Allowed Game Rules <a class="link" href="#s2-3">#</a></h3>
<p>TRUBBL uses the core BB2025 ruleset and includes all non-optional rules from:</p>
<ul>
  <li>The <i>Blood Bowl: Third Season</i> core rulebook</li>
  <li>All teams and star players published by GW<sup class="ref">1</sup></li>
  <li>The unofficial Slann team as described by the NAF</li>
  <li>All FAQs published by GW<sup class="ref">2</sup></li>
  <li>The NAF Recommendations for BB2025 (a.k.a. the NAFAQ)<sup class="ref">3</sup></li>
</ul>
<p>Nothing else is allowed.</p>
<div class="fn">
  <p><sup>1</sup> All new teams and new Star Players apply immediately on official publication. Should GW publish any changes to a team (e.g. replacing a Team of Legend with a revamped version [pun intended]) before the start of the season, we will put it to the coaches whether they wish to use the new or old rules. If this happens during the season, the rules that were in effect when the season started will remain in effect for the rest of the season, and the new rules will take effect from the following season.</p>
  <p><sup>2</sup> All FAQs will apply immediately from official publication. However, the Lord Commissioner reserves the right to overrule any FAQs if deemed disruptive to the game. Any such decisions will be first discussed on the Discord, and added below if there is agreement.</p>
  <p><sup>3</sup> The NAFAQ is, at the time of writing, the only thing resembling an FAQ for Blood Bowl Third Season, and resolves several issues with the rules. These will apply in full until such time as GW releases any official FAQs. At that point, any GW rulings will supersede NAF ones where they contradict. NAF rulings not explicitly contradicted by GW will remain in force until that changes.</p>
</div>

<h3 class="clause" id="s2-4"><span class="num">2.4</span> Scoring <a class="link" href="#s2-4">#</a></h3>
<p>Points will be awarded after each game as follows:</p>
<ul class="points">
  <li>Win <b>3</b></li>
  <li>Draw <b>1</b></li>
  <li>Loss <b>0</b></li>
  <li>3+ TDs scored <b>+1</b></li>
  <li>No TDs conceded <b>+1</b></li>
  <li>3+ Casualties caused <b>+1</b></li>
</ul>
<div class="new"><b>New for Season VII</b>Bonus points are only earned in a game that was actually played. A game resolved under <a href="#s3-2">&sect;3.2</a> &ndash; concession, no agreement reached, or neither coach attempting &ndash; awards only the points stated there, and no bonus points.</div>
<p>If two coaches are tied on points, the following tiebreakers will be used in this order:</p>
<ol class="tiebreak">
  <li>Head to Head</li>
  <li>Net TD</li>
  <li>Net CAS</li>
  <li>Net TD + Net CAS</li>
</ol>
<p>MVP awards for the game are selected semi-randomly. When finishing the game, TourPlay will allow you to select 6 players as your MVP candidates, and one will be randomly picked.</p>

<h2 class="part" id="s3"><span class="num">3</span> The Season Cycle</h2>

<h3 class="clause" id="s3-1"><span class="num">3.1</span> Pre-Season <a class="link" href="#s3-1">#</a></h3>
<p>Before a new season is due to start, the Lord Commissioner will make an announcement on the TRUBBL Discord, giving the planned start date for the next season and detailing any changes to the ruleset for the new season. If there are no objections to these changes, the new season will be created on TourPlay, and coaches will be free to sign up with their team and make changes up to and including the given start date.</p>
<p>Coaches are welcome to play any friendly games in this pre-season period, and are especially encouraged to do so if there are any newer coaches joining in, to show them the ropes.</p>
<p>All new teams will start with a 1,000,000 GP budget. Returning coaches may instead re-draft the team they finished the previous season with, under <a href="#s3-4-4">&sect;3.4.4</a>, or draft a fresh team under <a href="#s3-4-5">&sect;3.4.5</a>.</p>

<h3 class="clause" id="s3-2"><span class="num">3.2</span> Main Season <a class="link" href="#s3-2">#</a></h3>
<p>TRUBBL uses a standard round-robin format for the league, where every coach will play every other coach in their division once.</p>
<div class="new"><b>New for Season VII</b>The Premier and Second Divisions have seven coaches each, so their round robins run over <b>seven rounds, with one coach on a bye each round</b>. If you have a bye, you have no league fixture that round &ndash; enjoy the fortnight off, or use it for a friendly. The Third Division has six coaches and so runs over five rounds with no byes, finishing two rounds before the others. Third Division coaches are encouraged to spend that time on the inter-divisional friendlies described in <a href="#s3-3-2">&sect;3.3.2</a> &ndash; there are three available to every coach, and this is exactly the gap they are there to fill.</div>
<p>On the announced start date, the Lord Commissioner will draw the first two rounds, and a new round will be drawn every two weeks thereafter. TRUBBL rounds are two weeks long, <b>except the first round of the season, which is three weeks</b>, to give everyone time to get their teams drafted and their first game in the diary.</p>
<p>This is loosely enforced &ndash; we would like all matches to complete within the window, but we understand that life comes first, and sometimes it just isn't possible. The Lord Commissioner may, at his discretion, extend rounds if there are scheduling difficulties for a particular period (summer holidays or the Christmas period are the usual suspects). However, we do want to get the season done eventually, so please do try to stick to the windows given. If you think you are not going to be able to finish your game in time, please let your opponent and the Lord Commissioner know as soon as you can, so we can sort something out.</p>
<p>If a match remains unplayed for too long and is preventing the league from moving on, we will try to contact you to sort it out. If we don't hear back (this has never happened in six seasons of TRUBBL!) we will follow the procedure below:</p>
<dl class="outcomes">
  <dt>a) One coach has attempted to organise the game, but there has been no response</dt>
  <dd><b>2&ndash;0 concession</b> with 2 MVPs in favour of the coach who attempted to organise the match.</dd>
  <dt>b) Both coaches attempted to organise the game in good faith, but no agreement could be reached</dt>
  <dd><b>1&ndash;1 draw</b>, no MVPs awarded.</dd>
  <dt>c) No attempt to organise has been made by either coach</dt>
  <dd><b>0&ndash;0 draw</b>, no MVPs awarded.</dd>
</dl>
<p>None of these outcomes earns bonus points, per <a href="#s2-4">&sect;2.4</a>. TD assignments will be made semi-randomly: the coach will be allowed to nominate 6 players (no, you can't select a player with the No Hands or Loner skill, you powergamers!). Each TD will then be randomly assigned to one of the players selected.</p>
<p>Please note that the Lord Commissioner cannot verify any communication made outside of Discord, so we strongly encourage you to organise your matches in your division's games-setup channel, or at least post there once you have agreed a time and date.</p>
<div class="callout">
  <p class="shout">The Mulligan Rule</p>
  <p>Once per season, after any game, you may scrap your entire team and create a brand new 1,000 TV team using the usual TRUBBL rules. This does not need to be of the same race as you had before, but it must be one of the races that were available at the start of the season (so no mulliganing just because a new team has been released mid-way through the season!). If you want to use this option, contact the Lord Commissioner, who will sort it out for you.</p>
</div>
<div class="new"><b>New for Season VII &ndash; Night Goblins</b>The Night Goblin team is expected to be released during this season. As a one-off exception to the rule above, any coach who signs up for Season VII with a Goblin team may Mulligan into Night Goblins once the team is officially released. This uses up your Mulligan for the season in the normal way &ndash; it is an exception to the &ldquo;available at the start of the season&rdquo; restriction, not a free extra.</div>

<h3 class="clause" id="s3-3"><span class="num">3.3</span> Division Structure <a class="link" href="#s3-3">#</a></h3>

<h3 class="clause" id="s3-3-1"><span class="num">3.3.1</span> Divisions <a class="link" href="#s3-3-1">#</a></h3>
<p>TRUBBL runs three divisions: Premier, Second and Third. Twenty coaches have signed up for Season VII, so this season they are of seven, seven and six.</p>
<p>Divisions are seeded from the Season VI final tables, using the promotion and relegation rule set out last season: the top two coaches in the Second and Third Divisions go up, and the bottom two in the Premier and Second Divisions come down. Applied to Season VI, that gives:</p>
<ul>
  <li><b>Up to Premier:</b> Liripipe_, Season VI Second Division champion. Mashbat finished second and would also have gone up, but is not playing this season.</li>
  <li><b>Down to Second:</b> neiltring and Captainfalcon.</li>
  <li><b>Up to Second:</b> PlunderBeard and Stephen Bourne, first and second in the Third Division.</li>
  <li><b>Down to Third:</b> James__Sea. AlexGB finished below him and is not playing this season.</li>
</ul>
<p>Nine Season VI coaches have not returned, so the divisions do not fill by promotion and relegation alone. Where a place is left over, it goes to the next-best finisher in the division below, on the previous season's merit, and the upper divisions are filled first. For Season VII that affects one place only: colderclimate moves up to the Second Division, having finished third in the Third.</p>
<p>Coaches new to TRUBBL start in the Third Division. This season that is garvfield &ndash; welcome!</p>
<table>
  <caption>Season VII divisions</caption>
  <thead><tr><th>Premier</th><th>Second</th><th>Third</th></tr></thead>
  <tbody>
    <tr><td>Ed Wicks</td><td>neiltring &darr;</td><td>James__Sea &darr;</td></tr>
    <tr><td>spafe</td><td>Captainfalcon &darr;</td><td>BespokeFoil</td></tr>
    <tr><td>Torquemada</td><td>WedgieEdward</td><td>AlbertBH</td></tr>
    <tr><td>BearsWillEatYou</td><td>Derek_S</td><td>Krystian Kitka</td></tr>
    <tr><td>khapooks</td><td>PlunderBeard &uarr;</td><td>CookJMatt</td></tr>
    <tr><td>LazyJay346</td><td>Stephen Bourne &uarr;</td><td>garvfield</td></tr>
    <tr><td>Liripipe_ &uarr;</td><td>colderclimate &uarr;</td><td></td></tr>
  </tbody>
</table>
<p>At the end of Season VII the same rule applies: top two of the Second and Third Divisions up, bottom two of the Premier and Second Divisions down.</p>

<h3 class="clause" id="s3-3-2"><span class="num">3.3.2</span> Inter-divisional Friendlies <a class="link" href="#s3-3-2">#</a></h3>
<p>Coaches may, at any point during the season, decide to play a friendly game with a team outside of their division. These games will not provide any points for the regular season, but all other effects will apply: players gain SPP, teams gain cash, and injuries can occur.</p>
<p>Any coach may play a maximum of three such friendlies during the season, which must all be against different coaches. Arrange them in <b>#setup-games-interdivisional</b>.</p>
<p><i>Note:</i> you may, of course, play as many games as you want with other TRUBBL coaches outside of the league itself. But only three of them will count as Inter-divisional Friendlies.</p>

<h3 class="clause" id="s3-4"><span class="num">3.4</span> Post-Season <a class="link" href="#s3-4">#</a></h3>

<h3 class="clause" id="s3-4-1"><span class="num">3.4.1</span> Glittering Prizes <a class="link" href="#s3-4-1">#</a></h3>
<p>When the last game of the main season is over, it is time to crown our divisional winners! The prizes below will be awarded at the end of the season and will consist of a certificate (and possibly a small token prize). Prize money will be added to the team treasury immediately, ahead of the Play-offs. Expensive Mistakes will not apply from this point forward, so coaches may wish to save the money for re-draft, or spend it immediately to improve their play-off chances.</p>
<table>
  <caption>Awards</caption>
  <thead><tr><th>Award</th><th>Prize</th></tr></thead>
  <tbody>
    <tr class="lead"><td>Divisional Champion</td><td>100k prize money and entry to the Play-offs</td></tr>
    <tr class="lead"><td>Divisional Runner-up</td><td>50k prize money and entry to the Play-offs</td></tr>
    <tr><td>Divisional Bonze</td><td>Entry to the Bonze-offs</td></tr>
    <tr><td>Wooden Spoon (last place in the Third Division)</td><td>The knowledge that, at least, the season is over now</td></tr>
    <tr><td>The Lord Borak Medal (Most Fouls)</td><td>The approval of the Big Man himself</td></tr>
  </tbody>
</table>

<h3 class="clause" id="s3-4-2"><span class="num">3.4.2</span> Bonze-offs <a class="link" href="#s3-4-2">#</a></h3>
<p>Before the Play-offs can begin, the teams that ranked third in their division will play each other in the Bonze-offs. The coaches will play each other once, and the top two will advance to the Play-offs proper. Tiebreakers will be applied as per the regular season, but will only count stats during the Bonze-offs themselves.</p>

<h3 class="clause" id="s3-4-3"><span class="num">3.4.3</span> Play-offs <a class="link" href="#s3-4-3">#</a></h3>
<p>The Play-offs will be a 3-round knockout competition where the top coaches from every division will compete to be crowned Grand Champion for that season.</p>
<p>Initial pairings will be done through challenges. The Premier Division Champion will choose their opponent first, followed by the Second Division Champion and so on until all four pairings have been made. Coaches may not select an opponent from their own division, unless all other opponents have been challenged first. The order in which challenges are issued will be:</p>
<ol class="body">
  <li>Premier Division Champion</li>
  <li>Second Division Champion</li>
  <li>Third Division Champion</li>
  <li>Premier Division Runner-Up</li>
  <li>Second Division Runner-Up</li>
  <li>Third Division Runner-Up</li>
  <li>Bonze-offs Winner</li>
  <li>Bonze-offs Runner-Up</li>
</ol>
<p>Aside from eternal glory, the winner of the Play-offs will take home the TRUBBL Cup and receive a shiny new title on Discord. They will also receive 150,000 GC which they may spend as part of the re-draft, as described below.</p>

<h3 class="clause" id="s3-4-4"><span class="num">3.4.4</span> Re-Draft <a class="link" href="#s3-4-4">#</a></h3>
<p>TRUBBL uses the normal Redraft rules from the Third Season rulebook. The re-draft cap (i.e. the maximum amount of cash that can be spent on re-draft, including agent fees) depends on the division the team is re-drafting into:</p>
<table>
  <caption>Re-draft caps</caption>
  <thead><tr><th>Division</th><th class="n">Cap</th></tr></thead>
  <tbody>
    <tr><td>Premier</td><td class="n">1,700,000</td></tr>
    <tr><td>Second</td><td class="n">1,500,000</td></tr>
    <tr><td>Third</td><td class="n">1,300,000</td></tr>
  </tbody>
</table>
<p>However, the budget you end up with may well be higher than that if you had a good season. Any excess cash can be spent on the following Redraft Bonuses:</p>
<ul>
  <li><b>0&ndash;2 Medical Retreat [50,000]</b> &ndash; you may remove 1 niggle or permanent injury from one of your players.</li>
  <li><b>0&ndash;3 Very Dedicated Fans [50,000]</b> &ndash; you receive 1 free Dedicated Fans for the coming season.</li>
</ul>

<h3 class="clause" id="s3-4-5"><span class="num">3.4.5</span> Drafting a New Team <a class="link" href="#s3-4-5">#</a></h3>
<p>A returning coach may choose not to re-draft, and instead create a brand new team for the next season. If they do, they may choose whether to remain in the division their previous team ended up in, or to move to the Third Division. Coaches in lower divisions will be promoted to fill the gaps. Newly drafted teams for all divisions will receive 1,000,000 GC as their initial team budget.</p>

<h2 class="part" id="s4"><span class="num">4</span> The Commish-Bot</h2>
<p><b>commish-bot</b> runs the day-to-day admin of the league inside Discord. It posts round deadlines, chases games that have not been played, and will answer a handful of questions about where the season stands.</p>
<p>Everything it does for you is a subcommand of <code>/trubbl</code>. Type <code>/trubbl</code> in any channel the bot can see and Discord will offer you the list.</p>

<h3 class="clause" id="s4-1"><span class="num">4.1</span> Asking the bot something <a class="link" href="#s4-1">#</a></h3>
<p>These three reply <b>in the channel</b>, so everyone can see the answer. Use them wherever it is useful for other people to see it too.</p>
<dl class="cmds">
  <dt>/trubbl status</dt>
  <dd>Where the current round stands: its deadline, how many days are left, how many games are in and how many are still to play.
    <span class="when">Use it when you have lost track of where the season is &ndash; which is most of us, most of the time.</span></dd>
  <dt>/trubbl table</dt>
  <dd>The standings for all three divisions, with wins / draws / losses, net TD, net CAS and bonus points.
    <span class="when">Use it to settle an argument about who is actually winning.</span></dd>
  <dt>/trubbl outstanding</dt>
  <dd>Every game still to play this round, with both coaches tagged.
    <span class="when">Use it to see who the league is waiting on &ndash; including, occasionally, you.</span></dd>
</dl>

<h3 class="clause" id="s4-2"><span class="num">4.2</span> Telling the bot something <a class="link" href="#s4-2">#</a></h3>
<p>These reply <b>only to you</b>, so you can run them anywhere without cluttering a channel.</p>
<dl class="cmds">
  <dt>/trubbl link naf:&lt;your NAF number&gt;</dt>
  <dd>Ties your Discord account to your TourPlay coach record. If you have no NAF number, use <code>name:</code> and your TourPlay coach name instead.
    <span class="when">Once, at the start of the season, before anything else. Until you have linked, the bot does not know which coach you are, so <code>mygame</code>, <code>schedule</code> and <code>extend</code> cannot help you. If you voted in the sign-up poll you are probably already linked &ndash; run <code>/trubbl mygame</code> and see.</span></dd>
  <dt>/trubbl mygame</dt>
  <dd>Your fixture this round, who you are playing, and the date it has to be done by.
    <span class="when">Any time you cannot remember who you owe a game to.</span></dd>
  <dt>/trubbl schedule when:&lt;YYYY-MM-DD&gt;</dt>
  <dd>Records the date you and your opponent have agreed. Add a time if you like: <code>2026-10-14 19:00</code>.
    <span class="when">As soon as you have agreed a date. This is a note for the league, not a booking &ndash; but it tells the Lord Commissioner the game is in hand, and it stops the bot chasing you as though nothing were happening.</span></dd>
  <dt>/trubbl extend days:&lt;1&ndash;28&gt; reason:&lt;why&gt;</dt>
  <dd>Asks for more time on your fixture. The request goes to the Lord Commissioner, who approves or refuses it; the deadline does not move until he does.
    <span class="when">As soon as you know you are going to miss the window &ndash; not the night before it closes. Nobody minds an extension asked for early. See <a href="#s3-2">&sect;3.2</a>.</span></dd>
</dl>

<h3 class="clause" id="s4-3"><span class="num">4.3</span> Lord Commissioner only <a class="link" href="#s4-3">#</a></h3>
<dl class="cmds">
  <dt>/trubbl forfeit match:&lt;fixture id&gt; outcome:&lt;a, b or c&gt; side:&lt;home or away&gt;</dt>
  <dd>Applies one of the three <a href="#s3-2">&sect;3.2</a> outcomes to a game that never got played. <code>side</code> is only needed for outcome (a), to say which coach did not respond.
    <span class="when">Restricted to the Commissioner roles &ndash; anyone else who tries is politely refused. Every ruling is posted to #league-announcements, so nothing gets decided quietly.</span></dd>
</dl>

<h3 class="clause" id="s4-4"><span class="num">4.4</span> What the bot does on its own <a class="link" href="#s4-4">#</a></h3>
<p>You do not have to ask for any of this &ndash; it happens whether you want it or not:</p>
<ul>
  <li><b>When a round opens</b> &ndash; a post in <b>#season-7-dates</b> with the round number and the date it closes.</li>
  <li><b>Seven days before a round closes, and again with one day left</b> &ndash; a post in your division's games-setup channel listing the games still to play, tagging both coaches.</li>
  <li><b>Once the deadline has passed</b> &ndash; a daily post in the same channel naming what is still outstanding, until it is played or ruled on.</li>
  <li><b>When a game is ruled on</b> under <a href="#s3-2">&sect;3.2</a> &ndash; the ruling is posted in <b>#league-announcements</b>.</li>
</ul>
<div class="callout">
  <p class="shout">If the bot chases you for a game you have already played</p>
  <p>The result has not reached TourPlay. The bot reads TourPlay rather than taking anyone's word for it, so a game is only played once it is entered. Put the result in and the chasing stops.</p>
</div>
`;

const TOC = String.raw`
<ol>
  <li><a class="top" href="#s1">1 &middot; About TRUBBL</a>
    <ol>
      <li><a href="#s1-1">1.1 Who we Are</a></li>
      <li><a href="#s1-2">1.2 Contact</a></li>
      <li><a href="#s1-3">1.3 Venues</a></li>
    </ol>
  </li>
  <li><a class="top" href="#s2">2 &middot; League Rules</a>
    <ol>
      <li><a href="#s2-1">2.1 The Golden Rule</a></li>
      <li><a href="#s2-2">2.2 League Management</a></li>
      <li><a href="#s2-3">2.3 Allowed Game Rules</a></li>
      <li><a href="#s2-4">2.4 Scoring</a></li>
    </ol>
  </li>
  <li><a class="top" href="#s3">3 &middot; The Season Cycle</a>
    <ol>
      <li><a href="#s3-1">3.1 Pre-Season</a></li>
      <li><a href="#s3-2">3.2 Main Season</a></li>
      <li><a href="#s3-3">3.3 Division Structure</a></li>
      <li><a href="#s3-3-1">3.3.1 Divisions</a></li>
      <li><a href="#s3-3-2">3.3.2 Friendlies</a></li>
      <li><a href="#s3-4">3.4 Post-Season</a></li>
      <li><a href="#s3-4-1">3.4.1 Glittering Prizes</a></li>
      <li><a href="#s3-4-2">3.4.2 Bonze-offs</a></li>
      <li><a href="#s3-4-3">3.4.3 Play-offs</a></li>
      <li><a href="#s3-4-4">3.4.4 Re-Draft</a></li>
      <li><a href="#s3-4-5">3.4.5 Drafting a New Team</a></li>
    </ol>
  </li>
  <li><a class="top" href="#s4">4 &middot; The Commish-Bot</a>
    <ol>
      <li><a href="#s4-1">4.1 Asking the bot something</a></li>
      <li><a href="#s4-2">4.2 Telling the bot something</a></li>
      <li><a href="#s4-3">4.3 Lord Commissioner only</a></li>
      <li><a href="#s4-4">4.4 What it does on its own</a></li>
    </ol>
  </li>
</ol>
`;

export const RULES_VERSION = 'v1.0 &middot; Season VII';

export const RULES_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TRUBBL Season VII Rules</title>
<meta name="description" content="The rules of The Reading Undependent Blood Bowl League, Season VII.">
<meta name="theme-color" content="#0a1410">
<meta property="og:title" content="TRUBBL Season VII Rules">
<meta property="og:description" content="The Reading Undependent Blood Bowl League.">
<meta property="og:type" content="article">
${FONT_LINKS}
<style>${THEME_CSS}${PAGE_CSS}</style>
</head>
<body>
<header class="masthead">
  <div class="inner">
    <div>
      <h1 class="wordmark">TR<span class="acc">U</span>BBL</h1>
      <p class="expand">The Reading <s>I</s>Undependent Blood Bowl League</p>
    </div>
    <div class="meta">
      <span class="eyebrow">Season VII Rules</span>
      ${RULES_VERSION}
      <br><button id="themer" type="button">Switch theme</button>
    </div>
  </div>
</header>
<div class="shell">
  <nav class="toc" aria-label="Contents">${TOC}</nav>
  <article>
    <p>These are the rules of TRUBBL for Season VII. Anything not covered here is covered by <a href="#s2-1">&sect;2.1</a>, and anything <a href="#s2-1">&sect;2.1</a> does not cover, ask the Lord Commissioner.</p>
    ${BODY}
    <footer>
      <p>TRUBBL Season VII Rules, ${RULES_VERSION}. Run by Lord Commissioner Torquemada &ndash; <a href="mailto:torquemadabb@pm.me">torquemadabb@pm.me</a>.</p>
      <p>Blood Bowl is a trademark of Games Workshop Limited. TRUBBL is an unofficial, independent league and is in no way endorsed by or affiliated with Games Workshop.</p>
    </footer>
  </article>
</div>
<script>
(function () {
  var root = document.documentElement;
  var button = document.getElementById('themer');
  // Remembered choice beats the system preference; no choice means follow it.
  try {
    var saved = localStorage.getItem('trubbl-theme');
    if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
  } catch (ignored) {}

  function current() {
    var set = root.getAttribute('data-theme');
    if (set) return set;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  button.addEventListener('click', function () {
    var next = current() === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('trubbl-theme', next); } catch (ignored) {}
  });

  // Highlight whichever clause is being read.
  var links = {};
  Array.prototype.forEach.call(document.querySelectorAll('nav.toc a'), function (a) {
    links[a.getAttribute('href').slice(1)] = a;
  });
  var seen = null;
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var link = links[entry.target.id];
      if (!link || link === seen) return;
      if (seen) seen.classList.remove('here');
      link.classList.add('here');
      seen = link;
    });
  }, { rootMargin: '0px 0px -75% 0px' });
  Array.prototype.forEach.call(document.querySelectorAll('article [id]'), function (el) {
    observer.observe(el);
  });
})();
</script>
</body>
</html>`;
