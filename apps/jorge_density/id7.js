'use strict';
/**
 * id7.js - DENSITY ALTITUD on iDrive 7 (1920 x 720): the same three pages as on iDrive 8 (main.js), laid out
 * for this screen.
 *
 * The kit draws the page 1.16 x here against 1.42 x on iDrive 8, so the texts and the - / + buttons are about a
 * fifth bigger to read and press the same. The page is also taller here (G.pageBottom: the room the empty bar
 * leaves), and the cards use it; without the GPU renderer or in the standard layout it is the usual height,
 * which every page below still fits.
 *
 * The air maths, the settings and the shared drawing stay in main.js and come in through create():
 *
 *   const v7 = require('./id7').create({ settings, air, thousands, F, card, bigNum, nudge, CAL, SCALE_M, colors });
 *   v7.air(cv, t, d, r)   v7.times(cv, t, d, r)   v7.cal(cv, t)
 */
const { withAlpha } = require('./kit/canvas');
const G = require('./kit/gauges');

const W = 1600, X0 = 16, GAP = 14;
const HEAD = 28, SUB = 21;              // a card's title and the line under it
const BODY = 84;                        // a card's content starts this far under its top
const DIGIT = 0.7;                      // height of the 'num' font's digits / its size
// the - / + buttons are the kit's (G.button): only where it runs the screen
const NO_BUTTONS = 'los botones - y + salen en Pantalla completa con GPU';

function create(env) {
    const { settings, air, thousands, F, card, bigNum, nudge, CAL, SCALE_M } = env;
    const { GREEN, AMBER, BLUE, WHITE } = env.colors;

    const area = (cv) => {
        const top = G.TOP + 6, bottom = G.pageBottom(cv) - 4;
        return { top, bottom, bh: bottom - top };
    };
    function heading(cv, t, x, y, label, sub, col, subCol) {
        cv.text(label, x + 22, y + 42, HEAD, col || t.dim, { font: 'bold', spacing: 2.5 });
        if (sub) cv.text(sub, x + 22, y + 72, SUB, subCol || withAlpha(t.dim, 0.85), { spacing: 1 });
    }

    /* ---------- AIRE ---------- */
    function renderAir(cv, t, d, r) {
        const { top, bh } = area(cv);
        const rh = settings.get('humidity'), limit = settings.get('daLimit');
        const a = air(r.kpa, r.amb, rh);
        // the big card: DA
        const bw = 790;
        const daCol = a ? (a.da < limit ? GREEN : AMBER) : t.dim;
        card(cv, X0, top, bw, bh);
        heading(cv, t, X0, top, 'DENSITY ALTITUDE · DA', 'la altura a la que "siente" el motor que esta');
        const da = a ? G.smooth('da', a.da) : null;
        // the scale 0 .. 4,000 m, green up to the limit, amber after it
        const sx = X0 + 24, sw = bw - 48, sh = 22, sy = top + bh - 150;
        // the number, as big as the room between the heading and the scale lets it be
        const room = sy - 30 - (top + BODY);
        const size = Math.min(230, room * 0.8 / DIGIT);
        bigNum(cv, t, X0 + 22, top + BODY + (room + size * DIGIT) / 2, a ? thousands(Math.round(da / 10) * 10) : '--',
            size, bw - 60, daCol, 'm', 50);
        const lx = sx + sw * G.clamp(limit / SCALE_M, 0, 1);
        cv.roundRect(sx, sy, sw, sh, sh / 2, withAlpha(AMBER, 0.85));
        if (lx - sx >= sh) {
            cv.roundRect(sx, sy, lx - sx, sh, sh / 2, withAlpha(GREEN, 0.85));
            if (lx < sx + sw - 1) cv.fillRect(lx - sh / 2, sy, sh / 2, sh, withAlpha(GREEN, 0.85));
        }
        if (a) {
            const mx = sx + sw * G.clamp(da / SCALE_M, 0, 1);
            cv.roundRect(mx - 5, sy - 14, 10, sh + 28, 5, WHITE);
        }
        [0, 1000, 2000, 3000, 4000].forEach((m, i) => {
            const label = i === 0 ? '0 m  MAR' : i === 4 ? '4,000 m' : thousands(m);
            cv.text(label, sx + sw * m / SCALE_M, sy + sh + 32, 20, t.dim, { align: i === 0 ? 'left' : i === 4 ? 'right' : 'center' });
        });
        // the verdict
        let verdict = 'ESPERANDO DATOS DEL CARRO';
        if (a) verdict = (a.da < limit ? 'AIRE BUENO' : 'AIRE FLACO') + '  ·  EL MOTOR RESPIRA ' + Math.round(a.ratio * 100) + '%';
        let vs = 32;
        while (vs > 22 && cv.textWidth(verdict, vs, { font: 'bold', spacing: 2 }) > bw - 50) vs -= 1;
        cv.text(verdict, sx, top + bh - 36, vs, daCol, { font: 'bold', spacing: 2 });

        // the four small cards
        const cx = X0 + bw + GAP, cw = (W - X0 - cx - GAP) / 2, ch = (bh - GAP) / 2;
        const small = (i, label, sub, s, unit, col) => {
            const x = cx + (i % 2) * (cw + GAP), y = top + Math.floor(i / 2) * (ch + GAP);
            card(cv, x, y, cw, ch);
            heading(cv, t, x, y, label, sub);
            bigNum(cv, t, x + 22, y + ch - 30, s, 132, cw - 44, col || WHITE, unit, 40);
        };
        const ambF = F(r.amb), iatF = F(r.iat);
        small(0, 'AMBIENTE', 'temperatura afuera', G.isNum(ambF) ? String(Math.round(ambF)) : '--', '°F');
        small(1, 'PRESION', 'barometrica · inHg', G.isNum(r.kpa) ? (r.kpa * 0.2953).toFixed(2) : '--', '');
        const rise = G.isNum(iatF) && G.isNum(ambF) ? iatF - ambF : null;
        small(2, 'IAT', G.isNum(rise) ? (rise >= 0 ? '+' : '') + Math.round(rise) + '°F sobre ambiente' : 'admision',
            G.isNum(iatF) ? String(Math.round(iatF)) : '--', '°F', G.isNum(rise) && rise > 20 ? AMBER : WHITE);
        small(3, 'HUMEDAD', 'la pones tu en CALIBRAR', String(rh), '%');
        return a;
    }

    /* ---------- TIEMPOS ---------- */
    function renderTimes(cv, t, d, r) {
        const { top, bh } = area(cv);
        const at = (f) => top + BODY + (bh - BODY) * f;     // a height in the card's content, 0 .. 1
        const et = Number(settings.get('et')), trap = Number(settings.get('trap'));
        const a = air(r.kpa, r.amb, settings.get('humidity'));
        const k = (Number(settings.get('turbo')) || 0) / 100;
        // left: your run here
        const lw = 760, b = 76, wide = b + 36, x1 = X0 + 20;
        card(cv, X0, top, lw, bh);
        heading(cv, t, X0, top, 'TU PASADA AQUI', cv.own ? 'pon el tiempo de tu Dragy con - y +' : NO_BUTTONS, null, cv.own ? null : AMBER);
        const row = (y, key, s, unit, small, big, lo, hi, dec, size) => {
            G.button(cv, t, x1, y - b / 2, b, b, '-', () => nudge(key, -small, lo, hi, dec), { key: key + '-' });
            G.button(cv, t, x1 + b + 10, y - b / 2, wide, b, '-' + big, () => nudge(key, -big, lo, hi, dec), { key: key + '--' });
            const x0 = cv.own ? x1 + b + 10 + wide + 16 : x1 + 2;
            const nw = cv.text(s, x0, y + size * 0.36, size, WHITE, { font: 'num' });
            cv.text(unit, x0 + nw + 8, y + size * 0.36, 34, t.dim, { font: 'bold' });
            const bx = X0 + lw - 20 - b - 10 - wide;
            G.button(cv, t, bx, y - b / 2, wide, b, '+' + big, () => nudge(key, big, lo, hi, dec), { key: key + '++' });
            G.button(cv, t, bx + wide + 10, y - b / 2, b, b, '+', () => nudge(key, small, lo, hi, dec), { key: key + '+' });
        };
        row(at(0.25), 'et', et.toFixed(2), 's', 0.01, 0.1, 6, 25, 2, 124);
        cv.text('TRAP SPEED', x1 + 2, at(0.555), 26, t.dim, { font: 'bold', spacing: 2.5 });
        row(at(0.78), 'trap', String(Math.round(trap)), 'mph', 1, 5, 40, 250, 0, 104);

        // right: the same run at sea level
        const rx = X0 + lw + 66, rw = W - X0 - rx;
        cv.text('>', X0 + lw + 18, top + bh / 2 + 24, 68, BLUE, { font: 'bold' });
        card(cv, rx, top, rw, bh, withAlpha(GREEN, 0.9));
        heading(cv, t, rx, top, 'A NIVEL DEL MAR', 'lo que harias con aire perfecto (SAE)', GREEN);
        if (!a) {
            cv.text('ESPERANDO DATOS DEL CARRO', rx + 22, top + bh / 2 + 10, 32, t.dim, { font: 'bold', spacing: 2 });
            return;
        }
        const f = Math.pow(Math.max(0.5, a.cf), k / 3);
        const etC = et / f, trapC = trap * f;
        bigNum(cv, t, rx + 22, at(0.43), etC.toFixed(2), 172, rw - 60, GREEN, 's', 46);
        bigNum(cv, t, rx + 22, at(0.79), String(Math.round(trapC)), 126, rw - 60, GREEN, 'mph', 42);
        const lost = et - etC;
        const msg = 'EL AIRE TE ESTA ROBANDO ', lostS = lost.toFixed(2) + ' s';
        const mw = cv.text(msg, rx + 22, top + bh - 34, 27, t.dim, { font: 'bold', spacing: 2 });
        cv.text(lostS, rx + 22 + mw, top + bh - 34, 27, AMBER, { font: 'bold', spacing: 2 });
    }

    /* ---------- CALIBRAR ---------- */
    function renderCal(cv, t) {
        const { top, bh } = area(cv), gap = 12;
        const rh = (bh - 2 * gap) / 3;
        CAL.forEach((c, i) => {
            const y = top + i * (rh + gap), cy = y + rh / 2, b = 86;
            card(cv, X0, y, W - 2 * X0, rh);
            cv.text(c.label, 40, cy - 6, 38, WHITE, { font: 'bold', spacing: 2 });
            cv.text(c.sub, 40, cy + 34, SUB, t.dim, { spacing: 1 });
            const bx = 1040;
            G.button(cv, t, bx, cy - b / 2, b, b, '-', () => c.go(-1), { key: c.key + '-' });
            const v = settings.get(c.key);
            const vs = c.key === 'daLimit' ? thousands(v) : String(v);
            const vw = cv.textWidth(vs, 76, { font: 'num' }) + 10 + cv.textWidth(c.unit, 34, { font: 'bold' });
            const vx = bx + b + 165 - vw / 2;
            const nw = cv.text(vs, vx, cy + 28, 76, WHITE, { font: 'num' });
            cv.text(c.unit, vx + nw + 10, cy + 28, 34, t.dim, { font: 'bold' });
            G.button(cv, t, bx + b + 330, cy - b / 2, b, b, '+', () => c.go(1), { key: c.key + '+' });
        });
        if (!cv.own) cv.text(NO_BUTTONS, W - 40, top + 26, 19, AMBER, { align: 'right', spacing: 1 });
    }

    return { air: renderAir, times: renderTimes, cal: renderCal };
}

module.exports = { create };
