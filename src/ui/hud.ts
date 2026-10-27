import {
  BUILDABLE,
  BUILDING_DEFS,
  buildingName,
  FARM_CAPACITY,
  MORALE_MAX_HOUSES,
  MORALE_PER_HOUSE,
  type BuildingType,
} from '../data/buildings';
import { epochLabel, epochNumeral, EPOCHS } from '../data/epochs';
import { canAfford, RES_COLOR, RES_LABEL, RESOURCES, type Cost } from '../data/resources';
import { bestTier, GATHER_LABEL, ROLE_DEFS, type Role } from '../data/units';
import { audio } from '../audio/engine';
import { isBusy, type Game } from '../game';
import { downloadReplay } from '../replay';
import { buildingIcon, epochIcon, formationIcon, techIcon, unitIcon } from '../render/icons';
import { BRANCHES, branchesAt, RESEARCH_BUILDINGS, TECH_BY_ID, TECHS, type Tech } from '../data/techs';
import type { Building, Entity, Unit } from '../sim/entities';
import { FORMATION_LABEL, FORMATIONS, type Formation } from '../sim/formation';
import { MAX_TECH_QUEUE, type GameEvent } from '../sim/world';

export interface CommandButton {
  key: string;
  icon?: string;
  text?: string;
  enabled: boolean;
  locked?: boolean;
  /** Highlighted as the current choice (formations). */
  active?: boolean;
  badge?: string;
  title: string;
  tooltip: string;
  action: (shift: boolean) => void;
}

const SLOT_KEYS = ['Q', 'W', 'E', 'R'];
/** Order of the production bar. */
const PROD_ORDER: BuildingType[] = ['towncenter', 'barracks', 'stable', 'workshop', 'smithy', 'academy', 'tower', 'storehouse'];
const FORMATION_KEYS: Record<Formation, string> = { line: 'N', block: 'O', wedge: 'V' };
const FORMATION_HELP: Record<Formation, string> = {
  line: 'Breite Front, wenige Reihen: alle Schützen kommen zum Zug.',
  block: 'Kompaktes Quadrat: passt durch Engstellen, hält zusammen.',
  wedge: 'Spitze voran: bricht in die feindliche Linie ein.',
};
/** Research buttons of a selected building; letters free while a building is selected. */
const TECH_KEYS = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'];

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function costHtml(cost: Cost, stock?: Record<string, number>): string {
  return RESOURCES.filter((r) => (cost[r] ?? 0) > 0)
    .map((r) => {
      const short = stock && stock[r] < (cost[r] ?? 0);
      return `<span class="cost${short ? ' short' : ''}"><i style="background:${RES_COLOR[r]}"></i>${cost[r]}</span>`;
    })
    .join('');
}

/** Inline epoch emblem plus label, e.g. for tooltips. */
function epochTag(index: number): string {
  return `<span class="ep-tag"><img src="${epochIcon(index, 32)}" alt="">${esc(epochLabel(index))}</span>`;
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** DOM overlay: resource bar, messages, selection panel, command card and dialogs. */
export class Hud {
  commands: CommandButton[] = [];
  private root: HTMLElement;
  private els: Record<string, HTMLElement>;
  private resEls: Record<string, HTMLElement> = {};
  private sig = '';
  private groupSig = '';
  private prodSig = '';
  /** Tab was pressed: the production bar shows which letter selects what. */
  private prefix = false;
  private techTab: BuildingType = 'smithy';
  private lastPanel = 0;
  private hoverCmd: number = -1;

  constructor(private game: Game) {
    this.root = game.root;
    const q = (id: string) => this.root.querySelector<HTMLElement>(`#${id}`)!;
    this.els = {
      hud: q('hud'),
      resources: q('resources'),
      pop: q('pop'),
      epoch: q('epoch'),
      clock: q('clock'),
      messages: q('messages'),
      selection: q('selection'),
      commands: q('commands'),
      tooltip: q('tooltip'),
      overlay: q('overlay'),
      pauseBtn: q('btn-pause'),
      menuBtn: q('btn-menu'),
      idleBtn: q('btn-idle'),
      idleCount: q('idle-count'),
      groups: q('groups'),
      techBtn: q('btn-tech'),
      soundBtn: q('btn-sound'),
      prodbar: q('prodbar'),
    };
    this.els.hud.hidden = false;
    this.els.resources.innerHTML = RESOURCES.map(
      (r) =>
        `<span class="res" title="${RES_LABEL[r]}"><i style="background:${RES_COLOR[r]}"></i><b>${RES_LABEL[r]}</b><span data-res="${r}">0</span></span>`,
    ).join('');
    for (const r of RESOURCES) this.resEls[r] = this.els.resources.querySelector(`[data-res="${r}"]`)!;
    this.els.messages.innerHTML = '';
    this.els.pauseBtn.onclick = () => this.game.togglePause();
    this.els.menuBtn.onclick = () => this.showPauseMenu();
    this.els.idleBtn.onclick = () => this.game.selectNextIdle();
    this.els.techBtn.onclick = () => this.showTechTree();
    this.els.soundBtn.onclick = () => this.toggleMute();
    this.updateSoundBtn();
    this.els.commands.onmouseleave = () => this.hideTooltip();
  }

  destroy(): void {
    this.els.groups.hidden = true;
    this.els.groups.innerHTML = '';
    this.els.prodbar.hidden = true;
    this.els.prodbar.innerHTML = '';
    this.els.hud.hidden = true;
    this.els.overlay.hidden = true;
    this.els.overlay.innerHTML = '';
    this.hideTooltip();
  }

  selectionChanged(): void {
    this.sig = '';
  }

  message(type: GameEvent['type'], text: string, onClick?: () => void, icon?: string): void {
    const el = document.createElement('div');
    el.className = `msg msg-${type}`;
    if (icon) {
      const img = document.createElement('img');
      img.src = icon;
      img.alt = '';
      el.append(img);
    }
    el.append(text);
    if (type === 'warn') this.game.audio.ui('error', 300);
    if (onClick) {
      el.classList.add('clickable');
      el.onclick = onClick;
    }
    this.els.messages.prepend(el);
    while (this.els.messages.children.length > 6) this.els.messages.lastElementChild!.remove();
    setTimeout(() => el.classList.add('fade'), 6000);
    setTimeout(() => el.remove(), 7000);
  }

  setPaused(paused: boolean): void {
    this.els.pauseBtn.textContent = paused ? '▶' : '❚❚';
    // In a network match someone else may resume; that must not close this player's menu.
    const kind = this.els.overlay.dataset.kind;
    if (!paused && !this.game.net && (kind === 'pause' || kind === 'sound')) this.closeOverlay();
  }

  update(): void {
    const { world, me } = this.game;
    const player = world.players[me];
    for (const r of RESOURCES) {
      const v = String(Math.floor(player.stock[r]));
      if (this.resEls[r].textContent !== v) this.resEls[r].textContent = v;
    }
    const pop = `${world.popCount(me)}/${world.popLimit()}`;
    if (this.els.pop.textContent !== pop) this.els.pop.textContent = pop;
    const epoch = EPOCHS[player.epoch];
    const research = world.buildings.find((b) => b.owner === me && b.research);
    const pending = research ? null : world.buildings.find((b) => b.owner === me && b.pendingAdvance);
    let epochHtml = `<img class="ep-icon" src="${epochIcon(player.epoch, 32)}" alt=""><span class="ep-num">${epochNumeral(player.epoch)}</span> ${esc(epoch.name)}`;
    if (research) {
      const target = research.research!.targetEpoch;
      const pct = Math.floor((research.research!.progress / research.research!.total) * 100);
      epochHtml += ` <span class="ep-arrow">→</span> <img class="ep-icon" src="${epochIcon(target, 32)}" alt=""> ${esc(EPOCHS[target].name)} ${pct} %`;
    } else if (pending) {
      const target = pending.pendingAdvance!.targetEpoch;
      epochHtml += ` <span class="ep-arrow">→</span> <img class="ep-icon" src="${epochIcon(target, 32)}" alt=""> ${esc(EPOCHS[target].name)} wartet`;
    }
    if (this.els.epoch.innerHTML !== epochHtml) this.els.epoch.innerHTML = epochHtml;
    const idle = String(this.game.idleCitizens().length);
    if (this.els.idleCount.textContent !== idle) {
      this.els.idleCount.textContent = idle;
      this.els.idleBtn.classList.toggle('has-idle', idle !== '0');
    }
    const clock = fmtTime(world.time) + (this.game.speed !== 1 ? ` · ${this.game.speed}×` : '');
    if (this.els.clock.textContent !== clock) this.els.clock.textContent = clock;

    for (const ev of world.events) this.handleEvent(ev);
    world.events.length = 0;

    const now = performance.now();
    if (now - this.lastPanel > 120) {
      this.lastPanel = now;
      this.updatePanels();
      this.updateGroups();
      this.updateProdbar();
    }
  }

  setPrefix(active: boolean): void {
    this.prefix = active;
    this.prodSig = '';
    this.updateProdbar();
  }

  /**
   * Production bar: every own building that trains or researches, with what
   * runs there (unit, research, advance) and how much waits behind it. Idle
   * buildings are marked. Click selects, Shift+click adds, double click jumps.
   */
  private updateProdbar(): void {
    const { world, me } = this.game;
    const player = world.players[me];
    const list = world
      .buildingsOf(me)
      // Towers and storehouses only while they research something, so they don't sit there as idle forever.
      .filter((b) => b.built && (BUILDING_DEFS[b.type].trains.length > 0 || b.type === 'smithy' || b.type === 'academy' || (branchesAt(b.type).length > 0 && isBusy(b))))
      .sort((a, b) => PROD_ORDER.indexOf(a.type) - PROD_ORDER.indexOf(b.type) || a.id - b.id);
    const entries = list.map((b) => {
      const unit = b.queue[0];
      const bars: Array<{ cls: string; pct: number; label: string }> = [];
      if (b.research) bars.push({ cls: 'adv', pct: b.research.progress / b.research.total, label: `Aufstieg: ${EPOCHS[b.research.targetEpoch].name}` });
      if (unit) {
        const tier = Math.max(0, bestTier(unit.role, player.epoch));
        bars.push({ cls: 'unit', pct: unit.progress / ROLE_DEFS[unit.role].trainTime, label: ROLE_DEFS[unit.role].tiers[tier].name });
      }
      if (b.tech) bars.push({ cls: 'tech', pct: b.tech.progress / b.tech.total, label: `Forschung: ${TECH_BY_ID.get(b.tech.id)!.name}` });
      const waiting = Math.max(0, b.queue.length - 1) + b.techQueue.length + (b.pendingAdvance ? 1 : 0);
      return { b, bars, waiting, idle: !isBusy(b) };
    });
    const sig =
      entries.map((e) => `${e.b.id}${e.idle ? 'i' : ''}${e.waiting}${e.bars.map((x) => `${x.cls}${Math.floor(x.pct * 20)}`).join('')}`).join(',') +
      `|${this.prefix}|${player.epoch}|${[...this.game.selection].join(',')}`;
    if (sig === this.prodSig) return;
    this.prodSig = sig;
    const el = this.els.prodbar;
    el.hidden = entries.length === 0 && !this.prefix;
    el.classList.toggle('prefix', this.prefix);
    const hint = this.prefix ? '<div class="prod-hint">Tab: jetzt Gebäudetaste drücken</div>' : '';
    el.innerHTML =
      hint +
      entries
        .map(({ b, bars, waiting, idle }) => {
          const name = buildingName(b.type, b.epoch);
          const title = `${name}${idle ? ' – untätig' : ''}${bars.map((x) => ` · ${x.label} ${Math.floor(x.pct * 100)} %`).join('')}${waiting ? ` · danach ${waiting}` : ''} (Tab, ${BUILDING_DEFS[b.type].hotkey})`;
          return (
            `<button class="prod${idle ? ' idle' : ''}${this.game.selection.has(b.id) ? ' sel' : ''}" data-prod="${b.id}" title="${esc(title)}">` +
            `<img src="${buildingIcon(b.type, b.epoch, player.color, 32)}" alt=""><span class="prod-key">${BUILDING_DEFS[b.type].hotkey}</span>` +
            (waiting ? `<span class="prod-wait">+${waiting}</span>` : '') +
            bars.map((x) => `<i class="prod-bar ${x.cls}" style="width:${Math.round(x.pct * 100)}%"></i>`).join('') +
            `</button>`
          );
        })
        .join('');
    el.querySelectorAll<HTMLElement>('[data-prod]').forEach((btn) => {
      const id = Number(btn.dataset.prod);
      btn.onclick = (ev) => {
        const b = world.get(id);
        if (!b || b.kind !== 'building') return;
        const same = this.game.selectedOwnBuildings();
        const add = ev.shiftKey && same.length > 0 && same.length === this.game.selection.size && same[0].type === b.type;
        this.game.select([id], add);
      };
      btn.ondblclick = () => {
        const b = world.get(id);
        if (b) this.game.centerOn(b.x, b.y);
      };
    });
  }

  /** Bar of control groups: number, portrait of the most common unit, head count. */
  private updateGroups(): void {
    const game = this.game;
    const color = game.world.players[game.me].color;
    const entries = [...game.groups.keys()]
      .sort()
      .map((key) => {
        const units = game.groupUnits(key);
        const counts = new Map<string, { unit: Unit; n: number }>();
        for (const u of units) {
          const k = `${u.role}:${u.tier}`;
          const c = counts.get(k);
          if (c) c.n++;
          else counts.set(k, { unit: u, n: 1 });
        }
        const top = [...counts.values()].sort((a, b) => b.n - a.n)[0];
        return { key, count: units.length, top: top?.unit };
      })
      .filter((g) => g.count > 0);
    const sig = entries.map((g) => `${g.key}:${g.count}:${g.top!.role}${g.top!.tier}`).join(',') + `|${game.activeGroup}`;
    if (sig === this.groupSig) return;
    this.groupSig = sig;
    const el = this.els.groups;
    el.hidden = entries.length === 0;
    el.innerHTML = entries
      .map(
        (g) =>
          `<button class="grp${g.key === game.activeGroup ? ' active' : ''}" data-grp="${g.key}" title="Gruppe ${g.key}: ${g.count} Einheiten (Doppelklick: hinspringen)">` +
          `<img src="${unitIcon(g.top!.role, g.top!.stats.epoch, color, 32)}" alt=""><span class="grp-key">${g.key}</span><span class="grp-count">${g.count}</span></button>`,
      )
      .join('');
    el.querySelectorAll<HTMLElement>('[data-grp]').forEach((b) => {
      b.onclick = () => game.recallGroup(b.dataset.grp!);
      b.ondblclick = () => game.recallGroup(b.dataset.grp!, true);
    });
  }

  private handleEvent(ev: GameEvent): void {
    if (ev.player !== this.game.me) return;
    if (ev.type === 'trained') return;
    if (ev.type === 'attack' && ev.x !== undefined && ev.y !== undefined) {
      const { x, y } = ev;
      this.game.lastAlert = { x, y, time: this.game.animTime };
      this.message('attack', `${ev.text} (Leertaste)`, () => this.game.centerOn(x, y));
      return;
    }
    if (ev.type === 'gameover') return;
    const tech = ev.tech ? TECH_BY_ID.get(ev.tech) : undefined;
    const icon = tech ? techIcon(tech, 32) : ev.epoch !== undefined ? epochIcon(ev.epoch, 32) : undefined;
    this.message(ev.type, ev.text, undefined, icon);
  }

  // ------------------------------------------------------------- panels

  private updatePanels(): void {
    const ents = this.game.selectedEntities();
    const commands = this.buildCommands(ents);
    const sigParts = [
      ents.map((e) => `${e.id}:${Math.ceil(e.hp)}`).join(','),
      this.game.world.players[this.game.me].epoch,
      commands.map((c) => `${c.key}${c.title}${c.enabled ? 1 : 0}${c.locked ? 1 : 0}${c.active ? 1 : 0}${c.badge ?? ''}${c.text ?? ''}`).join(''),
      this.dynamicSig(ents),
      ents.reduce((s, e) => s + (e.kind === 'unit' ? e.morale : 0), 0),
    ];
    const sig = sigParts.join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    this.commands = commands;
    this.els.selection.innerHTML = this.selectionHtml(ents);
    this.bindSelection(ents);
    this.renderCommands();
  }

  private dynamicSig(ents: Entity[]): string {
    return ents
      .slice(0, 1)
      .map((e) => {
        if (e.kind === 'building') {
          const q = e.queue.map((i) => `${i.role}${Math.floor(i.progress * 2)}`).join('');
          const tech = e.tech ? `${e.tech.id}${Math.floor(e.tech.progress)}` : '';
          const waiting = `${e.techQueue.map((j) => j.id).join('')}${e.pendingAdvance ? `a${e.pendingAdvance.ahead}` : ''}`;
          return `${e.built}${Math.floor(e.progress * 100)}${q}${e.research ? Math.floor(e.research.progress) : ''}${tech}${waiting}${e.popBlocked}`;
        }
        if (e.kind === 'unit') return `${e.order.kind}${e.queue.length}${Math.floor(e.carryAmount)}${e.morale}`;
        return `${Math.floor(e.amount)}`;
      })
      .join('');
  }

  private selectionHtml(ents: Entity[]): string {
    const { world, me } = this.game;
    if (ents.length === 0) {
      return `<div class="sel-empty">Linksklick: auswählen · Rechtsklick: Befehl<br>Ziehen: Rahmenauswahl · F1: Hilfe</div>`;
    }
    if (ents.length > 1 && ents.every((e) => e.kind === 'building')) {
      const blds = ents as Building[];
      return `<div class="sel-multi">${blds
        .map((b) => {
          const waiting = b.queue.length + b.techQueue.length + (b.tech ? 1 : 0) + (b.research || b.pendingAdvance ? 1 : 0);
          return `<button class="sel-group${isBusy(b) ? '' : ' idle'}" data-bld="${b.id}" title="${esc(buildingName(b.type, b.epoch))}: ${waiting ? `${waiting} in Arbeit` : 'untätig'}"><img src="${buildingIcon(b.type, b.epoch, world.players[b.owner].color, 40)}"><span>${waiting || ''}</span></button>`;
        })
        .join('')}</div><div class="dim sel-note">Ausbilden und Forschen gehen an das Gebäude mit der kürzesten Warteschlange.</div>`;
    }
    if (ents.length > 1) {
      const groups = new Map<string, { unit: Unit; count: number }>();
      for (const e of ents) {
        if (e.kind !== 'unit') continue;
        const key = `${e.role}:${e.tier}:${e.owner}`;
        const g = groups.get(key);
        if (g) g.count++;
        else groups.set(key, { unit: e, count: 1 });
      }
      const units = ents.filter((e): e is Unit => e.kind === 'unit');
      const avg = units.length ? units.reduce((s, u) => s + u.morale, 0) / units.length : 0;
      const moraleLine = units.length
        ? `<div class="morale-line${avg > 0 ? ' up' : ''}">${avg > 0 ? `Moral Ø +${Math.round(avg * MORALE_PER_HOUSE * 100)} %` : 'Keine Moral – eigene Häuser in der Nähe stärken Einheiten'}</div>`
        : '';
      return `${moraleLine}<div class="sel-multi">${[...groups.entries()]
        .map(
          ([key, g]) =>
            `<button class="sel-group" data-group="${key}" title="${esc(g.unit.stats.name)}"><img src="${unitIcon(g.unit.role, g.unit.stats.epoch, world.players[g.unit.owner].color, 40)}"><span>${g.count}</span></button>`,
        )
        .join('')}</div>`;
    }
    const e = ents[0];
    const hpBar = (hp: number, max: number) =>
      `<div class="hpbar"><div style="width:${Math.max(0, Math.min(100, (hp / max) * 100))}%"></div><span>${Math.ceil(hp)} / ${Math.round(max)}</span></div>`;
    const owner = e.owner >= 0 ? world.players[e.owner] : null;
    const ownerLine = owner ? `<span class="owner" style="color:${owner.color}">${esc(owner.name)}</span>` : '';

    if (e.kind === 'unit') {
      const s = e.stats;
      const def = ROLE_DEFS[e.role];
      let activity = '';
      if (e.order.kind === 'gather') activity = GATHER_LABEL[e.order.res];
      else if (e.order.kind === 'build') activity = 'baut';
      else if (e.order.kind === 'deposit') activity = 'lagert ein';
      else if (e.order.kind === 'explore') activity = 'erkundet';
      else if (e.order.kind === 'attack') activity = 'kämpft';
      else if (e.order.kind === 'move') activity = 'unterwegs';
      else if (e.order.kind === 'patrol') activity = 'patrouilliert';
      else activity = 'untätig';
      if (e.queue.length) activity += `, dann ${e.queue.length} ${e.queue.length === 1 ? 'weiterer Befehl' : 'weitere Befehle'}`;
      const carry = e.carry && e.carryAmount > 0 ? ` · trägt ${Math.floor(e.carryAmount)} ${RES_LABEL[e.carry]}` : '';
      const pct = Math.round(e.morale * MORALE_PER_HOUSE * 100);
      const moraleLine =
        e.owner !== me
          ? ''
          : e.morale > 0
            ? `<div class="morale-line up">${'★'.repeat(e.morale)}${'☆'.repeat(MORALE_MAX_HOUSES - e.morale)} Moral: +${pct} % Angriff, −${pct} % Schaden</div>`
            : '<div class="morale-line">☆ Keine Moral – eigene Häuser in der Nähe stärken Einheiten</div>';
      return `<div class="sel-single">
        <img class="portrait" src="${unitIcon(e.role, s.epoch, owner!.color, 64)}">
        <div class="sel-info">
          <div class="sel-name">${esc(s.name)} ${ownerLine}</div>
          <div class="sel-sub">${esc(def.label)} · ${epochTag(s.epoch)} · ${activity}${carry}</div>
          ${hpBar(e.hp, e.maxHp)}
          ${moraleLine}
          <div class="stats"><span>Angriff ${s.dmg}</span><span>Rüstung ${s.armor}</span><span>Reichweite ${s.range.toFixed(1)}</span><span>Tempo ${s.speed.toFixed(1)}</span></div>
          ${
            e.role === 'scout'
              ? '<div class="counter">Schnell und weitsichtig, kämpft kaum. <b>E</b>: Erkunden</div>'
              : e.role !== 'citizen'
                ? `<div class="counter"><b>Stark gegen:</b> ${esc(def.strongVs)} · <b>Schwach gegen:</b> ${esc(def.weakVs)}</div>`
                : ''
          }
        </div></div>`;
    }

    if (e.kind === 'building') {
      const def = BUILDING_DEFS[e.type];
      const lines: string[] = [];
      if (!e.built) lines.push(`Im Bau: ${Math.floor(e.progress * 100)} %`);
      if (e.tech && e.owner === me) {
        const t = TECH_BY_ID.get(e.tech.id)!;
        lines.push(
          `<div class="progress research tech-progress" data-cancel-tech title="Klick: Forschung abbrechen (Rohstoffe zurück)"><div style="width:${(e.tech.progress / e.tech.total) * 100}%"></div><span>Forschung: ${esc(t.name)}</span></div>`,
        );
      }
      if (e.pendingAdvance && e.owner === me) {
        const n = e.pendingAdvance.ahead;
        lines.push(`Aufstieg: ${esc(EPOCHS[e.pendingAdvance.targetEpoch].name)} – wartet auf ${n} ${n === 1 ? 'Einheit' : 'Einheiten'}`);
      }
      if (e.research) {
        lines.push(
          `<div class="progress research"><div style="width:${(e.research.progress / e.research.total) * 100}%"></div><span>Aufstieg: ${esc(EPOCHS[e.research.targetEpoch].name)}</span></div>`,
        );
      }
      if (e.type === 'farm' && e.built) lines.push(`Bauern: ${world.farmWorkers(e)} / ${FARM_CAPACITY}`);
      if (e.type === 'house') lines.push('Der Kreis auf dem Boden zeigt, wie weit die Moral reicht.');
      if (e.popBlocked) lines.push('<span class="warn">Bevölkerungslimit erreicht</span>');
      let queue = '';
      if ((e.queue.length || e.pendingAdvance) && e.owner === me) {
        const items = e.queue.map((item, i) => {
          const tier = Math.max(0, bestTier(item.role, world.players[me].epoch));
          const pct = i === 0 ? (item.progress / ROLE_DEFS[item.role].trainTime) * 100 : 0;
          return `<button class="q-item" data-cancel="${i}" title="Abbrechen"><img src="${unitIcon(item.role, ROLE_DEFS[item.role].tiers[tier].epoch, owner!.color, 32)}"><div class="q-bar" style="width:${pct}%"></div></button>`;
        });
        if (e.pendingAdvance) {
          // The advance waits behind the units queued before it.
          items.splice(
            e.pendingAdvance.ahead,
            0,
            `<button class="q-item q-epoch" data-cancel="-1" title="Aufstieg abbrechen (Rohstoffe zurück)"><img src="${epochIcon(e.pendingAdvance.targetEpoch, 32)}"></button>`,
          );
        }
        queue = `<div class="queue">${items.join('')}</div>`;
      }
      if (e.techQueue.length && e.owner === me) {
        queue += `<div class="queue tech-queue"><span class="dim">Danach:</span>${e.techQueue
          .map((job, i) => {
            const t = TECH_BY_ID.get(job.id)!;
            return `<button class="q-item" data-cancel-tech="${i}" title="${esc(t.name)} – Klick: abbrechen (Rohstoffe zurück)"><img src="${techIcon(t, 32)}"></button>`;
          })
          .join('')}</div>`;
      }
      return `<div class="sel-single">
        <img class="portrait" src="${buildingIcon(e.type, e.epoch, owner!.color, 64)}">
        <div class="sel-info">
          <div class="sel-name">${esc(buildingName(e.type, e.epoch))} ${ownerLine}</div>
          <div class="sel-sub">${esc(def.description)}</div>
          ${hpBar(e.hp, e.maxHp)}
          ${lines.map((l) => `<div class="line">${l}</div>`).join('')}
          ${queue}
        </div></div>`;
    }

    const names: Record<string, string> = { tree: 'Baum', berries: 'Beerenstrauch', stone: 'Steinbruch', gold: 'Goldmine', iron: 'Eisenmine' };
    return `<div class="sel-single"><div class="sel-info">
      <div class="sel-name">${names[e.nodeType]}</div>
      <div class="sel-sub">${RES_LABEL[e.res]}: ${Math.floor(e.amount)} übrig</div>
    </div></div>`;
  }

  private bindSelection(ents: Entity[]): void {
    this.els.selection.querySelectorAll<HTMLElement>('[data-group]').forEach((el) => {
      el.onclick = () => {
        const [role, tier, owner] = el.dataset.group!.split(':');
        const ids = ents
          .filter((e): e is Unit => e.kind === 'unit' && e.role === role && String(e.tier) === tier && String(e.owner) === owner)
          .map((e) => e.id);
        this.game.select(ids);
      };
    });
    this.els.selection.querySelectorAll<HTMLElement>('[data-bld]').forEach((el) => {
      el.onclick = () => this.game.select([Number(el.dataset.bld)]);
    });
    const b = ents[0];
    if (b && b.kind === 'building') {
      this.els.selection.querySelectorAll<HTMLElement>('[data-cancel-tech]').forEach((el) => {
        const index = el.dataset.cancelTech;
        el.onclick = () => this.game.cancelTech(b.id, index ? Number(index) : undefined);
      });
      this.els.selection.querySelectorAll<HTMLElement>('[data-cancel]').forEach((el) => {
        el.onclick = () => this.game.cancelQueue(b.id, Number(el.dataset.cancel));
      });
    }
  }

  // ----------------------------------------------------------- commands

  private buildCommands(ents: Entity[]): CommandButton[] {
    const game = this.game;
    if (game.viewer) return [];
    const { world, me } = game;
    const player = world.players[me];
    const color = player.color;
    const cmds: CommandButton[] = [];
    const own = ents.filter((e) => e.kind !== 'resource' && e.owner === me);
    const units = own.filter((e): e is Unit => e.kind === 'unit');

    if (units.some((u) => u.role === 'citizen')) {
      for (const type of BUILDABLE) {
        const def = BUILDING_DEFS[type];
        const unlocked = world.buildingUnlocked(me, type);
        const name = buildingName(type, player.epoch);
        cmds.push({
          key: def.hotkey,
          icon: buildingIcon(type, player.epoch, color),
          enabled: unlocked && canAfford(player.stock, def.cost),
          locked: !unlocked,
          title: name,
          tooltip:
            `<b>${esc(name)}</b> <kbd>${def.hotkey}</kbd><div>${costHtml(def.cost, player.stock)}</div><p>${esc(def.description)}</p>` +
            (unlocked ? '' : `<p class="warn">Verfügbar ab: ${epochTag(def.minEpoch)}</p>`),
          action: () => {
            if (!unlocked) return;
            if (!canAfford(player.stock, def.cost)) {
              this.message('warn', `Nicht genug Rohstoffe für ${name}.`);
              return;
            }
            game.beginPlacement(type);
          },
        });
      }
    }
    if (units.some((u) => u.role !== 'citizen')) {
      cmds.push({
        key: 'A',
        text: 'Angriff',
        enabled: true,
        title: 'Angriffsbewegung',
        tooltip: '<b>Angriffsbewegung</b> <kbd>A</kbd><p>Dann Linksklick auf ein Ziel: Einheiten greifen alles auf dem Weg an.</p>',
        action: () => {
          game.mode = 'attackMove';
        },
      });
      cmds.push({
        key: 'R',
        text: 'Patrouille',
        enabled: true,
        title: 'Patrouille',
        tooltip:
          '<b>Patrouille</b> <kbd>R</kbd><p>Dann Linksklick: Die Einheiten pendeln zwischen ihrem Standort und dem Ziel und greifen alles an, was ihnen begegnet. Umschalt+Klick fügt weitere Punkte zur Runde hinzu.</p>',
        action: () => {
          game.mode = 'patrol';
        },
      });
      // Formations only for armies; with citizens the building buttons need the room.
      if (!units.some((u) => u.role === 'citizen')) {
        const current = game.selectionFormation(units);
        for (const f of FORMATIONS) {
          cmds.push({
            key: FORMATION_KEYS[f],
            icon: formationIcon(f),
            enabled: true,
            active: f === current,
            title: `Formation: ${FORMATION_LABEL[f]}`,
            tooltip: `<b>Formation: ${FORMATION_LABEL[f]}</b> <kbd>${FORMATION_KEYS[f]}</kbd><p>${FORMATION_HELP[f]}</p><p class="dim">Fernkampf und Belagerung stehen immer hinten. Alle kommen gleichzeitig an. Rechts ziehen legt die Blickrichtung fest.</p>`,
            action: () => game.setFormation(f),
          });
        }
      }
    }
    if (units.length) {
      cmds.push({
        key: 'E',
        text: 'Erkunden',
        enabled: true,
        title: 'Erkunden',
        tooltip: '<b>Erkunden</b> <kbd>E</kbd><p>Die Einheiten ziehen selbstständig zum nächsten unerkundeten Gebiet, bis die Karte bekannt ist. Sie kämpfen dabei nicht.</p>',
        action: () => game.explore(),
      });
      cmds.push({
        key: 'X',
        text: 'Halt',
        enabled: true,
        title: 'Halt',
        tooltip: '<b>Halt</b> <kbd>X</kbd><p>Alle Befehle abbrechen.</p>',
        action: () => game.stop(),
      });
    }

    // One building, or several finished ones of a type: orders go to the least busy.
    const first = own[0];
    const sites =
      first && first.kind === 'building' && own.every((e) => e.kind === 'building' && e.built && e.type === first.type) ? (own as Building[]) : [];
    const b = sites[0] ?? null;
    if (b) {
      const def = BUILDING_DEFS[b.type];
      def.trains.forEach((role, i) => cmds.push(this.trainButton(sites, role, SLOT_KEYS[i])));
      if (b.type === 'towncenter') {
        if (b.research || b.pendingAdvance) {
          cmds.push({
            key: 'E',
            text: 'Abbruch',
            enabled: true,
            title: 'Aufstieg abbrechen',
            tooltip: '<b>Aufstieg abbrechen</b><p>Rohstoffe werden erstattet.</p>',
            action: () => game.cancelQueue(b.id, -1),
          });
        } else if (player.epoch < world.settings.maxEpoch) {
          const next = EPOCHS[player.epoch + 1];
          const busy = world.isResearching(me);
          const missing = world.missingRequirements(me);
          const techs = world.missingTechs(me);
          const techsOk = techs.have >= techs.need;
          const reqs =
            (Object.entries(next.requires) as Array<[BuildingType, number]>)
              .map(([type, need]) => {
                const gap = missing.find((m) => m.type === type);
                const have = gap ? gap.have : need;
                return `<li class="${gap ? 'missing' : 'ok'}">${gap ? '✘' : '✔'} ${esc(buildingName(type, player.epoch))} <span class="dim">${have}/${need}</span></li>`;
              })
              .join('') +
            `<li class="${techsOk ? 'ok' : 'missing'}">${techsOk ? '✔' : '✘'} Techniken der Epoche ${epochNumeral(player.epoch)} <span class="dim">${Math.min(techs.have, techs.need)}/${techs.need}</span></li>`;
          cmds.push({
            key: 'E',
            icon: epochIcon(next.index, 44),
            enabled: !busy && missing.length === 0 && techsOk && canAfford(player.stock, next.advanceCost),
            badge: missing.length || !techsOk ? '!' : undefined,
            title: `Aufstieg: ${epochLabel(next.index)}`,
            tooltip:
              `<b>Aufstieg: ${epochTag(next.index)}</b> <kbd>E</kbd><div class="period">${esc(next.period)}</div><div>${costHtml(
                next.advanceCost,
                player.stock,
              )}</div>` +
              (reqs ? `<div class="reqs-title">Benötigt:</div><ul class="reqs">${reqs}</ul>` : '') +
              `<p>${esc(next.description)}</p><p>Dauer: ${next.advanceTime} s</p>`,
            action: () => game.advance(b.id),
          });
        }
      }
      branchesAt(b.type).forEach((branch, i) => {
        const btn = this.techButton(sites, branch.id, TECH_KEYS[i]);
        if (btn) cmds.push(btn);
      });
    }
    if (own.length) {
      const onlyUnits = own.every((e) => e.kind === 'unit');
      const text = onlyUnits ? 'Entlassen' : 'Abriss';
      cmds.push({
        key: 'Entf',
        text,
        enabled: true,
        title: text,
        tooltip: onlyUnits
          ? '<b>Entlassen</b> <kbd>Entf</kbd><p>Entfernt die ausgewählten Einheiten.</p>'
          : '<b>Abriss</b> <kbd>Entf</kbd><p>Reißt die Auswahl ab. Baustellen erstatten den noch nicht verbauten Anteil.</p>',
        action: () => game.deleteSelection(),
      });
    }
    return cmds;
  }

  /**
   * Button for the next level of a branch that is neither researched nor on
   * its way; clicking again queues the level after it. Null once every level
   * is done or planned.
   */
  private techButton(sites: Building[], branchId: string, key: string): CommandButton | null {
    const game = this.game;
    const { world, me } = game;
    const player = world.players[me];
    const planned = world.plannedTechs(me);
    const tech = TECHS.find((t) => t.branch.id === branchId && !planned.has(t.id));
    if (!tech) return null;
    const inBranch = (id: string) => TECH_BY_ID.get(id)!.branch.id === branchId;
    const busy = sites.reduce((n, s) => n + (s.tech && inBranch(s.tech.id) ? 1 : 0) + s.techQueue.filter((j) => inBranch(j.id)).length, 0);
    const future = tech.epoch > player.epoch;
    const missingReq = tech.requires.filter((r) => !planned.has(r)).map((r) => TECH_BY_ID.get(r)!);
    const plannable = world.techPlannable(me, tech);
    const room = sites.some((s) => s.techQueue.length < MAX_TECH_QUEUE);
    return {
      key,
      icon: techIcon(tech, 44),
      enabled: plannable && room && canAfford(player.stock, tech.cost),
      locked: future,
      badge: busy ? String(busy) : undefined,
      title: tech.name,
      tooltip:
        this.techTooltip(tech, key) +
        (busy ? `<p class="dim">${busy} ${busy === 1 ? 'Stufe dieses Zweigs läuft oder wartet' : 'Stufen dieses Zweigs laufen oder warten'}.</p>` : '') +
        '<p class="dim">Weitere Klicks reihen die nächsten Stufen ein.</p>',
      action: () => {
        if (!plannable) {
          if (missingReq.length) this.message('warn', `Zuerst erforschen: ${missingReq.map((t) => t.name).join(', ')}`);
          return;
        }
        if (!room) {
          this.message('warn', 'Die Forschungs-Warteschlange ist voll.');
          return;
        }
        game.research(sites, tech.id);
      },
    };
  }

  private techTooltip(tech: Tech, key?: string): string {
    const player = this.game.world.players[this.game.me];
    const planned = this.game.world.plannedTechs(this.game.me);
    const missingReq = tech.requires.filter((r) => !planned.has(r)).map((r) => TECH_BY_ID.get(r)!);
    return (
      `<b>${esc(tech.name)}</b>${key ? ` <kbd>${key}</kbd>` : ''} <span class="dim">${esc(tech.branch.name)} · Stufe ${tech.level + 1}/${tech.branch.levels.length}</span>` +
      `<div>${costHtml(tech.cost, player.stock)}</div><p>${esc(tech.branch.text)}</p>` +
      `<p class="dim">Ab ${epochTag(tech.epoch)} · Dauer ${tech.time} s</p>` +
      (missingReq.length ? `<p class="warn">Benötigt: ${missingReq.map((t) => esc(t.name)).join(', ')}</p>` : '') +
      (tech.epoch === player.epoch && player.epoch < this.game.world.settings.maxEpoch ? '<p class="dim">Zählt für den nächsten Aufstieg.</p>' : '')
    );
  }

  private trainButton(sites: Building[], role: Role, key: string): CommandButton {
    const { world, me } = this.game;
    const player = world.players[me];
    const tier = bestTier(role, player.epoch);
    const def = ROLE_DEFS[role];
    if (tier < 0) {
      const first = def.tiers[0];
      return {
        key,
        icon: unitIcon(role, first.epoch, player.color),
        enabled: false,
        locked: true,
        title: def.label,
        tooltip: `<b>${esc(first.name)}</b><p class="warn">Verfügbar ab: ${epochTag(first.epoch)}</p>`,
        action: () => {},
      };
    }
    const s = world.unitStatsFor(me, role, tier);
    const queued = sites.reduce((n, b) => n + b.queue.filter((q) => q.role === role).length, 0);
    const nextTier = def.tiers[tier + 1];
    return {
      key,
      icon: unitIcon(role, s.epoch, player.color),
      enabled: canAfford(player.stock, s.cost),
      badge: queued ? String(queued) : undefined,
      title: s.name,
      tooltip:
        `<b>${esc(s.name)}</b> <kbd>${key}</kbd> <span class="dim">${esc(def.label)}</span><div>${costHtml(s.cost, player.stock)}</div>` +
        `<div class="stats"><span>LP ${s.hp}</span><span>Angriff ${s.dmg}</span><span>Rüstung ${s.armor}</span><span>Reichweite ${s.range.toFixed(1)}</span></div>` +
        (role === 'citizen'
          ? '<p>Sammelt Rohstoffe und errichtet Gebäude.</p>'
          : role === 'scout'
            ? '<p>Schnell, große Sichtweite, kämpft kaum. Ideal zum Erkunden (Taste E).</p>'
            : `<p><b>Stark gegen:</b> ${esc(def.strongVs)}<br><b>Schwach gegen:</b> ${esc(def.weakVs)}</p>`) +
        (nextTier ? `<p class="dim">Nächste Stufe: ${esc(nextTier.name)} (${epochTag(nextTier.epoch)})</p>` : '') +
        `<p class="dim">Umschalt+Klick: 5 Stück</p>`,
      action: (shift) => this.game.train(sites, role, shift ? 5 : 1),
    };
  }

  private renderCommands(): void {
    const el = this.els.commands;
    el.innerHTML = this.commands
      .map(
        (c, i) =>
          `<button class="cmd${c.enabled ? '' : ' disabled'}${c.locked ? ' locked' : ''}${c.active ? ' active' : ''}" data-i="${i}" aria-label="${esc(c.title)}">` +
          (c.icon ? `<img src="${c.icon}" alt="">` : `<span class="cmd-text">${esc(c.text ?? '')}</span>`) +
          `<span class="hk">${c.key}</span>${c.badge ? `<span class="badge">${c.badge}</span>` : ''}</button>`,
      )
      .join('');
    el.querySelectorAll<HTMLButtonElement>('button.cmd').forEach((btn) => {
      const i = Number(btn.dataset.i);
      btn.onclick = (ev) => {
        this.game.audio.ui('click', 40);
        this.commands[i]?.action(ev.shiftKey);
      };
      btn.onmouseenter = () => {
        this.hoverCmd = i;
        this.showTooltip(this.commands[i].tooltip);
      };
      btn.onmouseleave = () => {
        if (this.hoverCmd === i) this.hideTooltip();
      };
    });
    if (this.hoverCmd >= 0 && this.commands[this.hoverCmd]) this.showTooltip(this.commands[this.hoverCmd].tooltip);
  }

  /** Runs the command bound to a hotkey; returns whether one matched. */
  hotkey(key: string, shift: boolean): boolean {
    const cmd = this.commands.find((c) => c.key === key.toUpperCase());
    if (!cmd || cmd.locked) return false;
    this.game.audio.ui('click', 40);
    cmd.action(shift);
    this.sig = '';
    return true;
  }

  private showTooltip(html: string): void {
    this.els.tooltip.innerHTML = html;
    this.els.tooltip.hidden = false;
  }

  private hideTooltip(): void {
    this.hoverCmd = -1;
    this.els.tooltip.hidden = true;
  }

  // ------------------------------------------------------------ overlays

  private openOverlay(kind: string, html: string): void {
    const o = this.els.overlay;
    o.dataset.kind = kind;
    o.innerHTML = `<div class="dialog">${html}</div>`;
    o.hidden = false;
  }

  closeOverlay(): void {
    this.els.overlay.hidden = true;
    this.els.overlay.dataset.kind = '';
  }

  overlayOpen(): boolean {
    return !this.els.overlay.hidden;
  }

  showPauseMenu(): void {
    const { game } = this;
    game.menuPause(true);
    const quit = game.viewer ? 'Wiedergabe beenden' : game.net ? 'Spiel verlassen' : 'Aufgeben &amp; Hauptmenü';
    const note = game.net
      ? `<p class="dim">Mehrspieler: Das Spiel läuft weiter. Verlässt du es, übernimmt der Computer dein Reich${game.net.kind === 'host' ? ' – als Gastgeber beendest du die Partie für alle' : ''}.</p>`
      : '';
    this.openOverlay(
      'pause',
      `<h2>${game.net ? 'Menü' : 'Pause'}</h2>${note}
       <div class="dialog-buttons">
         <button data-act="resume" class="primary">Weiterspielen</button>
         <button data-act="help">Steuerung</button>
         <button data-act="sound">Ton &amp; Musik</button>
         ${game.recorder ? '<button data-act="save">Wiedergabe speichern</button>' : ''}
         <button data-act="quit">${quit}</button>
       </div>`,
    );
    this.bindOverlay({
      resume: () => game.menuPause(false),
      help: () => this.showHelp(),
      sound: () => this.showSound(),
      save: () => game.recorder && downloadReplay(game.recorder.replay),
      quit: () => game.exitToMenu(),
    });
  }

  /** The network match is over for this player (host gone, connection lost). */
  showNetLost(reason: string, save: () => void): void {
    this.openOverlay(
      'gameover',
      `<h2>Verbindung beendet</h2>
       <p>${esc(reason)}</p>
       <p class="dim">Die Partie bis hierher lässt sich als Wiedergabe speichern und später ansehen.</p>
       <div class="dialog-buttons"><button data-act="save">Wiedergabe speichern</button><button data-act="quit" class="primary">Hauptmenü</button></div>`,
    );
    this.bindOverlay({ save, quit: () => this.game.exitToMenu() });
  }

  toggleMute(): void {
    audio.setSettings({ muted: !audio.settings.muted });
    this.updateSoundBtn();
    if (this.els.overlay.dataset.kind === 'sound') this.showSound();
  }

  private updateSoundBtn(): void {
    this.els.soundBtn.textContent = audio.settings.muted ? '🔇' : '🔊';
    this.els.soundBtn.classList.toggle('muted', audio.settings.muted);
  }

  /** Volume sliders; changes apply (and are remembered) right away. */
  showSound(): void {
    this.game.menuPause(true);
    const s = audio.settings;
    const slider = (key: 'master' | 'sfx' | 'music', label: string) =>
      `<label class="vol"><span>${label}</span><input type="range" min="0" max="100" step="5" value="${Math.round(s[key] * 100)}" data-vol="${key}"><output>${Math.round(s[key] * 100)} %</output></label>`;
    this.openOverlay(
      'sound',
      `<h2>Ton &amp; Musik</h2>
       <div class="vol-list">
         ${slider('master', 'Gesamt')}
         ${slider('sfx', 'Effekte')}
         ${slider('music', 'Musik')}
         <label class="vol-mute"><input type="checkbox" data-mute${s.muted ? ' checked' : ''}> Stumm (Strg+M)</label>
       </div>
       <p class="dim">Alle Klänge und die Musik entstehen live im Browser – passend zur Epoche. Im Kampf wird die Musik treibender.</p>
       <div class="dialog-buttons"><button data-act="back">Zurück</button><button data-act="resume" class="primary">Weiterspielen</button></div>`,
    );
    this.els.overlay.querySelectorAll<HTMLInputElement>('[data-vol]').forEach((input) => {
      input.oninput = () => {
        const key = input.dataset.vol as 'master' | 'sfx' | 'music';
        audio.setSettings({ [key]: Number(input.value) / 100 });
        input.nextElementSibling!.textContent = `${input.value} %`;
      };
      input.onchange = () => {
        if (input.dataset.vol !== 'music') this.game.audio.ui('built', 0);
      };
    });
    const mute = this.els.overlay.querySelector<HTMLInputElement>('[data-mute]')!;
    mute.onchange = () => {
      audio.setSettings({ muted: mute.checked });
      this.updateSoundBtn();
    };
    this.bindOverlay({ back: () => this.showPauseMenu(), resume: () => this.game.menuPause(false) });
  }

  showHelp(): void {
    this.game.menuPause(true);
    this.openOverlay(
      'pause',
      `<h2>Steuerung</h2>
      <table class="help">
        <tr><td>Linksklick / Ziehen</td><td>Auswählen / Rahmenauswahl</td></tr>
        <tr><td>Doppelklick</td><td>Alle sichtbaren Einheiten dieses Typs</td></tr>
        <tr><td>Rechtsklick</td><td>Bewegen, Angreifen, Sammeln, Bauen, Einlagern – je nach Ziel</td></tr>
        <tr><td>Rechts ziehen (nichts gewählt) / Mitte ziehen</td><td>Karte verschieben</td></tr>
        <tr><td>Rechtsklick mit Gebäude</td><td>Sammelpunkt setzen (Umschalt: Wegpunkte anhängen)</td></tr>
        <tr><td>A, dann Klick</td><td>Angriffsbewegung</td></tr>
        <tr><td>R, dann Klick</td><td>Patrouille (Umschalt+Klick: weitere Punkte)</td></tr>
        <tr><td>Umschalt + Rechtsklick</td><td>Befehl anhängen (Wegpunkte, Ziele, Bauaufträge); gehaltene Umschalttaste zeigt die Pläne</td></tr>
        <tr><td>Rechts ziehen (Einheiten gewählt)</td><td>Ziel und Blickrichtung der Formation (Pfeil)</td></tr>
        <tr><td>N / O / V</td><td>Formation Linie / Block / Keil</td></tr>
        <tr><td>E</td><td>Erkunden (Einheiten ausgewählt)</td></tr>
        <tr><td>M / G, dann ziehen</td><td>Mauer / Tor als Linie bauen</td></tr>
        <tr><td>Buchstaben</td><td>Befehle im Befehlsfeld (siehe Tasten auf den Knöpfen)</td></tr>
        <tr><td>Umschalt + Bauen/Ausbilden</td><td>Mehrfach platzieren, Bauaufträge nacheinander / 5 Einheiten</td></tr>
        <tr><td>Strg + 1–9, dann 1–9</td><td>Gruppe speichern / wählen (2× = hinspringen)</td></tr>
        <tr><td>Tab, dann Bau-Taste</td><td>Gebäude dieses Typs wählen, untätige zuerst; nochmal = durchschalten, 2× schnell = hinspringen</td></tr>
        <tr><td>Doppelklick / Rahmen auf Gebäude</td><td>Mehrere Gebäude eines Typs: Ausbilden und Forschen verteilen sich</td></tr>
        <tr><td>Punkt (.)</td><td>Nächster untätiger Bürger</td></tr>
        <tr><td>Entf</td><td>Auswahl abreißen / entlassen</td></tr>
        <tr><td>Pos1</td><td>Dorfzentrum</td></tr>
        <tr><td>Leertaste</td><td>Zum letzten Angriff springen</td></tr>
        <tr><td>Pfeiltasten / Bildschirmrand / Mausrad</td><td>Kamera bewegen / zoomen</td></tr>
        <tr><td>+ / −</td><td>Spielgeschwindigkeit</td></tr>
        <tr><td>F2</td><td>Technologiebaum</td></tr>
        <tr><td>Strg + M</td><td>Ton ein/aus (Lautstärke: Menü → Ton &amp; Musik)</td></tr>
        <tr><td>P / Esc</td><td>Pause / Menü (im Mehrspieler pausiert P für alle)</td></tr>
        <tr><td>Enter / Umschalt + Enter</td><td>Mehrspieler: Chat an alle / ans Team (Tab wechselt beim Schreiben)</td></tr>
        <tr><td>Alt + Klick</td><td>Mehrspieler: Stelle für Verbündete markieren (auch auf der Minikarte)</td></tr>
      </table>
      <h3>Kampfdreieck</h3>
      <p>Sturminfanterie › Abwehrinfanterie › Kavallerie &amp; Fahrzeuge › Fernkampf › Sturminfanterie. Belagerung zerstört Gebäude.</p>
      <div class="dialog-buttons"><button data-act="resume" class="primary">Weiterspielen</button></div>`,
    );
    this.bindOverlay({ resume: () => this.game.menuPause(false) });
  }

  /** Overlay with the whole tree: one tab per research building, one row per branch. */
  showTechTree(tab: BuildingType = this.techTab): void {
    const { world, me } = this.game;
    const player = world.players[me];
    this.techTab = tab;
    this.game.menuPause(true);
    const gap = world.missingTechs(me);
    const done = player.techs.size;
    const tabs = RESEARCH_BUILDINGS.map((t) => {
      const count = BRANCHES.filter((b) => b.building === t).reduce((n, b) => n + b.levels.length, 0);
      const have = TECHS.filter((x) => x.building === t && player.techs.has(x.id)).length;
      return `<button class="tt-tab${t === tab ? ' active' : ''}" data-tab="${t}">${esc(buildingName(t, player.epoch))} <span class="dim">${have}/${count}</span></button>`;
    }).join('');
    const running = new Map<string, number>();
    const queued = new Set<string>();
    for (const b of world.buildingsOf(me)) {
      if (b.tech) running.set(b.tech.id, b.tech.progress / b.tech.total);
      for (const j of b.techQueue) queued.add(j.id);
    }
    const rows = branchesAt(tab)
      .map((branch) => {
        const cells = TECHS.filter((t) => t.branch === branch)
          .map((t) => {
            let state = 'locked';
            if (player.techs.has(t.id)) state = 'done';
            else if (running.has(t.id)) state = 'running';
            else if (queued.has(t.id)) state = 'queued';
            else if (world.techPlannable(me, t)) state = 'open';
            else if (t.epoch <= player.epoch) state = 'needs';
            const pct = running.has(t.id) ? `<i style="width:${Math.round(running.get(t.id)! * 100)}%"></i>` : '';
            const tip = `${t.name} – ${t.branch.text}. ${t.time} s.` + (t.requires.length ? ` Benötigt: ${t.requires.map((r) => TECH_BY_ID.get(r)!.name).join(', ')}.` : '');
            return `<button class="tt-cell ${state}${t.epoch === player.epoch ? ' now' : ''}" data-tech="${t.id}" title="${esc(tip)}"><img src="${techIcon(t, 32)}" alt=""><span class="tt-name">${esc(t.name)}</span><span class="tt-ep">${epochNumeral(t.epoch)}</span>${pct}</button>`;
          })
          .join('<span class="tt-arrow">›</span>');
        return `<div class="tt-row"><div class="tt-branch"><b>${esc(branch.name)}</b><span class="dim">${esc(branch.text)}</span></div><div class="tt-chain">${cells}</div></div>`;
      })
      .join('');
    const status =
      player.epoch < world.settings.maxEpoch
        ? `Für den nächsten Aufstieg: <b class="${gap.have >= gap.need ? 'ok' : 'warn'}">${Math.min(gap.have, gap.need)}/${gap.need}</b> Techniken der Epoche ${epochTag(player.epoch)}`
        : 'Letzte Epoche dieser Partie erreicht.';
    this.openOverlay(
      'pause',
      `<h2>Technologiebaum <span class="dim">${done}/${TECHS.length} erforscht</span></h2>
       <p class="tt-status">${status}. Klick auf eine goldene Technik: im Gebäude mit der kürzesten Warteschlange erforschen oder einreihen.</p>
       <div class="tt-legend"><span class="tt-cell done">erforscht</span><span class="tt-cell running">läuft</span><span class="tt-cell queued">eingereiht</span><span class="tt-cell open">verfügbar</span><span class="tt-cell needs">Voraussetzung fehlt</span><span class="tt-cell locked">spätere Epoche</span></div>
       <div class="tt-tabs">${tabs}</div>
       <div class="tt-body">${rows}</div>
       <div class="dialog-buttons"><button data-act="resume" class="primary">Weiterspielen</button></div>`,
    );
    this.els.overlay.querySelector('.dialog')?.classList.add('wide');
    this.bindOverlay({ resume: () => this.game.menuPause(false) });
    this.els.overlay.querySelectorAll<HTMLElement>('[data-tab]').forEach((el) => {
      el.onclick = () => this.showTechTree(el.dataset.tab as BuildingType);
    });
    this.els.overlay.querySelectorAll<HTMLElement>('[data-tech]').forEach((el) => {
      el.onclick = () => {
        const t = TECH_BY_ID.get(el.dataset.tech!)!;
        if (!world.techPlannable(me, t)) return;
        const built = world.buildingsOf(me, t.building).filter((b) => b.built);
        const sites = built.filter((b) => b.techQueue.length < MAX_TECH_QUEUE);
        if (!sites.length) {
          this.message('warn', built.length ? `Die Warteschlangen aller Gebäude vom Typ ${buildingName(t.building, player.epoch)} sind voll.` : `Erst ${buildingName(t.building, player.epoch)} bauen.`);
          return;
        }
        if (!canAfford(player.stock, t.cost)) {
          this.message('warn', `Nicht genug Rohstoffe für ${t.name}.`);
          return;
        }
        this.game.research(sites, t.id);
        this.showTechTree(tab);
      };
    });
  }

  showGameOver(): void {
    const { world, me } = this.game;
    const won = world.winnerTeam === world.players[me].team;
    const rows = world.players
      .map((p) => {
        const gathered = RESOURCES.reduce((s, r) => s + p.stats.gathered[r], 0);
        return `<tr><td style="color:${p.color}">${esc(p.name)}</td><td>${epochTag(p.epoch)}</td><td>${Math.round(gathered)}</td><td>${p.stats.unitsTrained}</td><td>${p.stats.kills}</td><td>${p.stats.unitsLost}</td><td>${p.stats.buildingsLost}</td></tr>`;
      })
      .join('');
    this.openOverlay(
      'gameover',
      `<h2 class="${won ? 'win' : 'lose'}">${won ? 'Sieg!' : 'Niederlage'}</h2>
       <p>Spielzeit ${fmtTime(world.time)}</p>
       <table class="stats-table"><tr><th>Spieler</th><th>Epoche</th><th>Gesammelt</th><th>Ausgebildet</th><th>Getötet</th><th>Verluste</th><th>Gebäude verloren</th></tr>${rows}</table>
       <div class="dialog-buttons"><button data-act="watch">Weiter ansehen</button>${this.game.recorder ? '<button data-act="save">Wiedergabe speichern</button>' : ''}<button data-act="quit" class="primary">Hauptmenü</button></div>`,
    );
    this.bindOverlay({
      watch: () => this.closeOverlay(),
      save: () => this.game.recorder && downloadReplay(this.game.recorder.replay),
      quit: () => this.game.exitToMenu(),
    });
  }

  private bindOverlay(actions: Record<string, () => void>): void {
    this.els.overlay.querySelectorAll<HTMLElement>('[data-act]').forEach((el) => {
      el.onclick = () => actions[el.dataset.act!]?.();
    });
  }
}

