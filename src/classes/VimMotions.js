// A motion operates on rows of units: cells in the sheet, Unicode characters in a formula.
export const clamp = (n, low, high) => Math.max(low, Math.min(n, high));
export const compare = (a, b) => a.row - b.row || a.col - b.col;
export const offset = (rows, point) => rows.slice(0, point.row).reduce((n, row) => n + row.length + 1, 0) + point.col;
export function pointAt(rows, index) {
	for (let row = 0; row < rows.length; row++) {
		if (index <= rows[row].length || row === rows.length - 1) {
			return { row, col: clamp(index, 0, Math.max(0, rows[row].length - 1)) };
		}
		index -= rows[row].length + 1;
	}
}

const blank = value => !value || /^\s+$/u.test(value);
const charType = value => blank(value) ? 0 : /[\p{L}\p{N}_]/u.test(value) ? 1 : 2;

export function wordSpans(rows, sheet, big = false) {
	const spans = [];
	let base = 0;
	for (const row of rows) {
		if (!row.length || (sheet && row.every(blank))) spans.push([base, base]);
		for (let col = 0; col < row.length;) {
			if (blank(row[col])) { col++; continue; }
			const start = col++;
			while (col < row.length && !blank(row[col]) &&
				(big || (!sheet && charType(row[start]) === charType(row[col])))) col++;
			spans.push([base + start, base + col - 1]);
		}
		base += row.length + 1;
	}
	return spans;
}

function choose(indices, current, direction, count, fallback = current) {
	const targets = [...new Set(indices)].filter(n => direction > 0 ? n > current : n < current).sort((a, b) => direction * (a - b));
	return targets.length ? targets[Math.min(count, targets.length) - 1] : fallback;
}

function bracketPairs(units, open, close) {
	const stack = [], pairs = [];
	for (let i = 0; i < units.length; i++) {
		if (units[i] === open) stack.push(i);
		else if (units[i] === close && stack.length) pairs.push([stack.pop(), i]);
	}
	return pairs;
}

export function textObject(rows, point, name, count = 1, sheet = false) {
	const around = name[0] === 'a', kind = name[1];
	if (sheet && !'wWps'.includes(kind)) return null;
	const units = rows.flatMap((row, i) => i ? ['\n', ...row] : row);
	const current = offset(rows, point);
	let start, end;
	if ('wW'.includes(kind)) {
		const spans = wordSpans(rows, sheet, kind === 'W');
		let i = spans.findIndex(([a, b]) => a <= current && b >= current);
		if (i < 0) {
			start = current; end = current;
			while (start > 0 && blank(units[start - 1])) start--;
			while (end + 1 < units.length && blank(units[end + 1])) end++;
		} else {
			start = spans[i][0]; end = spans[Math.min(spans.length - 1, i + count - 1)][1];
		}
		if (around) {
			const oldEnd = end;
			while (end + 1 < units.length && blank(units[end + 1]) && units[end + 1] !== '\n') end++;
			if (end === oldEnd) while (start > 0 && blank(units[start - 1]) && units[start - 1] !== '\n') start--;
		}
	} else if ('p'.includes(kind)) {
		let first = point.row, last = point.row;
		const empty = row => sheet ? rows[row].every(blank) : rows[row].length === 0;
		while (first > 0 && empty(first - 1) === empty(point.row)) first--;
		for (let n = 0; n < count; n++) {
			while (last < rows.length - 1 && !empty(last + 1)) last++;
			if (n < count - 1) { while (last < rows.length - 1 && empty(last + 1)) last++; last = Math.min(last + 1, rows.length - 1); }
		}
		if (around) while (last < rows.length - 1 && empty(last + 1)) last++;
		return { start: { row: first, col: 0 }, end: { row: last, col: Math.max(0, rows[last].length - 1) }, linewise: true };
	} else if (kind === 's' && sheet) {
		const spans = wordSpans(rows, true, true);
		const i = spans.findIndex(([a, b]) => a <= current && b >= current);
		if (i < 0) return null;
		start = spans[i][0]; end = spans[Math.min(spans.length - 1, i + count - 1)][1];
		if (around) while (end + 1 < units.length && blank(units[end + 1]) && units[end + 1] !== '\n') end++;
	} else if (kind === 's') {
		const starts = sentenceStarts(units);
		start = [...starts].reverse().find(n => n <= current) ?? 0;
		end = (starts.filter(n => n > start)[count - 1] ?? units.length) - 1;
		if (!around) while (end > start && blank(units[end])) end--;
	} else if ('"\'`'.includes(kind)) {
		const base = offset(rows, { row: point.row, col: 0 });
		const positions = rows[point.row].flatMap((c, i) => c === kind && (i === 0 || rows[point.row][i - 1] !== '\\') ? [base + i] : []);
		for (let i = 0; i + 1 < positions.length; i += 2) {
			if (positions[i + 1] >= current) { [start, end] = positions.slice(i, i + 2); break; }
		}
		if (start === undefined) return null;
		if (!around) { start++; end--; }
	} else if (kind === 't' && !sheet) {
		// Pair equal tag names, including nested tags; self-closing tags are not blocks.
		const text = units.join(''), stack = [], pairs = [];
		for (const match of text.matchAll(/<\/?([\w:-]+)\b[^>]*>/g)) {
			const a = Array.from(text.slice(0, match.index)).length, b = a + Array.from(match[0]).length - 1;
			if (match[0].startsWith('</')) {
				const i = stack.findLastIndex(tag => tag.name === match[1]);
				if (i >= 0) { const tag = stack[i]; stack.splice(i); pairs.push([tag.a, b, tag.b + 1, a - 1]); }
			} else if (!match[0].endsWith('/>')) stack.push({ name: match[1], a, b });
		}
		const pair = pairs.filter(([a, b]) => a <= current && b >= current).sort((a, b) => a[1] - a[0] - (b[1] - b[0]))[count - 1];
		if (!pair) return null;
		[start, end] = around ? pair : pair.slice(2);
	} else {
		const aliases = { b: '(', B: '{', ')': '(', ']': '[', '}': '{', '>': '<' };
		const open = aliases[kind] || kind, close = { '(': ')', '[': ']', '{': '}', '<': '>' }[open];
		if (!close) return null;
		const pairs = bracketPairs(units, open, close).filter(([a, b]) => a <= current && b >= current).sort((a, b) => a[1] - a[0] - (b[1] - b[0]));
		if (!pairs[count - 1]) return null;
		[start, end] = pairs[count - 1];
		if (!around) { start++; end--; }
	}
	return { start: pointAt(rows, start), end: pointAt(rows, Math.max(start, end)), empty: end < start };
}

function sentenceStarts(units) {
	const starts = [0];
	for (let i = 0; i < units.length; i++) {
		if (!'.!?'.includes(units[i])) continue;
		let end = i + 1;
		while (end < units.length && ')]"\''.includes(units[end])) end++;
		if (end < units.length && !blank(units[end])) continue;
		while (end < units.length && blank(units[end])) end++;
		if (end < units.length) starts.push(end);
	}
	return starts;
}

export function resolveMotion(rows, point, key, count = 1, options = {}) {
	const { sheet = false, explicit = false, state = {}, viewport = {} } = options;
	const lastRow = rows.length - 1;
	const bounded = p => ({ row: clamp(p.row, 0, lastRow), col: clamp(p.col, 0, Math.max(0, rows[clamp(p.row, 0, lastRow)].length - 1)) });
	let target = { ...point }, inclusive = false, linewise = false, jump = false;
	const units = rows.flatMap((row, i) => i ? ['\n', ...row] : row);
	const current = offset(rows, point);
	const first = row => Math.max(0, rows[row].findIndex(c => !blank(c)));
	const last = row => Math.max(0, rows[row].findLastIndex(c => !blank(c)));
	const top = viewport.top ?? 0, bottom = viewport.bottom ?? lastRow;
	const left = viewport.left ?? 0, right = viewport.right ?? Math.max(0, rows[point.row].length - 1);
	if (['h', 'l', 'j', 'k', 'gj', 'gk', ' '].includes(key)) {
		if (key === 'h') target.col -= count;
		else if (key === 'l' || key === ' ') target.col += count;
		else { target.row += (key.endsWith('j') ? 1 : -1) * count; linewise = key.length === 1; }
	} else if (['0', '^', '$', 'g_', '|', 'g0', 'g^', 'g$', 'g<End>', 'gm', 'gM'].includes(key)) {
		if (key === '$' || key === 'g_') target.row = Math.min(lastRow, point.row + count - 1);
		if (key === '0') target.col = 0;
		if (key === '^') target.col = first(target.row);
		if (key === '$') { target.col = Math.max(0, rows[target.row].length - 1); inclusive = true; }
		if (key === 'g_') { target.col = last(target.row); inclusive = true; }
		if (key === '|') target.col = count - 1;
		if (key === 'g0') target.col = left;
		if (key === 'g^') target.col = Math.max(left, rows[target.row].findIndex((c, i) => i >= left && !blank(c)));
		if (key === 'g$') { target.col = right; inclusive = true; }
		if (key === 'g<End>') { target.col = Math.max(left, rows[target.row].findLastIndex((c, i) => i <= right && i >= left && !blank(c))); inclusive = true; }
		if (key === 'gm') target.col = Math.floor((left + right) / 2);
		if (key === 'gM') target.col = Math.floor((rows[target.row].length - 1) * (explicit ? clamp(count, 1, 100) : 50) / 100);
	} else if (['+', '-', '_', 'gg', 'G', '<C-End>', 'H', 'M', 'L'].includes(key) || (key === '%' && explicit)) {
		linewise = true;
		if (key === '+') target.row += count;
		if (key === '-') target.row -= count;
		if (key === '_') target.row += count - 1;
		if (key === 'gg') target.row = explicit ? count - 1 : 0;
		if (key === 'G' || key === '<C-End>') target.row = explicit ? count - 1 : lastRow;
		if (key === '%') { if (count > 100) return null; target.row = Math.ceil(rows.length * count / 100) - 1; }
		if (key === 'H') target.row = Math.min(bottom, top + count - 1);
		if (key === 'M') target.row = Math.floor((top + bottom) / 2);
		if (key === 'L') target.row = Math.max(top, bottom - count + 1);
		target = bounded(target); target.col = first(target.row);
		if (key === '<C-End>') { target.col = Math.max(0, rows[target.row].length - 1); linewise = false; inclusive = true; }
		jump = !['+', '-', '_'].includes(key);
	} else if (key === 'go') {
		let index = count - 1;
		if (sheet) {
			index = Math.min(index, rows.length * rows[0].length - 1);
			target = { row: Math.floor(index / rows[0].length), col: index % rows[0].length };
		} else {
			let bytes = 0; index = 0;
			while (index < units.length - 1 && bytes + new TextEncoder().encode(units[index]).length <= count - 1) bytes += new TextEncoder().encode(units[index++]).length;
			target = pointAt(rows, index);
		}
		jump = true;
	} else if (['w', 'W', 'b', 'B', 'e', 'E', 'ge', 'gE'].includes(key)) {
		const spans = wordSpans(rows, sheet, /[WEB]/.test(key));
		const ends = key.toLowerCase().endsWith('e');
		const direction = key === 'ge' || key === 'gE' || key.toLowerCase() === 'b' ? -1 : 1;
		const candidates = spans.filter(([a, b]) => !ends || !blank(units[a])).map(span => span[ends ? 1 : 0]);
		target = pointAt(rows, choose(candidates, current, direction, count, direction > 0 ? units.length - 1 : 0));
		inclusive = ends;
	} else if (/^[fFtT].$/us.test(key) || key === ';' || key === ',') {
		let find = state.find;
		if (Array.from(key).length === 2) find = { char: Array.from(key)[1], direction: key[0] === key[0].toLowerCase() ? 1 : -1, till: key[0].toLowerCase() === 't' };
		if (!find) return null;
		const direction = find.direction * (key === ',' ? -1 : 1);
		const row = rows[point.row];
		const candidates = row.flatMap((c, i) => (sheet ? c.includes(find.char) : c === find.char) ? [i] : []);
		const from = point.col + (key.length === 1 && find.till ? direction : 0);
		if (candidates.filter(index => direction * (index - from) > 0).length < count) return null;
		const index = choose(candidates, from, direction, count, -1);
		if (index < 0) return null;
		target.col = index - (find.till ? direction : 0);
		if (Array.from(key).length === 2) state.find = find;
		inclusive = direction > 0;
	} else if (['[*', '[/', ']*', ']/'].includes(key)) {
		if (sheet) return null;
		const direction = key[0] === '[' ? -1 : 1, text = units.join('');
		const positions = [...text.matchAll(direction < 0 ? /\/\*/g : /\*\//g)].map(match => Array.from(text.slice(0, match.index)).length + (direction > 0 ? 1 : 0));
		const index = choose(positions, current, direction, count, -1);
		if (index < 0) return null;
		target = pointAt(rows, index);
	} else if (key === '[#' || key === ']#') {
		if (sheet) return null;
		const direction = key[0] === '[' ? -1 : 1;
		let depth = 0, remaining = count, found;
		for (let row = point.row + direction; row >= 0 && row <= lastRow; row += direction) {
			const directive = rows[row].join('').match(/^\s*#\s*(if(?:def|ndef)?|elif|else|endif)\b/)?.[1];
			if (!directive) continue;
			if (direction > 0 ? directive.startsWith('if') : directive === 'endif') depth++;
			else if (direction > 0 ? directive === 'endif' : directive.startsWith('if')) {
				if (depth) depth--; else if (--remaining === 0) { found = row; break; }
			} else if (!depth && --remaining === 0) { found = row; break; }
		}
		if (found === undefined) return null;
		target = { row: found, col: rows[found].indexOf('#') };
	} else if (key === '%') {
		if (sheet) return null; // Brackets belong to formula text, never to cell coordinates.
		const next = units.findIndex((c, i) => i >= current && i < current + rows[point.row].length - point.col && '()[]{}'.includes(c));
		const directive = rows[point.row].join('').match(/^\s*#\s*(if(?:def|ndef)?|elif|else|endif)\b/);
		if (directive && (point.col <= rows[point.row].indexOf('#') || next < 0)) {
			if (directive[1] !== 'endif') {
				const motion = resolveMotion(rows, point, ']#', 1, options);
				return motion ? { ...motion, linewise: true, jump: true } : null;
			}
			let depth = 0;
			for (let row = point.row - 1; row >= 0; row--) {
				const kind = rows[row].join('').match(/^\s*#\s*(if(?:def|ndef)?|endif)\b/)?.[1];
				if (kind === 'endif') depth++;
				else if (kind) { if (depth) depth--; else return { point: { row, col: rows[row].indexOf('#') }, linewise: true, jump: true }; }
			}
			return null;
		}
		const marker = units.slice(Math.max(0, current - 1), current + 2).join('');
		if (marker.includes('/*') || marker.includes('*/')) {
			const text = units.join(''), utf16 = units.slice(0, current).join('').length;
			const end = marker.includes('/*'), match = end ? text.indexOf('*/', utf16 + 1) : text.lastIndexOf('/*', utf16 - 1);
			if (match < 0) return null;
			return { point: pointAt(rows, Array.from(text.slice(0, match)).length + (end ? 1 : 0)), inclusive: true, jump: true };
		}
		if (next < 0) return null;
		let match;
		for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
			const pair = bracketPairs(units, open, close).find(pair => pair.includes(next));
			if (pair) match = pair[0] === next ? pair[1] : pair[0];
		}
		if (match === undefined) return null;
		target = pointAt(rows, match); inclusive = true; jump = true;
	} else if (['[(', '[{', '])', ']}'].includes(key)) {
		if (sheet) return null;
		const direction = key[0] === '[' ? -1 : 1;
		const char = key[1], opposite = { '(': ')', '{': '}', ')': '(', '}': '{' }[char];
		let depth = 0, remaining = count, found;
		for (let i = current + direction; i >= 0 && i < units.length; i += direction) {
			if (units[i] === opposite) depth++;
			if (units[i] === char) { if (depth) depth--; else if (--remaining === 0) { found = i; break; } }
		}
		if (found === undefined) return null;
		target = pointAt(rows, found);
	} else if (['(', ')', '{', '}', '[[', ']]', '[]', '][', '[m', ']m', '[M', ']M'].includes(key)) {
		const direction = ['(', '{', '[[', '[]', '[m', '[M'].includes(key) ? -1 : 1;
		let candidates = [];
		if ((key === '(' || key === ')') && !sheet) candidates = sentenceStarts(units);
		else if (sheet && (key === '(' || key === ')')) {
			candidates = wordSpans(rows, true, true).map(span => span[0]);
		} else if (key === '{' || key === '}') {
			const empty = row => sheet ? row.every(blank) : row.length === 0;
			rows.forEach((row, r) => { if (empty(row) && (r === 0 || !empty(rows[r - 1]))) candidates.push(offset(rows, { row: r, col: 0 })); });
		} else if (sheet) {
			const end = ['[]', '][', '[M', ']M'].includes(key);
			rows.forEach((row, r) => { if (row.some(c => !blank(c)) && (end ? r === lastRow || rows[r + 1].every(blank) : r === 0 || rows[r - 1].every(blank))) candidates.push(offset(rows, { row: r, col: 0 })); });
		} else {
			const char = ['[]', '][', '[M', ']M'].includes(key) ? '}' : '{';
			units.forEach((c, i) => { if (c === char && (key.endsWith('m') || key.endsWith('M') || i === 0 || units[i - 1] === '\n')) candidates.push(i); });
		}
		target = pointAt(rows, choose(candidates, current, direction, count, direction > 0 ? units.length - 1 : 0)); jump = true;
	} else if (/^g['`].$/us.test(key)) {
		const motion = resolveMotion(rows, point, key.slice(1), count, options);
		return motion ? { ...motion, jump: false } : null;
	} else if (/^['`].$/us.test(key)) {
		const mark = state.marks?.[key[1]] || ('(){}'.includes(key[1]) ? resolveMotion(rows, point, key[1], 1, options)?.point : null);
		if (!mark) return null;
		target = { ...mark };
		if (key[0] === "'") { target.col = first(clamp(target.row, 0, lastRow)); linewise = true; }
		jump = true;
	} else if (/^[\[\]]['`]$/.test(key)) {
		const direction = key[0] === '[' ? -1 : 1;
		const marks = Object.entries(state.marks || {}).filter(([name, p]) => /^[a-z]$/.test(name) && (key[1] !== "'" || direction * (p.row - point.row) > 0)).map(([, p]) => offset(rows, p));
		const index = choose(marks, current, direction, count, -1);
		if (index < 0) return null;
		target = pointAt(rows, index); jump = true;
		if (key[1] === "'") { target.col = first(target.row); linewise = true; }
	} else return null;
	return { point: bounded(target), inclusive, linewise, jump };
}
