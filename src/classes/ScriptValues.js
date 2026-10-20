import { bignumber, isBigNumber } from 'mathjs';

// This boundary must run before the UI's toCellValue(), which converts decimals to Number.
export function toScriptValue(value, blank = false) {
	if (blank) return { kind: 'blank' };
	if (isBigNumber(value)) return value.isFinite()
		? { kind: 'number', decimal: value.toString() }
		: { kind: 'unsupported', type: 'non-finite number' };
	if (typeof value === 'number') return Number.isFinite(value)
		? { kind: 'number', decimal: String(value) }
		: { kind: 'unsupported', type: 'non-finite number' };
	if (typeof value === 'string') return { kind: 'text', text: value };
	if (typeof value === 'boolean') return { kind: 'boolean', value };
	if (value?.kind === 'chart') return { kind: 'chart' };
	return { kind: 'unsupported', type: 'non-scalar value' };
}

export function scriptValueToRaw(cell) {
	switch (cell.kind) {
		case 'blank': return '';
		case 'text':
			if (typeof cell.text === 'string') return `=${JSON.stringify(cell.text)}`;
			break;
		case 'boolean':
			if (typeof cell.value === 'boolean') return cell.value ? '=TRUE' : '=FALSE';
			break;
		case 'number':
			if (typeof cell.decimal === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(cell.decimal)) {
				const value = bignumber(cell.decimal);
				const nonzero = /[1-9]/.test(cell.decimal.split(/e/i)[0]);
				if (value.isFinite() && (!nonzero || !value.isZero())) return cell.decimal;
			}
			break;
		default: throw new Error(`Cannot write computed ${cell.kind || 'untyped'} cells; use raw content for formulas and charts`);
	}
	throw new Error(`Invalid ${cell.kind} cell; numbers require decimal strings`);
}
