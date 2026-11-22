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
    }

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
                if (this.visible()) {
                    const now = Date.now();
                    if (now >= this.next.iat) await this._read('iat', DME, IAT, IAT_MS);
                    if (Date.now() >= this.next.gb) await this._read('gb', EGS, GEARBOX, GB_MS);
                }
            } catch (e) {
                // the head unit's transport comes up a few seconds after the app: try again soon
                this._once('err', 'read: ' + (e && e.message || e) + ' (trying again)');
            }
            await new Promise((r) => setTimeout(r, 250));
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

    _once(k, msg) { if (!this.logged[k]) { this.logged[k] = true; this.log.info(msg); } }
}

module.exports = { Sensors };
