import { isBigNumber } from 'mathjs';
import { cellToValue } from './FormulaFunctions.js';

export const formatDefaults = Object.freeze({
	formatKind: 'general', formatDigits: 2, formatPercent: false, formatGroup: false,
	formatCurrency: 'NZD', formatPreset: 'iso', formatIncludeTime: false,
	formatSeconds: true, formatTimeZone: 'UTC',
});
export const formatTypes = ['general', 'number', 'currency', 'date', 'time'];
export const formatKeys = Object.keys(formatDefaults);
export const formatTypeLabel = kind => ({ general: 'General', number: 'Number', currency: 'Currency', date: 'Date', time: 'Time' })[kind];
export const horizontalAlignments = ['auto', 'left', 'center', 'right'];

// Flat, primitive metadata fits workbook persistence without changing the raw cell schema.
export function formatSpec(style = {}) {
	const spec = { ...formatDefaults, ...Object.fromEntries(formatKeys.filter(key => style[key] !== undefined).map(key => [key, style[key]])) };
	if (spec.formatKind === 'currency' && style.formatGroup === undefined) spec.formatGroup = true;
	if (!formatTypes.includes(spec.formatKind) || !Number.isInteger(spec.formatDigits) || spec.formatDigits < 0 || spec.formatDigits > 64
		|| !['formatPercent', 'formatGroup', 'formatIncludeTime', 'formatSeconds'].every(key => typeof spec[key] === 'boolean')
		|| !/^[A-Z]{3}$/.test(spec.formatCurrency) || !['iso', 'short', 'long'].includes(spec.formatPreset) || typeof spec.formatTimeZone !== 'string') {
		throw new Error('Unsupported format settings; showing the unformatted value');
	}
	return spec;
}

export function formatFields(spec) {
	const keys = spec.formatKind === 'number' ? ['formatDigits', 'formatGroup', 'formatPercent']
		: spec.formatKind === 'currency' ? ['formatDigits', 'formatGroup', 'formatCurrency']
		: spec.formatKind === 'date' ? ['formatPreset', 'formatIncludeTime', 'formatSeconds', 'formatTimeZone']
		: spec.formatKind === 'time' ? ['formatSeconds', 'formatTimeZone'] : [];
	return spec.formatKind === 'general' ? {} : Object.fromEntries(['formatKind', ...keys].map(key => [key, spec[key]]));
}

export function withFormat(style, spec) {
	return { ...Object.fromEntries(Object.entries(style).filter(([key]) => !formatKeys.includes(key))), ...formatFields(spec) };
}

export function formatSummary(spec) {
	if (spec.formatKind === 'general') return 'General';
	if (spec.formatKind === 'number') return `${spec.formatPercent ? 'Percent' : 'Number'} · ${spec.formatDigits} dp`;
	if (spec.formatKind === 'currency') return `${spec.formatCurrency} · ${spec.formatDigits} dp`;
	if (spec.formatKind === 'time') return 'Time';
	return spec.formatIncludeTime ? `Date + time · ${spec.formatTimeZone}` : `Date · ${{ iso: 'ISO', short: '20/10/2026', long: '20 Oct 2026' }[spec.formatPreset]}`;
}

export function summarizeFormats(styles) {
	try {
		const specs = [...styles].map(formatSpec), first = JSON.stringify(formatFields(specs[0]));
		return specs.every(spec => JSON.stringify(formatFields(spec)) === first) ? formatSummary(specs[0]) : 'Mixed';
	} catch { return 'Unsupported format'; }
}

const pad = value => String(value).padStart(2, '0');
const leap = year => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
const utc = (y, m, d, h = 0, min = 0, s = 0, ms = 0) => {
	const date = new Date(0);
	date.setUTCFullYear(y, m - 1, d); date.setUTCHours(h, min, s, ms);
	return date.getTime();
};

function temporal(text) {
	if (typeof text !== 'string') throw new Error('Date/time formatting requires ISO text, not a numeric serial');
	const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2}))?$/);
	if (match) {
		const [, year, month, day, hour, minute, second = '0', fraction = '', zone] = match;
		const y = Number(year), m = Number(month), d = Number(day), h = Number(hour ?? 0), min = Number(minute ?? 0), s = Number(second);
		const days = [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
		if (y < 1 || m < 1 || m > 12 || d < 1 || d > days[m - 1] || h > 23 || min > 59 || s > 59) throw new Error('Invalid ISO date/time');
		if (!zone) return { y, m, d, civil: 'date' };
		const zh = zone === 'Z' ? 0 : Number(zone.slice(1, 3)), zm = zone === 'Z' ? 0 : Number(zone.slice(4));
		if (zh > 23 || zm > 59) throw new Error('Invalid ISO timezone offset');
		const offset = (zone[0] === '-' ? -1 : 1) * (zh * 60 + zm);
		return { instant: utc(y, m, d, h, min, s, Number(fraction.padEnd(3, '0'))) - offset * 60000 };
	}
	const time = text.match(/^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
	if (time && Number(time[1]) < 24 && Number(time[2]) < 60 && Number(time[3] ?? 0) < 60) return { h: Number(time[1]), min: Number(time[2]), s: Number(time[3] ?? 0), civil: 'time' };
	throw new Error('Use ISO YYYY-MM-DD, HH:mm[:ss], or a timestamp with Z / explicit offset');
}

function dateText(value, spec) {
	let parts = temporal(value), suffix = '';
	if (parts.instant !== undefined) {
		const formatter = new Intl.DateTimeFormat('en-NZ', {
			timeZone: spec.formatTimeZone, calendar: 'gregory', numberingSystem: 'latn', hourCycle: 'h23',
			era: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
		});
		const fields = Object.fromEntries(formatter.formatToParts(new Date(parts.instant)).map(part => [part.type, part.value]));
		const instant = parts.instant;
		parts = { y: Number(fields.year), m: Number(fields.month), d: Number(fields.day), h: Number(fields.hour), min: Number(fields.minute), s: Number(fields.second) };
		if (fields.era !== 'AD' || parts.y < 1 || parts.y > 9999) throw new Error('Displayed date is outside years 0001–9999');
		const offset = (utc(parts.y, parts.m, parts.d, parts.h, parts.min, parts.s) - Math.floor(instant / 1000) * 1000) / 1000, abs = Math.abs(offset);
		suffix = spec.formatTimeZone === 'UTC' ? ' UTC' : ` ${offset < 0 ? '-' : '+'}${pad(Math.floor(abs / 3600))}:${pad(Math.floor(abs / 60) % 60)}${abs % 60 ? `:${pad(abs % 60)}` : ''} [${spec.formatTimeZone}]`;
	}
	const showTime = spec.formatKind === 'time' || spec.formatIncludeTime;
	if (spec.formatKind === 'date' && parts.civil === 'time') throw new Error('This clock time has no date');
	if (showTime && parts.civil === 'date') throw new Error('This civil date has no time; no midnight was invented');
	const clock = showTime ? `${pad(parts.h)}:${pad(parts.min)}${spec.formatSeconds ? `:${pad(parts.s)}` : ''}${suffix}` : '';
	if (spec.formatKind === 'time') return clock;
	const date = spec.formatPreset === 'iso' ? `${String(parts.y).padStart(4, '0')}-${pad(parts.m)}-${pad(parts.d)}`
		: spec.formatPreset === 'short' ? `${pad(parts.d)}/${pad(parts.m)}/${String(parts.y).padStart(4, '0')}`
		: `${pad(parts.d)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][parts.m - 1]} ${String(parts.y).padStart(4, '0')}`;
	return clock ? `${date} ${clock}` : date;
}

// Returns presentation only. Callers retain the exact value and legacy native-number APIs.
export function presentCell(value, style, generalText = String(value ?? '')) {
	// General uses the calculated type, not numeric-looking formula text. Explicit styles
	// are resolved by the renderer so a matching CF auto can bypass direct alignment.
	const align = typeof value === 'number' || isBigNumber(value) ? 'right' : 'left';
	try {
		const spec = formatSpec(style);
		if (spec.formatKind === 'general' || value === '' || value == null || value?.kind === 'chart') return { text: generalText, warning: '', align };
		if (['date', 'time'].includes(spec.formatKind)) return { text: dateText(value, spec), warning: '', align: 'right' };
		let number = cellToValue(typeof value === 'number' ? String(value) : value);
		if (!isBigNumber(number) || !number.isFinite()) throw new Error('This format requires a finite real number');
		if (spec.formatKind === 'number' && spec.formatPercent) {
			// Shift the decimal exponent exactly, including literals longer than calculation precision.
			number = new number.constructor(number.toExponential().replace(/e([+-]?\d+)$/, (_, e) => `e${Number(e) + 2}`));
			if (!number.isFinite()) throw new Error('Percent display is outside the numeric exponent range');
		}
		const tooLong = number.e + 1 + spec.formatDigits + 2 > 1024;
		let text = tooLong ? number.toExponential(63, 4) : number.toFixed(spec.formatDigits, 4);
		if (/^-0(?:\.0+)?$/.test(text)) text = text.slice(1);
		if (spec.formatGroup && !tooLong) {
			const [integer, fraction] = text.split('.');
			text = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : `.${fraction}`);
		}
		if (spec.formatKind === 'currency') text = `${text[0] === '-' ? '-' : ''}${spec.formatCurrency} ${text.replace(/^-/, '')}`;
		else if (spec.formatPercent) text += '%';
		return { text, warning: tooLong ? 'Fixed display exceeds 1024 characters; showing scientific notation' : '', align: 'right' };
	} catch (error) { return { text: generalText, warning: error.message, align }; }
}
