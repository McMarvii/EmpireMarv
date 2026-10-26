import { BUILDABLE, BUILDING_DEFS, buildingName, FARM_CAPACITY, type BuildingType } from '../data/buildings';
import { epochLabel, epochNumeral, EPOCHS } from '../data/epochs';
import { canAfford, RES_COLOR, RES_LABEL, RESOURCES, type Cost } from '../data/resources';
import { bestTier, GATHER_LABEL, ROLE_DEFS, unitStats, type Role } from '../data/units';
import type { Game } from '../game';
import { buildingIcon, epochIcon, unitIcon } from '../render/icons';
import type { Building, Entity, Unit } from '../sim/entities';
import type { GameEvent } from '../sim/world';

export interface CommandButton {
  key: string;
  icon?: string;
  text?: string;
  enabled: boolean;
  locked?: boolean;
  badge?: string;
  title: string;
  tooltip: string;
  action: (shift: boolean) => void;
}

const SLOT_KEYS = ['Q', 'W', 'E', 'R'];

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
    this.els.commands.onmouseleave = () => this.hideTooltip();
  }

  destroy(): void {
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
    if (!paused && this.els.overlay.dataset.kind === 'pause') this.closeOverlay();
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
    let epochHtml = `<img class="ep-icon" src="${epochIcon(player.epoch, 32)}" alt=""><span class="ep-num">${epochNumeral(player.epoch)}</span> ${esc(epoch.name)}`;
    if (research) {
      const target = research.research!.targetEpoch;
      const pct = Math.floor((research.research!.progress / research.research!.total) * 100);
      epochHtml += ` <span class="ep-arrow">→</span> <img class="ep-icon" src="${epochIcon(target, 32)}" alt=""> ${esc(EPOCHS[target].name)} ${pct} %`;
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
    }
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
    this.message(ev.type, ev.text, undefined, ev.epoch !== undefined ? epochIcon(ev.epoch, 32) : undefined);
  }

  // ------------------------------------------------------------- panels

  private updatePanels(): void {
    const ents = this.game.selectedEntities();
    const commands = this.buildCommands(ents);
    const sigParts = [
      ents.map((e) => `${e.id}:${Math.ceil(e.hp)}`).join(','),
      this.game.world.players[this.game.me].epoch,
      commands.map((c) => `${c.key}${c.enabled ? 1 : 0}${c.locked ? 1 : 0}${c.badge ?? ''}${c.text ?? ''}`).join(''),
      this.dynamicSig(ents),
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
          return `${e.built}${Math.floor(e.progress * 100)}${q}${e.research ? Math.floor(e.research.progress) : ''}${e.popBlocked}`;
        }
        if (e.kind === 'unit') return `${e.order.kind}${Math.floor(e.carryAmount)}${e.morale}`;
        return `${Math.floor(e.amount)}`;
      })
      .join('');
  }

  private selectionHtml(ents: Entity[]): string {
    const { world, me } = this.game;
    if (ents.length === 0) {
      return `<div class="sel-empty">Linksklick: auswählen · Rechtsklick: Befehl<br>Ziehen: Rahmenauswahl · F1: Hilfe</div>`;
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
      return `<div class="sel-multi">${[...groups.entries()]
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
      else if (e.order.kind === 'attack') activity = 'kämpft';
      else if (e.order.kind === 'move') activity = 'unterwegs';
      else activity = 'untätig';
      const carry = e.carry && e.carryAmount > 0 ? ` · trägt ${Math.floor(e.carryAmount)} ${RES_LABEL[e.carry]}` : '';
      const morale = e.morale > 0 ? ` · Moral +${e.morale}` : '';
      return `<div class="sel-single">
        <img class="portrait" src="${unitIcon(e.role, s.epoch, owner!.color, 64)}">
        <div class="sel-info">
          <div class="sel-name">${esc(s.name)} ${ownerLine}</div>
          <div class="sel-sub">${esc(def.label)} · ${epochTag(s.epoch)} · ${activity}${carry}${morale}</div>
          ${hpBar(e.hp, e.maxHp)}
          <div class="stats"><span>Angriff ${s.dmg}</span><span>Rüstung ${s.armor}</span><span>Reichweite ${s.range.toFixed(1)}</span><span>Tempo ${s.speed.toFixed(1)}</span></div>
          ${e.role !== 'citizen' ? `<div class="counter"><b>Stark gegen:</b> ${esc(def.strongVs)} · <b>Schwach gegen:</b> ${esc(def.weakVs)}</div>` : ''}
        </div></div>`;
    }

    if (e.kind === 'building') {
      const def = BUILDING_DEFS[e.type];
      const lines: string[] = [];
      if (!e.built) lines.push(`Im Bau: ${Math.floor(e.progress * 100)} %`);
      if (e.research) {
        lines.push(
          `<div class="progress research"><div style="width:${(e.research.progress / e.research.total) * 100}%"></div><span>Aufstieg: ${esc(EPOCHS[e.research.targetEpoch].name)}</span></div>`,
        );
      }
      if (e.type === 'farm' && e.built) lines.push(`Bauern: ${world.farmWorkers(e)} / ${FARM_CAPACITY}`);
      if (e.type === 'house') lines.push('Moral für Einheiten in der Nähe.');
      if (e.popBlocked) lines.push('<span class="warn">Bevölkerungslimit erreicht</span>');
      let queue = '';
      if (e.queue.length && e.owner === me) {
        queue = `<div class="queue">${e.queue
          .map((item, i) => {
            const tier = Math.max(0, bestTier(item.role, world.players[me].epoch));
            const pct = i === 0 ? (item.progress / ROLE_DEFS[item.role].trainTime) * 100 : 0;
            return `<button class="q-item" data-cancel="${i}" title="Abbrechen"><img src="${unitIcon(item.role, ROLE_DEFS[item.role].tiers[tier].epoch, owner!.color, 32)}"><div class="q-bar" style="width:${pct}%"></div></button>`;
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
    const b = ents[0];
    if (b && b.kind === 'building') {
      this.els.selection.querySelectorAll<HTMLElement>('[data-cancel]').forEach((el) => {
        el.onclick = () => this.game.cancelQueue(b.id, Number(el.dataset.cancel));
      });
    }
  }

  // ----------------------------------------------------------- commands

  private buildCommands(ents: Entity[]): CommandButton[] {
    const game = this.game;
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
    }
    if (units.length) {
      cmds.push({
        key: 'X',
        text: 'Halt',
        enabled: true,
        title: 'Halt',
        tooltip: '<b>Halt</b> <kbd>X</kbd><p>Alle Befehle abbrechen.</p>',
        action: () => game.stop(),
      });
    }

    const b = own.length === 1 && own[0].kind === 'building' ? (own[0] as Building) : null;
    if (b && b.built) {
      const def = BUILDING_DEFS[b.type];
      def.trains.forEach((role, i) => cmds.push(this.trainButton(b, role, SLOT_KEYS[i])));
      if (b.type === 'towncenter') {
        if (b.research) {
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
          const reqs = (Object.entries(next.requires) as Array<[BuildingType, number]>)
            .map(([type, need]) => {
              const gap = missing.find((m) => m.type === type);
              const have = gap ? gap.have : need;
              return `<li class="${gap ? 'missing' : 'ok'}">${gap ? '✘' : '✔'} ${esc(buildingName(type, player.epoch))} <span class="dim">${have}/${need}</span></li>`;
            })
            .join('');
          cmds.push({
            key: 'E',
            icon: epochIcon(next.index, 44),
            enabled: !busy && missing.length === 0 && canAfford(player.stock, next.advanceCost),
            badge: missing.length ? '!' : undefined,
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

  private trainButton(b: Building, role: Role, key: string): CommandButton {
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
    const s = unitStats(role, tier);
    const queued = b.queue.filter((q) => q.role === role).length;
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
        (role !== 'citizen' ? `<p><b>Stark gegen:</b> ${esc(def.strongVs)}<br><b>Schwach gegen:</b> ${esc(def.weakVs)}</p>` : '<p>Sammelt Rohstoffe und errichtet Gebäude.</p>') +
        (nextTier ? `<p class="dim">Nächste Stufe: ${esc(nextTier.name)} (${epochTag(nextTier.epoch)})</p>` : '') +
        `<p class="dim">Umschalt+Klick: 5 Stück</p>`,
      action: (shift) => this.game.train(b.id, role, shift ? 5 : 1),
    };
  }

  private renderCommands(): void {
    const el = this.els.commands;
    el.innerHTML = this.commands
      .map(
        (c, i) =>
          `<button class="cmd${c.enabled ? '' : ' disabled'}${c.locked ? ' locked' : ''}" data-i="${i}" aria-label="${esc(c.title)}">` +
          (c.icon ? `<img src="${c.icon}" alt="">` : `<span class="cmd-text">${esc(c.text ?? '')}</span>`) +
          `<span class="hk">${c.key}</span>${c.badge ? `<span class="badge">${c.badge}</span>` : ''}</button>`,
      )
      .join('');
    el.querySelectorAll<HTMLButtonElement>('button.cmd').forEach((btn) => {
      const i = Number(btn.dataset.i);
      btn.onclick = (ev) => this.commands[i]?.action(ev.shiftKey);
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
    this.game.togglePause(true);
    this.openOverlay(
      'pause',
      `<h2>Pause</h2>
       <div class="dialog-buttons">
         <button data-act="resume" class="primary">Weiterspielen</button>
         <button data-act="help">Steuerung</button>
         <button data-act="quit">Aufgeben &amp; Hauptmenü</button>
       </div>`,
    );
    this.bindOverlay({
      resume: () => this.game.togglePause(false),
      help: () => this.showHelp(),
      quit: () => this.game.exitToMenu(),
    });
  }

  showHelp(): void {
    this.game.togglePause(true);
    this.openOverlay(
      'pause',
      `<h2>Steuerung</h2>
      <table class="help">
        <tr><td>Linksklick / Ziehen</td><td>Auswählen / Rahmenauswahl</td></tr>
        <tr><td>Doppelklick</td><td>Alle sichtbaren Einheiten dieses Typs</td></tr>
        <tr><td>Rechtsklick</td><td>Bewegen, Angreifen, Sammeln, Bauen, Einlagern – je nach Ziel</td></tr>
        <tr><td>Rechts ziehen / Mitte ziehen</td><td>Karte verschieben</td></tr>
        <tr><td>Rechtsklick mit Gebäude</td><td>Sammelpunkt setzen</td></tr>
        <tr><td>A, dann Klick</td><td>Angriffsbewegung</td></tr>
        <tr><td>Buchstaben</td><td>Befehle im Befehlsfeld (siehe Tasten auf den Knöpfen)</td></tr>
        <tr><td>Umschalt + Bauen/Ausbilden</td><td>Mehrfach platzieren / 5 Einheiten</td></tr>
        <tr><td>Strg + 1–9, dann 1–9</td><td>Gruppe speichern / wählen (2× = hinspringen)</td></tr>
        <tr><td>Punkt (.)</td><td>Nächster untätiger Bürger</td></tr>
        <tr><td>Entf</td><td>Auswahl abreißen / entlassen</td></tr>
        <tr><td>Pos1</td><td>Dorfzentrum</td></tr>
        <tr><td>Leertaste</td><td>Zum letzten Angriff springen</td></tr>
        <tr><td>Pfeiltasten / Bildschirmrand / Mausrad</td><td>Kamera bewegen / zoomen</td></tr>
        <tr><td>+ / −</td><td>Spielgeschwindigkeit</td></tr>
        <tr><td>P / Esc</td><td>Pause / Menü</td></tr>
      </table>
      <h3>Kampfdreieck</h3>
      <p>Sturminfanterie › Abwehrinfanterie › Kavallerie &amp; Fahrzeuge › Fernkampf › Sturminfanterie. Belagerung zerstört Gebäude.</p>
      <div class="dialog-buttons"><button data-act="resume" class="primary">Weiterspielen</button></div>`,
    );
    this.bindOverlay({ resume: () => this.game.togglePause(false) });
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
       <div class="dialog-buttons"><button data-act="watch">Weiter ansehen</button><button data-act="quit" class="primary">Hauptmenü</button></div>`,
    );
    this.bindOverlay({ watch: () => this.closeOverlay(), quit: () => this.game.exitToMenu() });
  }

  private bindOverlay(actions: Record<string, () => void>): void {
    this.els.overlay.querySelectorAll<HTMLElement>('[data-act]').forEach((el) => {
      el.onclick = () => actions[el.dataset.act!]?.();
    });
  }
}

