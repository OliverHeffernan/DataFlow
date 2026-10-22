const cache = new WeakMap();
const prefix = sizes => sizes.reduce((offsets, size) => { offsets.push(offsets.at(-1) + size); return offsets; }, [0]);

// Layout uses the same unwrapped monospace text, padding and borders as SheetCell.
// Calculation and workbook data remain complete; only their DOM representation is windowed.
export default class GridGeometry {
	static for(cells, font, measure) {
		const previous = cache.get(cells);
		if (previous?.font === font) return previous.geometry;
		const geometry = new GridGeometry(cells, measure);
		cache.set(cells, { font, geometry });
		return geometry;
	}
	constructor(cells, measure) {
		this.header = 21;
		this.label = Math.max(45, Math.ceil(measure(String(cells.length - 1)) * 16 / 15) + 20);
		const widths = Array(cells[0].length).fill(81), heights = Array(cells.length).fill(21), measured = new Map();
		const tab = measure(' ') * 8;
		// Charts can extend beyond their anchor's row/column, so retain those anchors during scrolling.
		this.chartRows = new Set(); this.chartCols = new Set();
		cells.forEach((row, r) => row.forEach((cell, c) => {
			if (cell.value?.kind === 'chart') { this.chartRows.add(r); this.chartCols.add(c); return; }
			const text = cell.text;
			if (!text) return;
			const lines = text.split(/\r\n?|\n/);
			// white-space: pre does not create another line box after a final newline.
			const lineCount = lines.length - (lines.at(-1) === '' ? 1 : 0);
			heights[r] = Math.max(heights[r], lineCount * 18 + 5);
			for (const line of lines) {
				if (!measured.has(line)) {
					const width = line.includes('\t')
						? line.split('\t').reduce((width, part, i) => (i ? (Math.floor(width / tab) + 1) * tab : 0) + measure(part), 0) : measure(line);
					measured.set(line, Math.ceil(width) + 5);
				}
				widths[c] = Math.max(widths[c], measured.get(line));
			}
		}));
		this.rows = prefix(heights); this.cols = prefix(widths);
	}
	// First interval whose end is strictly beyond the coordinate (also handles exact boundaries).
	index(offsets, coordinate) {
		let low = 0, high = offsets.length - 2;
		while (low < high) {
			const mid = (low + high) >>> 1;
			if (offsets[mid + 1] <= coordinate) low = mid + 1; else high = mid;
		}
		return low;
	}
	segments(offsets, scroll, size, keep, overscan = 3) {
		const start = Math.max(0, this.index(offsets, scroll) - overscan);
		const end = Math.min(offsets.length - 2, this.index(offsets, scroll + size) + overscan);
		const indices = new Set(keep);
		for (let i = start; i <= end; i++) indices.add(i);
		const segments = []; let at = 0;
		const gap = end => {
			while (at < end) {
				const next = Math.min(end, at + 1000); // HTML table colspans cannot exceed 1000.
				segments.push({ index: at, count: next - at, size: offsets[next] - offsets[at], gap: true });
				at = next;
			}
		};
		for (const index of [...indices].sort((a, b) => a - b)) {
			gap(index);
			segments.push({ index, count: 1, size: offsets[index + 1] - offsets[index], gap: false });
			at = index + 1;
		}
		gap(offsets.length - 1);
		return segments;
	}
	cellRect(row, col) {
		if (row < 0 || col < 0 || row >= this.rows.length - 1 || col >= this.cols.length - 1) return null;
		return { top: this.header + this.rows[row], bottom: this.header + this.rows[row + 1],
			left: this.label * 2 + this.cols[col], right: this.label * 2 + this.cols[col + 1] };
	}
	visible(scrollTop, scrollLeft, height, width) {
		const fullyVisible = (offsets, scroll, size) => {
			let first = this.index(offsets, scroll), last = this.index(offsets, scroll + size);
			if (offsets[first] < scroll) first++;
			if (offsets[last + 1] > scroll + size) last--;
			first = Math.min(offsets.length - 2, first);
			return [first, Math.max(first, last)];
		};
		const [top, bottom] = fullyVisible(this.rows, scrollTop, height - this.header);
		const [left, right] = fullyVisible(this.cols, scrollLeft, width - this.label * 2);
		return { top, bottom, left, right };
	}
}
