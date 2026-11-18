'use strict';
/**
 * sensors.js - DENSITY ALTITUD: what the air is like, read ONLY (kit/readonly-diag refuses anything that is
 * not a read):
 *
 *   outside temp  the car's EnvironmentalInformation signal (raw x 0.5 - 40 deg C, 255 = none)
 *   pressure      engine unit (DME, 0x12): 22 F433, else OBD 01 33   (kPa)
 *   IAT           engine unit (DME, 0x12): 22 F40F, else 22 F477, else OBD 01 0F   (deg C + 40)
 *
 * The engine unit is asked only while the screen shows (visible()).
 *
 *   const s = new Sensors(ctx, log, () => visible).start();
 *   s.ambient()  s.baro()  s.iat()      deg C / kPa, or null
 */
const { ReadOnlyDiag } = require('./kit/readonly-diag');
const { DidReader } = require('./kit/dids');

const DME = 0x12;
const BARO = [
    { did: 'F433', bytes: 1, at: 0, factor: 1, offset: 0, min: 50, max: 115 },
    { obd: '33', bytes: 1, at: 0, factor: 1, offset: 0, min: 50, max: 115 },
];
const IAT = [
    { did: 'F40F', bytes: 1, at: 0, factor: 1, offset: -40, min: -40, max: 150 },
    { did: 'F477', bytes: 1, at: 1, factor: 1, offset: -40, min: -40, max: 150 },
    { obd: '0F', bytes: 1, at: 0, factor: 1, offset: -40, min: -40, max: 150 },
];
const EVERY = { iat: 1500, baro: 10000 };
const SLOW_MS = 30000, FRESH = { iat: 20000, baro: 120000, amb: 300000 };

class Sensors {
    constructor(ctx, log, visible) {
        this.ctx = ctx; this.log = log; this.visible = visible || (() => true);
        this.v = { iat: null, baro: null, amb: null };
        this.at = { iat: 0, baro: 0, amb: 0 };
        this.next = { iat: 0, baro: 0 };
        this.miss = { iat: 0, baro: 0 };
        this.logged = {};
    }

    start() {
        const signals = this.ctx.signals;
        if (signals && signals.watch) {
            Promise.resolve(signals.watch('de.bmw.infrastructure.EnvironmentalInformation', '1', {
                ExteriorTemperature: (v) => {
                    const raw = v && v.temperatureExterior;
                    if (typeof raw !== 'number' || raw === 255) return;
                    this.v.amb = raw * 0.5 - 40; this.at.amb = Date.now();
                    this._once('ambok', 'outside -> ' + this.v.amb + ' deg C');
                },
            }, this.log)).catch((e) => this.log.warn('outside temp signal: ' + (e && e.message || e)));
        }
        this.link = new ReadOnlyDiag(signals, this.log);
        this.rd = new DidReader(this.link, { ecu: DME });
        this.link.init().then(() => {
            if (this.link.ready === false) { this.log.info('no diagnostic link'); return; }
            this._loop();
        }).catch((e) => this.log.warn('diagnostic link: ' + (e && e.message || e)));
        return this;
    }

    _get(k) { return Date.now() - this.at[k] < FRESH[k] ? this.v[k] : null; }
    iat() { return this._get('iat'); }
    baro() { return this._get('baro'); }
    ambient() { return this._get('amb'); }

    async _loop() {
        for (;;) {
            try {
                if (this.visible()) {
                    if (Date.now() >= this.next.iat) await this._read('iat', IAT);
                    if (Date.now() >= this.next.baro) await this._read('baro', BARO);
                }
            } catch (e) {
                // the head unit's transport comes up a few seconds after the app: try again soon
                this._once('err', 'read: ' + (e && e.message || e) + ' (trying again)');
            }
            await new Promise((r) => setTimeout(r, 250));
        }
    }

    async _read(key, list) {
        if (this.link.wake) this.link.wake(DME);
        const v = await this.rd.value(key, list);
        const now = Date.now();
        if (v !== null) {
            this.v[key] = v; this.at[key] = now; this.miss[key] = 0;
            this._once(key + 'ok', key + ' -> ' + v);
            this.next[key] = now + EVERY[key];
        } else {
            this.miss[key]++;
            this._once(key + 'none', key + ': no answer (' + JSON.stringify(this.rd.raws) + ')');
            this.next[key] = now + (this.miss[key] >= 3 ? SLOW_MS : EVERY[key]);
        }
    }

    _once(k, msg) { if (!this.logged[k]) { this.logged[k] = true; this.log.info(msg); } }
}

module.exports = { Sensors };
