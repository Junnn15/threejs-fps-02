// The DOM HUD: health, armour, money, ammo, timer, score, kill feed, zone name, a
// canvas minimap, the buy menu and the round banners. It never touches the
// simulation; main.js pushes numbers in and reads callbacks out. Every setter
// skips a DOM write when nothing changed, so the HUD costs nothing at rest.
import { WEAPONS, ARMOR_PRICE, GRENADE_PRICE } from './weapons.js';

const COPY = {
  start: {
    title: 'SANDLINE',
    copy: 'Vanguard attacks, Raiders defend. Plant the bomb at Site A or Site B — or drop every Raider. First squad to 5 rounds takes the yard.',
    action: 'Click to play',
  },
  paused: {
    title: 'SANDLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  round: {
    title: 'Round over',
    copy: '',
    action: 'Next round',
  },
  match: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const ammoBox = $('ammo');
  const weaponName = $('weapon-name');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const armorFill = $('armor-fill');
  const armorNum = $('armor-num');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const scoreV = $('score-v');
  const scoreR = $('score-r');
  const roundLabel = $('round-label');
  const zoneValue = $('zone');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const buyPanel = $('buy');
  const buyItems = $('buy-items');
  const buyMoney = $('buy-money');
  const plantWrap = $('plant-wrap');
  const plantFill = $('plant-fill');
  const plantLabel = $('plant-label');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const vignette = $('damage-vignette');
  const minimap = $('minimap');
  const mm = minimap ? minimap.getContext('2d') : null;

  let lastMag = -1;
  let lastReserve = -1;
  let lastHealth = -1;
  let lastArmor = -1;
  let lastMoney = -1;
  let lastTimer = '';
  let lastScore = '';
  let lastZone = '';
  let lastWeapon = '';
  let hitTimer = 0;
  let bannerTimer = 0;
  let vignetteTimer = 0;

  function setText(el, value, last) {
    if (value === last) return last;
    el.textContent = value;
    return value;
  }

  return {
    setAmmo(mag, reserve) {
      if (mag === lastMag && reserve === lastReserve) return;
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      ammoBox.classList.toggle('empty', mag === 0);
    },
    setWeapon(name) {
      if (name === lastWeapon) return;
      lastWeapon = name;
      weaponName.textContent = name;
    },
    setHealth(hp, armor) {
      if (hp !== lastHealth) {
        lastHealth = hp;
        healthNum.textContent = String(Math.max(0, Math.ceil(hp)));
        healthFill.style.width = `${Math.max(0, Math.min(100, hp))}%`;
        healthFill.classList.toggle('low', hp <= 30);
      }
      if (armor !== lastArmor) {
        lastArmor = armor;
        armorNum.textContent = String(Math.max(0, Math.ceil(armor)));
        armorFill.style.width = `${Math.max(0, Math.min(100, armor))}%`;
      }
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyValue.textContent = `$${value}`;
    },
    setTimer(seconds, phase) {
      const text = phase === 'freeze' ? `BUY ${Math.ceil(seconds)}` : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
      if (text === lastTimer) return;
      lastTimer = text;
      timerValue.textContent = text;
      timerValue.classList.toggle('urgent', phase !== 'freeze' && seconds <= 10);
    },
    setScore(v, r, round) {
      const text = `${v}-${r} · R${round}`;
      if (text === lastScore) return;
      lastScore = text;
      scoreV.textContent = String(v);
      scoreR.textContent = String(r);
      roundLabel.textContent = `ROUND ${round}`;
    },
    setZone(name) {
      if (name === lastZone) return;
      lastZone = name;
      zoneValue.textContent = name;
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      vignette.classList.add('on');
      clearTimeout(vignetteTimer);
      vignetteTimer = setTimeout(() => vignette.classList.remove('on'), 220);
    },
    setCrosshairSpread(px) {
      crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    killfeed(killer, victim, headshot, killerTeam) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      const k = document.createElement('span');
      k.className = killerTeam === 'vanguard' ? 'feed-v' : 'feed-r';
      k.textContent = killer;
      const mid = document.createElement('span');
      mid.className = 'feed-mid';
      mid.textContent = headshot ? ' ⌖ ' : ' ✕ ';
      const v = document.createElement('span');
      v.textContent = victim;
      row.append(k, mid, v);
      killfeed.prepend(row);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => row.classList.add('fade'), 4200);
      setTimeout(() => row.remove(), 5000);
    },
    banner(titleText, subText, win, holdMs = 3200) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.classList.toggle('win', win);
      banner.classList.toggle('lose', !win);
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { banner.hidden = true; }, holdMs);
    },
    hideBanner() {
      banner.hidden = true;
    },
    showBuy(money, owned) {
      buyMoney.textContent = `$${money}`;
      for (const row of buyItems.children) {
        const id = row.dataset.id;
        const kind = row.dataset.kind;
        let price = 0;
        let have = false;
        if (kind === 'weapon') {
          price = WEAPONS[id].price;
          have = !!owned[id];
        } else if (kind === 'armor') {
          price = ARMOR_PRICE;
        } else {
          price = GRENADE_PRICE;
        }
        row.classList.toggle('owned', have);
        row.classList.toggle('cant', !have && money < price);
        row.querySelector('.buy-price').textContent = have ? 'OWNED' : `$${price}`;
      }
      buyPanel.hidden = false;
    },
    hideBuy() {
      buyPanel.hidden = true;
    },
    buildBuy(onBuy) {
      const rows = [
        { kind: 'weapon', id: 'p9', label: 'P9 Sidearm', desc: 'Reliable pistol · 12 rounds' },
        { kind: 'weapon', id: 'hornet', label: 'Hornet SMG', desc: 'Fast close-range spray · 25 rounds' },
        { kind: 'weapon', id: 'vk47', label: 'VK-47 Rifle', desc: 'The all-rounder · 30 rounds' },
        { kind: 'weapon', id: 'longbow', label: 'Longbow DMR', desc: 'One-shot headshots · 5 rounds' },
        { kind: 'armor', id: 'armor', label: 'Kevlar Vest', desc: 'Absorbs half of incoming damage' },
        { kind: 'grenade', id: 'grenade', label: 'Frag Grenade', desc: 'Throw with G · big blast radius' },
      ];
      for (const row of rows) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'buy-row';
        el.dataset.kind = row.kind;
        el.dataset.id = row.id;
        el.innerHTML = `<span class="buy-name"></span><span class="buy-desc"></span><span class="buy-price"></span>`;
        el.querySelector('.buy-name').textContent = row.label;
        el.querySelector('.buy-desc').textContent = row.desc;
        el.addEventListener('click', () => onBuy(row.kind, row.id));
        buyItems.appendChild(el);
      }
    },
    setPlant(label, frac) {
      if (frac === null) {
        plantWrap.hidden = true;
        return;
      }
      plantWrap.hidden = false;
      plantLabel.textContent = label;
      plantFill.style.width = `${Math.round(frac * 100)}%`;
    },
    drawMinimap(wallRects, playerPos, yaw, bots, bomb) {
      if (!mm) return;
      const W = minimap.width;
      const H = minimap.height;
      const sx = (x) => ((x + 23) / 46) * W;
      const sz = (z) => ((z + 17) / 34) * H;
      mm.clearRect(0, 0, W, H);
      mm.fillStyle = '#14161a';
      mm.fillRect(0, 0, W, H);
      mm.fillStyle = '#2c323a';
      for (const r of wallRects) mm.fillRect(sx(r.x0), sz(r.z0), sx(r.x1) - sx(r.x0), sz(r.z1) - sz(r.z0));
      mm.fillStyle = 'rgba(240,168,48,0.85)';
      mm.fillRect(sx(-21), sz(-15), sx(-11) - sx(-21), sz(-7) - sz(-15));
      mm.fillStyle = 'rgba(125,208,105,0.85)';
      mm.fillRect(sx(11), sz(-15), sx(21) - sx(11), sz(-7) - sz(-15));
      if (bomb && bomb.planted) {
        mm.fillStyle = (Math.floor(performance.now() / 300) % 2 === 0) ? '#ff5a4e' : '#f0a830';
        mm.beginPath();
        mm.arc(sx(bomb.x), sz(bomb.z), 4, 0, Math.PI * 2);
        mm.fill();
      }
      for (const bot of bots) {
        if (!bot.alive) continue;
        mm.fillStyle = bot.team === 'vanguard' ? '#4aa3ff' : '#ff5a4e';
        mm.beginPath();
        mm.arc(sx(bot.mover.body.position.x), sz(bot.mover.body.position.z), 3, 0, Math.PI * 2);
        mm.fill();
      }
      // The player is a triangle pointing where they look.
      mm.save();
      mm.translate(sx(playerPos.x), sz(playerPos.z));
      mm.rotate(-yaw);
      mm.fillStyle = '#e9e6df';
      mm.beginPath();
      mm.moveTo(0, -6);
      mm.lineTo(4.5, 5);
      mm.lineTo(-4.5, 5);
      mm.closePath();
      mm.fill();
      mm.restore();
    },
    showOverlay(mode, score) {
      const text = COPY[mode];
      title.textContent = text.title;
      if (mode === 'round') copy.textContent = score;
      else if (mode === 'match') copy.textContent = score;
      else copy.textContent = text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
