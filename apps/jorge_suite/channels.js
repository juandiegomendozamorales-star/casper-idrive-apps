'use strict';
/**
 * channels.js - every value the ESSENTIALS boxes can show, named exactly as Jorge knows them from his
 * logger (English names on purpose: Jorge 2026-11-28 "si les cambias el nombre... nos jodes").
 *
 * Only values the car hands out openly are here: the car's own signals, the engine unit's (DME 0x12)
 * standard identifiers (22 F4xx = OBD PIDs over UDS, or OBD service 01), a few BMW identifiers known
 * from idrive7-apps' car_vitals, and the flex fuel / fuel level reads of perea_mhd_flex. All reads.
 *
 *   { id, name, unit, dec, scale: [lo, hi] (the bar), temp: true (blue/green/amber/red with MIN/MAX),
 *     src: 'car' | 'ess' | 'da' | 'ff' | 'dme', key (for car/ess/da/ff), cands (for dme: kit/dids.js
 *     candidates, value in the base unit), conv (base -> shown unit), every (ms between reads) }
 */
const F = (c) => c * 9 / 5 + 32;
const PSI_PER_KPA = 0.145038, PSI_PER_BAR = 14.5038;

const CHANNELS = [
    // the four with ranges (Jorge's ESSENTIALS)
    { id: 'oil', name: 'Oil temp', unit: '°F', dec: 0, temp: true, src: 'car', key: 'oil', conv: F },
    { id: 'coolant', name: 'Coolant', unit: '°F', dec: 0, temp: true, src: 'car', key: 'coolant', conv: F },
    { id: 'gb', name: 'Transmission temp', unit: '°F', dec: 0, temp: true, src: 'ess', key: 'gearbox', conv: F },
    { id: 'iat', name: 'IAT', unit: '°F', dec: 0, temp: true, src: 'ess', key: 'iat', conv: F },
    // turbo
    { id: 'boost', name: 'Boost', unit: 'psi', dec: 1, scale: [0, 30], src: 'dme', gauge: true, every: 0, cands: [
        { did: 'F470', bytes: 2, at: 3, factor: 0.03125, offset: 0, min: 20, max: 600 },          // kPa absolute
        { did: '580B', bytes: 2, at: 0, factor: 0.00390625, offset: 0, min: 20, max: 400 },
        { obd: '0B', bytes: 1, at: 0, factor: 1, offset: 0, min: 20, max: 255 },
    ] },
    { id: 'boostTarget', name: 'Boost target', unit: 'psi', dec: 1, scale: [0, 30], src: 'dme', gauge: true, every: 0, cands: [
        { did: '4AB0', bytes: 2, at: 0, factor: 0.00390625, offset: 0, min: 20, max: 400 },
        { did: 'F470', bytes: 2, at: 1, factor: 0.03125, offset: 0, min: 20, max: 600 },
    ] },
    // fuel
    { id: 'eth', name: 'Ethanol Content (CAN)', unit: '%', dec: 0, scale: [0, 100], src: 'ff', key: 'can' },
    { id: 'ethActive', name: 'Ethanol Content (Active)', unit: '%', dec: 0, scale: [0, 100], src: 'ff', key: 'active' },
    { id: 'fuel', name: 'Fuel level', unit: 'gal', dec: 1, scale: [0, 15.6], src: 'ff', key: 'litres', conv: (l) => l / 3.785411784 },
    { id: 'rail', name: 'Rail pressure mean 1', unit: 'psi', dec: 0, scale: [0, 5800], src: 'dme', every: 0, conv: (b) => b * PSI_PER_BAR, cands: [
        { did: 'F423', bytes: 2, at: 0, factor: 0.1, offset: 0, min: 0, max: 500 },                 // bar
        { obd: '23', bytes: 2, at: 0, factor: 0.1, offset: 0, min: 0, max: 500 },
    ] },
    { id: 'lambda', name: 'Lambda 1', unit: '', dec: 2, scale: [0.6, 1.2], src: 'dme', every: 0, cands: [
        { obd: '34', bytes: 2, at: 0, factor: 2 / 65536, offset: 0, min: 0.3, max: 2 },
        { obd: '24', bytes: 2, at: 0, factor: 2 / 65536, offset: 0, min: 0.3, max: 2 },
    ] },
    { id: 'stft', name: 'STFT 1', unit: '%', dec: 1, scale: [-25, 25], src: 'dme', every: 500, cands: [
        { obd: '06', bytes: 1, at: 0, factor: 100 / 128, offset: -100, min: -100, max: 100 },
    ] },
    { id: 'ltft', name: 'LTFT 1', unit: '%', dec: 1, scale: [-25, 25], src: 'dme', every: 3000, cands: [
        { obd: '07', bytes: 1, at: 0, factor: 100 / 128, offset: -100, min: -100, max: 100 },
    ] },
    // engine
    { id: 'rpm', name: 'RPM', unit: '', dec: 0, scale: [0, 7500], src: 'car', key: 'rpm' },
    { id: 'load', name: 'Load act.', unit: '%', dec: 0, scale: [0, 200], src: 'dme', every: 0, cands: [
        { did: '5813', bytes: 1, at: 0, factor: 0.75, offset: 0, min: 0, max: 191.25 },
    ] },
    { id: 'loadReq', name: 'Load req.', unit: '%', dec: 0, scale: [0, 200], src: 'dme', every: 0, cands: [
        { did: '480C', bytes: 2, at: 0, factor: 0.0234375, offset: 0, min: 0, max: 250 },
    ] },
    { id: 'timing', name: 'Timing Cyl. 1', unit: '°', dec: 1, scale: [-10, 30], src: 'dme', every: 0, cands: [
        { obd: '0E', bytes: 1, at: 0, factor: 0.5, offset: -64, min: -64, max: 63.5 },
        { did: 'F40E', bytes: 1, at: 0, factor: 0.5, offset: -64, min: -64, max: 63.5 },
    ] },
    { id: 'throttle', name: 'Throttle Position', unit: '%', dec: 0, scale: [0, 100], src: 'dme', every: 0, cands: [
        { obd: '11', bytes: 1, at: 0, factor: 100 / 255, offset: 0, min: 0, max: 100 },
        { did: 'F411', bytes: 1, at: 0, factor: 100 / 255, offset: 0, min: 0, max: 100 },
    ] },
    { id: 'pedal', name: 'Accel Ped. Pos.', unit: '%', dec: 0, scale: [0, 100], src: 'dme', every: 0, cands: [
        { obd: '49', bytes: 1, at: 0, factor: 100 / 255, offset: 0, min: 0, max: 100 },
        { did: 'F449', bytes: 1, at: 0, factor: 100 / 255, offset: 0, min: 0, max: 100 },
    ] },
    { id: 'maf', name: 'MAF', unit: 'g/s', dec: 0, scale: [0, 400], src: 'dme', every: 0, cands: [
        { obd: '10', bytes: 2, at: 0, factor: 0.01, offset: 0, min: 0, max: 655 },
        { did: 'F410', bytes: 2, at: 0, factor: 0.01, offset: 0, min: 0, max: 655 },
    ] },
    { id: 'gear', name: 'Gear', unit: '', dec: 0, scale: [0, 8], src: 'car', key: 'gear' },
    { id: 'speed', name: 'Speed', unit: 'km/h', dec: 0, scale: [0, 300], src: 'car', key: 'speed' },
    // other
    { id: 'amb', name: 'Amb. temp.', unit: '°F', dec: 0, scale: [0, 120], src: 'da', key: 'ambient', conv: F },
    { id: 'batt', name: 'Battery volt.', unit: 'V', dec: 1, scale: [10, 16], src: 'dme', every: 2000, cands: [
        { obd: '42', bytes: 2, at: 0, factor: 0.001, offset: 0, min: 5, max: 20 },
        { did: 'F442', bytes: 2, at: 0, factor: 0.001, offset: 0, min: 5, max: 20 },
    ] },
];
// boost is shown over the outside air (gauge pressure): the engine unit's barometer, read now and then
const BARO = { id: 'baro', every: 30000, cands: [
    { did: 'F433', bytes: 1, at: 0, factor: 1, offset: 0, min: 50, max: 115 },
    { obd: '33', bytes: 1, at: 0, factor: 1, offset: 0, min: 50, max: 115 },
] };
const BY_ID = {};
CHANNELS.forEach((c) => { BY_ID[c.id] = c; });
const DEFAULT_SLOTS = ['oil', 'coolant', 'gb', 'iat', 'boost', 'timing', 'rail', 'lambda'];

module.exports = { CHANNELS, BY_ID, BARO, DEFAULT_SLOTS, PSI_PER_KPA };
