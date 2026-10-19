<template>
	<span class="chart-frame" :style="frameStyle">
		<svg
			class="chart"
			:width="chart.width" :height="chart.height"
			:viewBox="`0 0 ${layout.width} ${layout.height}`"
			role="img" :aria-label="chart.title || `${chart.type} chart`"
		>
			<title>{{ chart.title || `${chart.type} chart` }}</title>
			<desc>{{ description }}</desc>
			<rect class="background" x="0.5" y="0.5" :width="layout.width - 1" :height="layout.height - 1" rx="5" />
			<text v-if="chart.title" class="heading" x="14" y="22">{{ shorten(chart.title, (layout.width - 28) / 7) }}</text>
			<g v-for="(series, i) in chart.series" :key="i" :transform="`translate(${layout.left + (i % layout.legendCols) * layout.legendWidth}, ${layout.legendTop + Math.floor(i / layout.legendCols) * 17})`">
				<rect x="0" y="-7" width="8" height="8" rx="2" :fill="color(i)" />
				<text x="13" y="0">{{ shorten(series.name, (layout.legendWidth - 20) / 6) }}</text>
			</g>
			<g v-for="tick in layout.yTicks" :key="tick.value">
				<line class="grid" :x1="layout.left" :x2="layout.right" :y1="tick.y" :y2="tick.y" />
				<text :x="layout.left - 8" :y="tick.y + 4" text-anchor="end">{{ format(tick.value) }}</text>
			</g>
			<line class="axis" :x1="layout.left" :x2="layout.right" :y1="layout.zero" :y2="layout.zero" />
			<g v-for="(series, i) in layout.series" :key="i" :fill="color(i)">
				<path v-if="chart.type === 'line'" class="series-line" :d="series.path" :stroke="color(i)" fill="none" />
				<template v-for="(point, j) in series.points" :key="j">
					<rect v-if="point && chart.type === 'bar'" class="bar"
						:x="point.x - layout.groupWidth / 2 + i * layout.barWidth" :y="Math.min(point.y, layout.zero)"
						:width="layout.barWidth * 0.9" :height="Math.abs(point.y - layout.zero)"
					><title>{{ series.name }} · {{ point.label }}: {{ point.value }}</title></rect>
					<circle v-else-if="point" class="point" :cx="point.x" :cy="point.y" :r="chart.type === 'scatter' ? 3.5 : 2.5">
						<title>{{ series.name }} · {{ point.label }}: {{ point.value }}</title>
					</circle>
				</template>
			</g>
			<text v-for="tick in layout.xTicks" :key="tick.index" :x="tick.x" :y="layout.bottom + 18" text-anchor="middle">
				{{ shorten(tick.label, layout.tickWidth / 6) }}
			</text>
			<text v-if="chart.xLabel" :x="(layout.left + layout.right) / 2" :y="layout.height - 10" text-anchor="middle">{{ shorten(chart.xLabel, (layout.right - layout.left) / 6) }}</text>
			<text v-if="chart.yLabel" :transform="`translate(14 ${(layout.top + layout.bottom) / 2}) rotate(-90)`" text-anchor="middle">{{ shorten(chart.yLabel, (layout.bottom - layout.top) / 6) }}</text>
			<text v-if="layout.empty" :x="(layout.left + layout.right) / 2" :y="(layout.top + layout.bottom) / 2" text-anchor="middle">No data</text>
		</svg>
	</span>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({ chart: { type: Object, required: true } });
const colors = ["#77f1fc", "#42ffad", "#fc996f", "#9a7dff", "#f0e67f", "#e879b0"];
const color = i => colors[i % colors.length];
const shorten = (value, length) => {
	const text = String(value);
	const max = Math.max(1, Math.floor(length));
	return text.length > max ? text.slice(0, max - 1) + "…" : text;
};
const format = value => Number(value.toPrecision(3)).toString();
const frameStyle = computed(() => ({
	width: `${props.chart.width}px`, height: `${props.chart.height}px`,
	left: `${props.chart.position.x}px`, top: `${props.chart.position.y}px`,
}));
const description = computed(() => props.chart.series.map(series =>
	`${series.name}: ${series.values.map((value, i) => `${props.chart.x[i]}: ${value ?? "blank"}`).join(", ")}`
).join("; "));

const layout = computed(() => {
	const chart = props.chart;
	const width = Math.max(240, chart.width);
	const legendCols = Math.max(1, Math.floor((width - 68) / 110));
	const legendWidth = (width - 68) / legendCols;
	const legendTop = chart.title ? 42 : 23;
	const top = legendTop + Math.ceil(chart.series.length / legendCols) * 17 + 6;
	const height = Math.max(chart.height, top + 110);
	const left = chart.yLabel ? 64 : 48;
	const right = width - 22;
	const bottom = height - (chart.xLabel ? 48 : 30);
	const values = chart.series.flatMap(series => series.values).filter(value => value !== null);
	// Normalize before subtracting so finite, very large values do not overflow the scale.
	const magnitude = Math.max(1, ...values.map(Math.abs));
	const low = Math.min(0, ...values.map(value => value / magnitude));
	let high = Math.max(0, ...values.map(value => value / magnitude));
	if (low === high) high = low + 1;
	const y = value => bottom - (value / magnitude - low) / (high - low) * (bottom - top);
	const count = chart.x.length;
	const xMagnitude = Math.max(1, ...chart.x.filter(value => typeof value === "number").map(Math.abs));
	const xLow = Math.min(...chart.x.map(value => Number(value) / xMagnitude));
	const xHigh = Math.max(...chart.x.map(value => Number(value) / xMagnitude));
	const x = i => chart.type === "scatter"
		? (xLow === xHigh ? (left + right) / 2 : left + (chart.x[i] / xMagnitude - xLow) / (xHigh - xLow) * (right - left))
		: chart.type === "bar" ? left + (i + 0.5) / count * (right - left)
		: count === 1 ? (left + right) / 2 : left + i / (count - 1) * (right - left);
	const tickSpacing = chart.type === "scatter" ? 65
		: Math.max(35, Math.min(90, Math.max(...chart.x.map(value => String(value).length)) * 6 + 12));
	const tickCount = Math.min(count, Math.max(2, Math.floor((right - left) / tickSpacing)));
	const xTicks = Array.from({ length: tickCount }, (_, i) => {
		if (chart.type === "scatter") {
			const fraction = tickCount === 1 ? 0.5 : i / (tickCount - 1);
			return { index: i, x: left + fraction * (right - left), label: format((xLow * (1 - fraction) + xHigh * fraction) * xMagnitude) };
		}
		const index = tickCount === 1 ? 0 : Math.round(i * (count - 1) / (tickCount - 1));
		return { index, x: x(index), label: chart.x[index] };
	});
	const yTicks = Array.from({ length: 5 }, (_, i) => {
		const value = (low * (1 - i / 4) + high * i / 4) * magnitude;
		return { value, y: y(value) };
	});
	const series = chart.series.map(series => {
		const points = series.values.map((value, i) => value === null ? null : { x: x(i), y: y(value), value, label: chart.x[i] });
		let path = "";
		let connected = false;
		for (const point of points) {
			if (point) path += `${connected ? "L" : "M"}${point.x},${point.y} `;
			connected = point !== null;
		}
		return { name: series.name, points, path };
	});
	const groupWidth = (right - left) / count * 0.72;
	return { width, height, left, right, top, bottom, legendCols, legendWidth, legendTop,
		xTicks, yTicks, series, zero: y(0), groupWidth, barWidth: groupWidth / series.length,
		tickWidth: (right - left) / Math.max(1, tickCount - 1), empty: values.length === 0 };
});
</script>

<style scoped>
.chart-frame { position: absolute; z-index: 2; display: block; }
.focussed > .chart-frame { outline: 2px solid white; outline-offset: -2px; }
.chart { display: block; overflow: hidden; font: 10px ui-monospace, monospace; }
.background { fill: #0d1925; stroke: #253847; }
text { fill: #a5bacb; }
.heading { fill: #ecf7ff; font-size: 13px; font-weight: 600; }
.grid { stroke: #253847; stroke-width: 0.75; }
.axis { stroke: #688294; stroke-width: 1; }
.series-line { stroke-width: 2; stroke-linejoin: round; }
</style>
