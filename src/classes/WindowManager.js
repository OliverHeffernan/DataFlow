import { shallowReactive } from 'vue';

// Windows are session views, not workbook data. A leaf shares its sheet's data but owns its cursor,
// keyboard and scroll position; a branch describes a real left/right or top/bottom split.
export default class WindowManager {
	constructor(sheet) {
		this.nextId = 1;
		const first = this.createWindow(sheet);
		this.state = shallowReactive({ root: first, activeId: first.id });
	}

	createWindow(sheet, source = null) {
		return shallowReactive({
			id: this.nextId++, type: 'window', content: source?.content ?? 'sheet', sheet,
			row: source?.row ?? sheet.selRow ?? 0, col: source?.col ?? sheet.selCol ?? 0,
			scrollTop: source?.scrollTop ?? 0, scrollLeft: source?.scrollLeft ?? 0,
			keyboard: null, rules: null,
		});
	}

	get windows() {
		const leaves = node => node.type === 'window' ? [node] : [...leaves(node.first), ...leaves(node.second)];
		return leaves(this.state.root);
	}
	get active() { return this.windows.find(window => window.id === this.state.activeId); }

	update(id, transform) {
		const visit = node => node.id === id ? transform(node) : node.type === 'window' ? node
			: { ...node, first: visit(node.first), second: visit(node.second) };
		this.state.root = visit(this.state.root);
	}

	split(axis) {
		if (!['vertical', 'horizontal'].includes(axis)) throw new Error('Invalid split direction');
		const before = this.active, next = this.createWindow(before.sheet, before);
		// Drafts and editor sessions are never shared by a split.
		this.update(before.id, first => ({ id: this.nextId++, type: 'split', axis, ratio: 0.5, first, second: next }));
		this.state.activeId = next.id;
		return next;
	}

	focus(id) {
		if (!this.windows.some(window => window.id === id)) return false;
		this.state.activeId = id;
		return true;
	}

	rectangles() {
		const result = new Map();
		const visit = (node, x, y, width, height) => {
			if (node.type === 'window') { result.set(node.id, { x, y, width, height }); return; }
			const vertical = node.axis === 'vertical', w = vertical ? width * node.ratio : width, h = vertical ? height : height * node.ratio;
			visit(node.first, x, y, w, h);
			visit(node.second, vertical ? x + w : x, vertical ? y : y + h, vertical ? width - w : width, vertical ? height : height - h);
		};
		visit(this.state.root, 0, 0, 1, 1);
		return result;
	}

	// Pane lifetime is independent of the split tree: the renderer keeps a flat keyed list.
	layout(width, height) {
		const windows = [], separators = [];
		const visit = (node, x, y, width, height) => {
			if (node.type === 'window') { windows.push({ node, x, y, width, height }); return; }
			const vertical = node.axis === 'vertical', gap = Math.min(5, vertical ? width : height);
			const first = Math.max(0, (vertical ? width : height) - gap) * node.ratio;
			separators.push({ node, x: vertical ? x + first : x, y: vertical ? y : y + first,
				width: vertical ? gap : width, height: vertical ? height : gap, bounds: { x, y, width, height } });
			visit(node.first, x, y, vertical ? first : width, vertical ? height : first);
			visit(node.second, vertical ? x + first + gap : x, vertical ? y : y + first + gap,
				vertical ? width - first - gap : width, vertical ? height : height - first - gap);
		};
		visit(this.state.root, 0, 0, width, height);
		return { windows, separators };
	}

	neighbor(direction) {
		if (!'hjkl'.includes(direction) || direction.length !== 1) return null;
		const rectangles = this.rectangles(), from = rectangles.get(this.state.activeId), horizontal = 'hl'.includes(direction), forward = 'jl'.includes(direction);
		const axis = horizontal ? 'x' : 'y', size = horizontal ? 'width' : 'height', other = horizontal ? 'y' : 'x', span = horizontal ? 'height' : 'width';
		const candidates = [];
		for (const [id, rect] of rectangles) {
			if (id === this.state.activeId) continue;
			const gap = forward ? rect[axis] - from[axis] - from[size] : from[axis] - rect[axis] - rect[size];
			if (gap < -1e-9) continue;
			const overlap = Math.min(from[other] + from[span], rect[other] + rect[span]) - Math.max(from[other], rect[other]);
			const cross = Math.abs(rect[other] + rect[span] / 2 - from[other] - from[span] / 2);
			candidates.push({ id, gap: Math.max(0, gap), overlap: overlap > 1e-9, cross });
		}
		candidates.sort((a, b) => Number(b.overlap) - Number(a.overlap) || a.gap - b.gap || a.cross - b.cross || a.id - b.id);
		return candidates[0]?.id ?? null;
	}

	resize(id, ratio) {
		if (!Number.isFinite(ratio)) return;
		this.update(id, node => node.type === 'split' ? { ...node, ratio: Math.max(0.15, Math.min(0.85, ratio)) } : node);
	}

	close() {
		if (this.windows.length === 1) throw new Error('Cannot close the last window');
		const id = this.state.activeId;
		const next = this.neighbor('h') ?? this.neighbor('k') ?? this.neighbor('l') ?? this.neighbor('j');
		const remove = node => {
			if (node.type === 'window') return node;
			if (node.first.id === id) return node.second;
			if (node.second.id === id) return node.first;
			return { ...node, first: remove(node.first), second: remove(node.second) };
		};
		this.state.root = remove(this.state.root);
		this.state.activeId = next;
		return this.active;
	}

	reconcile(sheets) {
		for (const window of this.windows) {
			if (!sheets.includes(window.sheet)) window.sheet = sheets.find(sheet => sheet.name === window.sheet.name) ?? sheets[0];
			window.row = Math.min(window.row, window.sheet.rows.length - 1);
			window.col = Math.min(window.col, window.sheet.rows[0].length - 1);
		}
	}
}
