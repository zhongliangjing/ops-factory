import { describe, it, expect } from 'vitest'

/**
 * Test the pure formatter/helper functions used in Monitoring.tsx.
 * These are re-created locally since they are not exported.
 */

// Re-create formatters from Monitoring.tsx for unit testing

function fmtNum(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
    return n.toFixed(0)
}

function fmtSec(sec: number): string {
    if (sec >= 60) return `${(sec / 60).toFixed(1)}m`
    if (sec >= 1) return `${sec.toFixed(2)}s`
    return `${(sec * 1000).toFixed(0)}ms`
}

function fmtMs2(ms: number): string {
    if (ms === 0) return '\u2014'
    if (ms < 1000) return `${Math.round(ms)}ms`
    return `${(ms / 1000).toFixed(2)}s`
}

function fmtTimeShort(epoch: number): string {
    const d = new Date(epoch)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function fmtIdleTime(ms: number): string {
    const sec = Math.floor(ms / 1000)
    if (sec < 60) return `${sec}s`
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min}m`
    const hr = Math.floor(min / 60)
    return `${hr}h ${min % 60}m`
}

// ── fmtNum ──

describe('fmtNum', () => {
    it('formats millions', () => {
        expect(fmtNum(1_500_000)).toBe('1.5M')
        expect(fmtNum(1_000_000)).toBe('1.0M')
    })

    it('formats thousands', () => {
        expect(fmtNum(1_500)).toBe('1.5k')
        expect(fmtNum(1_000)).toBe('1.0k')
        expect(fmtNum(999_999)).toBe('1000.0k')
    })

    it('formats small numbers', () => {
        expect(fmtNum(0)).toBe('0')
        expect(fmtNum(42)).toBe('42')
        expect(fmtNum(999)).toBe('999')
    })
})

// ── fmtSec ──

describe('fmtSec', () => {
    it('formats minutes', () => {
        expect(fmtSec(120)).toBe('2.0m')
        expect(fmtSec(90)).toBe('1.5m')
    })

    it('formats seconds', () => {
        expect(fmtSec(1)).toBe('1.00s')
        expect(fmtSec(5.5)).toBe('5.50s')
    })

    it('formats milliseconds', () => {
        expect(fmtSec(0.5)).toBe('500ms')
        expect(fmtSec(0.001)).toBe('1ms')
        expect(fmtSec(0)).toBe('0ms')
    })
})

// ── fmtMs2 ──

describe('fmtMs2', () => {
    it('returns dash for zero', () => {
        expect(fmtMs2(0)).toBe('\u2014')
    })

    it('formats sub-second values as ms', () => {
        expect(fmtMs2(250)).toBe('250ms')
        expect(fmtMs2(999)).toBe('999ms')
        expect(fmtMs2(1)).toBe('1ms')
    })

    it('formats 1+ second values as seconds', () => {
        expect(fmtMs2(1000)).toBe('1.00s')
        expect(fmtMs2(2500)).toBe('2.50s')
        expect(fmtMs2(10000)).toBe('10.00s')
    })

    it('rounds ms values', () => {
        expect(fmtMs2(123.456)).toBe('123ms')
        expect(fmtMs2(999.9)).toBe('1000ms')
    })
})

// ── fmtTimeShort ──

describe('fmtTimeShort', () => {
    it('formats epoch to HH:MM', () => {
        // Use a known UTC time and check format
        const epoch = new Date(2024, 0, 15, 9, 5).getTime()
        expect(fmtTimeShort(epoch)).toBe('09:05')
    })

    it('pads single-digit hours and minutes', () => {
        const epoch = new Date(2024, 0, 15, 3, 7).getTime()
        expect(fmtTimeShort(epoch)).toBe('03:07')
    })

    it('handles midnight', () => {
        const epoch = new Date(2024, 0, 15, 0, 0).getTime()
        expect(fmtTimeShort(epoch)).toBe('00:00')
    })
})

// ── fmtIdleTime ──

describe('fmtIdleTime', () => {
    it('formats seconds', () => {
        expect(fmtIdleTime(5000)).toBe('5s')
        expect(fmtIdleTime(59000)).toBe('59s')
    })

    it('formats minutes', () => {
        expect(fmtIdleTime(60000)).toBe('1m')
        expect(fmtIdleTime(300000)).toBe('5m')
    })

    it('formats hours and minutes', () => {
        expect(fmtIdleTime(3600000)).toBe('1h 0m')
        expect(fmtIdleTime(5400000)).toBe('1h 30m')
    })

    it('handles zero', () => {
        expect(fmtIdleTime(0)).toBe('0s')
    })
})
