'use strict';
/**
 * sensors.js - ESSENTIALS: the two values the car does not send by itself, read ONLY (kit/readonly-diag
 * refuses anything that is not a read):
 *
 *   IAT          engine unit (DME, 0x12): 22 F40F, else 22 F477, else OBD 01 0F   (deg C + 40)
 *   gearbox oil  gearbox unit (EGS, 0x18): 22 6000 (ZF 8HP, deg C + 40), else 22 DA12 (deg C + 48);
 *                else the car's BasicDataSet signal (deg C + 48, 255 = none), once it has moved
 *
 * Both share one diagnostic link and take turns. Asked only while the screen shows (visible()).
 *
 *   const s = new Sensors(ctx, log, () => visible).start();
 *   s.iat()  s.gearbox()   deg C or null
 */
const { ReadOnlyDiag } = require('./kit/readonly-diag');
const { DidReader } = require('./kit/dids');

const DME = 0x12, EGS = 0x18;
const IAT = [
    { did: 'F40F', bytes: 1, at: 0, factor: 1, offset: -40, min: -40, max: 150 },
    { did: 'F477', bytes: 1, at: 1, factor: 1, offset: -40, min: -40, max: 150 },
    { obd: '0F', bytes: 1, at: 0, factor: 1, offset: -40, min: -40, max: 150 },
];
const GEARBOX = [
    { ecu: EGS, did: '6000', bytes: 1, at: 0, factor: 1, offset: -40, min: -40, max: 160 },
    { ecu: EGS, did: 'DA12', bytes: 1, at: 0, factor: 1, offset: -48, min: -40, max: 160 },
];
const IAT_MS = 1500, GB_MS = 5000, SLOW_MS = 30000, FRESH_MS = 20000;

class Sensors {
    constructor(ctx, log, visible) {
        this.ctx = ctx; this.log = log; this.visible = visible || (() => true);
        this.v = { iat: null, gb: null, sig: null };
        this.at = { iat: 0, gb: 0, sig: 0 };
        this.sigFirst = null; this.sigMoved = false;
        this.next = { iat: 0, gb: 0 };
        this.miss = { iat: 0, gb: 0 };
        this.logged = {};
        // the other values Jorge picked for his boxes (channels.js, src 'dme'): wanted() -> { iat, gb, extra: [channel] }
        this.wanted = () => ({ iat: true, gb: true, extra: [] });
        this.x = {}; this.xAt = {}; this.xNext = {}; this.xMiss = {}; this.turn = 0;
    }

    /** A picked engine-unit value (base unit), or null when stale / not answering. */
    extra(id) { return Date.now() - (this.xAt[id] || 0) < FRESH_MS ? this.x[id] : null; }

    start() {
        const signals = this.ctx.signals;
        if (signals && signals.watch) {
            Promise.resolve(signals.watch('de.bmw.infrastructure.analytics.BasicDataSet', '1', {
                basicDataSet: (v) => {
                    const raw = v && v.valueTemperatureTransmissionOil;
                    if (typeof raw !== 'number' || raw === 255) return;
                    const c = raw - 48;
                    if (this.sigFirst === null) this.sigFirst = c;
                    if (Math.abs(c - this.sigFirst) >= 1) this.sigMoved = true;   // some cars leave it at one number
                    this.v.sig = c; this.at.sig = Date.now();
                },
            }, this.log)).catch((e) => this.log.warn('gearbox signal: ' + (e && e.message || e)));
        }
        this.link = new ReadOnlyDiag(signals, this.log);
        this.rd = new DidReader(this.link, { ecu: DME });
        this.link.init().then(() => {
            if (this.link.ready === false) { this.log.info('no diagnostic link'); return; }
            this._loop();
        }).catch((e) => this.log.warn('diagnostic link: ' + (e && e.message || e)));
        return this;
    }

    iat() { return Date.now() - this.at.iat < FRESH_MS ? this.v.iat : null; }

    gearbox() {
        const now = Date.now();
        if (this.v.gb !== null && now - this.at.gb < FRESH_MS) return this.v.gb;
        if (this.sigMoved && this.v.sig !== null && now - this.at.sig < FRESH_MS) return this.v.sig;
        return null;
    }

    async _loop() {
        for (;;) {
            try {
                const w = this.visible() ? this.wanted() : null;
                if (w) {
                    const now = Date.now();
                    if (w.iat && now >= this.next.iat) await this._read('iat', DME, IAT, IAT_MS);
                    if (w.gb && Date.now() >= this.next.gb) await this._read('gb', EGS, GEARBOX, GB_MS);
                    // one picked value per turn, the most overdue first, so every box keeps moving
                    const due = w.extra.filter((c) => Date.now() >= (this.xNext[c.id] || 0));
                    if (due.length) await this._readExtra(due[this.turn++ % due.length]);
                }
            } catch (e) {
                // the head unit's transport comes up a few seconds after the app: try again soon
                this._once('err', 'read: ' + (e && e.message || e) + ' (trying again)');
            }
            // with picked values to keep up: next request right away (the link spaces requests itself)
            const busy = this.visible() && this.wanted().extra.length;
            await new Promise((r) => setTimeout(r, busy ? 20 : 250));
        }
    }

    async _read(key, ecu, list, every) {
        if (this.link.wake) this.link.wake(ecu);
        const v = await this.rd.value(key, list);
        const now = Date.now();
        if (v !== null) {
            this.v[key] = v; this.at[key] = now; this.miss[key] = 0;
            this._once(key + 'ok', key + ' -> ' + v + ' deg C');
            this.next[key] = now + every;
        } else {
            this.miss[key]++;
            this._once(key + 'none', key + ': no answer (' + JSON.stringify(this.rd.raws) + ')');
            this.next[key] = now + (this.miss[key] >= 3 ? SLOW_MS : every);
        }
    }

    async _readExtra(c) {
        const v = await this.rd.value(c.id, c.cands);
        const now = Date.now();
        if (v !== null) {
            this.x[c.id] = v; this.xAt[c.id] = now; this.xMiss[c.id] = 0;
            this._once(c.id + 'ok', c.id + ' -> ' + v);
            this.xNext[c.id] = now + (c.every || 0);
        } else {
            this.xMiss[c.id] = (this.xMiss[c.id] || 0) + 1;
            this._once(c.id + 'none', c.id + ': no answer (' + JSON.stringify(this.rd.raws) + ')');
            this.xNext[c.id] = now + (this.xMiss[c.id] >= 3 ? SLOW_MS : 1000);
        }
    }

    _once(k, msg) { if (!this.logged[k]) { this.logged[k] = true; this.log.info(msg); } }
}

module.exports = { Sensors };
