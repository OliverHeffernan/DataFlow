// Persistent reference metadata. Values stay in sheet grids; headers are the column names.
export const markName = name => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
export const overlaps = (a, b) => a.r0 <= b.r1 && b.r0 <= a.r1 && a.c0 <= b.c1 && b.c0 <= a.c1;

export function datasetColumns(mark, sheets) {
	const sheet = sheets.find(sheet => sheet.name === mark.sheetName), b = mark.bounds;
	const names = new Set();
	return sheet.rows[b.r0].slice(b.c0, b.c1 + 1).map((name, i) => {
		if (!markName(name) || names.has(name.toLowerCase())) throw new Error(`Dataset ${mark.name} headers must be literal, unique identifiers`);
		names.add(name.toLowerCase());
		return { name, col: b.c0 + i };
	});
}

export function validateMarks(marks, sheets) {
	if (!Array.isArray(marks)) throw new Error('Invalid workbook marks');
	const names = new Set();
	for (const mark of marks) {
		if (!mark || !markName(mark.name) || names.has(mark.name.toLowerCase()) || !['cell', 'range', 'dataset'].includes(mark.kind)) throw new Error('Invalid or duplicate workbook mark');
		names.add(mark.name.toLowerCase());
		const sheet = sheets.find(sheet => sheet.name === mark.sheetName), b = mark.bounds;
		if (!sheet) throw new Error(`Unknown mark sheet: ${mark.sheetName}`);
		if (b === null && mark.kind !== 'dataset') continue;
		if (!b || !['r0', 'c0', 'r1', 'c1'].every(key => Number.isInteger(b[key]) && b[key] >= 0)
			|| b.r1 < b.r0 || b.c1 < b.c0 || b.r1 >= sheet.rows.length || b.c1 >= sheet.rows[0].length
			|| (mark.kind === 'cell' && (b.r0 !== b.r1 || b.c0 !== b.c1))) throw new Error(`Invalid bounds for mark ${mark.name}`);
		if (mark.kind === 'dataset') datasetColumns(mark, sheets);
	}
	const datasets = marks.filter(mark => mark.kind === 'dataset');
	for (let i = 0; i < datasets.length; i++) for (let j = 0; j < i; j++) {
		if (datasets[i].sheetName === datasets[j].sheetName && overlaps(datasets[i].bounds, datasets[j].bounds)) throw new Error('Datasets cannot overlap');
	}
	return marks;
}

export function structuralMarks(marks, sheetName, axis, at, removed, inserted) {
	const lo = axis === 'row' ? 'r0' : 'c0', hi = axis === 'row' ? 'r1' : 'c1';
	return marks.map(mark => {
		if (mark.sheetName !== sheetName || !mark.bounds) return mark;
		const b = { ...mark.bounds }, start = b[lo], end = b[hi];
		if (mark.kind === 'dataset') {
			if (axis === 'col' && ((removed && at <= end && at + removed > start) || (inserted && at > start && at <= end))) throw new Error(`Dataset ${mark.name} has fixed columns; remove its definition before reshaping columns`);
			if (axis === 'row' && removed && at <= start && at + removed > start) throw new Error(`Cannot delete dataset ${mark.name}'s header; use :delmarks first`);
		}
		if (removed) {
			const survivors = end - start + 1 - Math.max(0, Math.min(end + 1, at + removed) - Math.max(start, at));
			if (!survivors) return { ...mark, bounds: null };
			b[lo] = start < at ? start : Math.max(at, start - removed);
			b[hi] = b[lo] + survivors - 1;
		}
		if (inserted) {
			if (at <= b[lo]) { b[lo] += inserted; b[hi] += inserted; }
			else if (at <= b[hi]) b[hi] += inserted;
		}
		return { ...mark, bounds: b };
	});
}
