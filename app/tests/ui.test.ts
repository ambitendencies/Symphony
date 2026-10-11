import { describe, expect, it } from 'vitest';
import {
  angleDelta,
  dragPosition,
  easeHue,
  formatAgo,
  formatRemaining,
  nearestIndex,
  parseBlends,
  pointerAngle,
  positionAtAngle,
  sparklinePoints,
  stationAngle,
  staticAmount,
} from '../src/lib/ui/helpers';

describe('dial maths', () => {
  it('spreads stations evenly across the arc', () => {
    expect(stationAngle(0, 4)).toBe(-120);
    expect(stationAngle(3, 4)).toBe(120);
    expect(stationAngle(1, 4)).toBeCloseTo(-40);
    expect(stationAngle(0, 1)).toBe(0);
  });
  it('round-trips angle and position', () => {
    for (let i = 0; i < 4; i++) expect(positionAtAngle(stationAngle(i, 4), 4)).toBeCloseTo(i);
  });
  it('clamps drags to the dial', () => {
    expect(dragPosition(0, -90, 4)).toBe(0);
    expect(dragPosition(2, 500, 4)).toBe(3);
    expect(dragPosition(0, 80, 4)).toBeCloseTo(1);
  });
  it('measures pointer angles clockwise from 12 o’clock', () => {
    expect(pointerAngle(0, -1)).toBeCloseTo(0);
    expect(pointerAngle(1, 0)).toBeCloseTo(90);
    expect(pointerAngle(0, 1)).toBeCloseTo(180);
    expect(pointerAngle(-1, 0)).toBeCloseTo(-90);
  });
  it('takes the short way round', () => {
    expect(angleDelta(350, 10)).toBe(-20);
    expect(angleDelta(10, 350)).toBe(20);
  });
  it('picks the nearest station and static amount', () => {
    expect(nearestIndex(1.4, 4)).toBe(1);
    expect(nearestIndex(9, 4)).toBe(3);
    expect(staticAmount(2)).toBe(0);
    expect(staticAmount(2.5)).toBe(1);
  });
  it('eases hue across the wrap', () => {
    const h = easeHue(350, 10, 0.5);
    expect(h).toBeCloseTo(0);
  });
});

describe('formatting', () => {
  it('formats data age', () => {
    expect(formatAgo(10_000)).toBe('just now');
    expect(formatAgo(4 * 60_000)).toBe('4 min ago');
    expect(formatAgo(3 * 3600_000)).toBe('3 h ago');
    expect(formatAgo(-5)).toBe('just now');
  });
  it('formats sleep countdown', () => {
    expect(formatRemaining(61_000)).toBe('1:01');
    expect(formatRemaining(3_600_000 + 5_000)).toBe('1:00:05');
    expect(formatRemaining(-1)).toBe('0:00');
  });
  it('builds sparkline points', () => {
    expect(sparklinePoints([1], 10, 10)).toBe('');
    expect(sparklinePoints([1, 2, 3], 100, 20).split(' ')).toHaveLength(3);
    expect(sparklinePoints([5, 5], 100, 20)).not.toContain('NaN');
  });
});

describe('saved blends', () => {
  it('drops malformed entries', () => {
    expect(parseBlends(null)).toEqual([]);
    expect(parseBlends('nope')).toEqual([]);
    const ok = { id: 'a', name: 'A', station: 's', mood: 'drift', mix: { v: { level: 9, muted: false, solo: true } } };
    const out = parseBlends(JSON.stringify([ok, { id: 1 }]));
    expect(out).toHaveLength(1);
    expect(out[0].mix.v.level).toBe(1.5);
  });
});
