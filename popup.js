import { DEFAULT_PORT_RANGES, scanPorts } from "./scanner.js";

const appList = document.getElementById("app-list");
const statusEl = document.getElementById("status");
const emptyEl = document.getElementById("empty");
const refreshBtn = document.getElementById("refresh-btn");
const settingsBtn = document.getElementById("settings-btn");
const settingsPanel = document.getElementById("settings-panel");
const portInput = document.getElementById("port-input");
const saveSettingsBtn = document.getElementById("save-settings");
const cancelSettingsBtn = document.getElementById("cancel-settings");
const searchBar = document.getElementById("search-bar");
const searchInput = document.getElementById("search-input");
const modifierHint = document.getElementById("modifier-hint");
const portColorList = document.getElementById("port-color-list");
const colorsTab = document.getElementById("colors-tab");

for (const tab of settingsPanel.querySelectorAll(".settings-tab")) {
	tab.addEventListener("click", () => {
		for (const t of settingsPanel.querySelectorAll(".settings-tab")) {
			t.classList.toggle("active", t === tab);
		}
		for (const panel of settingsPanel.querySelectorAll(".settings-tab-panel")) {
			panel.classList.toggle("hidden", panel.dataset.tab !== tab.dataset.tab);
		}
	});
}

const PALETTE = [
	"#ef4444",
	"#f97316",
	"#eab308",
	"#22c55e",
	"#06b6d4",
	"#3b82f6",
	"#a855f7",
	"#ec4899",
];

/** @type {Array<{port: number, url: string, title: string}>} */
let lastApps = [];

/** @type {Record<string, string>} port (string) → hex color */
let pendingPortColors = {};

const isMac = navigator.platform.toUpperCase().includes("MAC");
const kbd = document.createElement("kbd");
kbd.textContent = isMac ? "⌘" : "Ctrl";
modifierHint.append(kbd, " + click to open in new tab");

function isLocalhostUrl(url) {
	try {
		const parsed = new URL(url);
		return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
	} catch {
		return false;
	}
}

function openUrl(url, newTab) {
	if (!isLocalhostUrl(url)) return;
	if (newTab) {
		chrome.tabs.create({ url });
	} else {
		chrome.tabs.update({ url });
	}
}

/** @returns {Promise<string>} */
async function getPortConfig() {
	const result = await chrome.storage.sync.get({
		portConfig: DEFAULT_PORT_RANGES,
	});
	return result.portConfig;
}

/** @param {string} config */
async function savePortConfig(config) {
	await chrome.storage.sync.set({ portConfig: config });
}

/** @returns {Promise<Record<string, string>>} */
async function getPortColors() {
	const result = await chrome.storage.sync.get({ portColors: {} });
	return result.portColors;
}

/** @param {Record<string, string>} colors */
async function savePortColors(colors) {
	await chrome.storage.sync.set({ portColors: colors });
}

/**
 * Render the per-port color palette rows inside the settings panel.
 * @param {Array<{port: number}>} apps
 * @param {Record<string, string>} portColors
 */
function renderPortColorList(apps, portColors) {
	portColorList.innerHTML = "";
	if (apps.length === 0) return;

	const emptyHint = document.getElementById("port-colors-empty");
	if (emptyHint) emptyHint.classList.add("hidden");

	for (const app of apps) {
		const key = String(app.port);
		const li = document.createElement("li");
		li.className = "port-color-row";

		const label = document.createElement("span");
		label.className = "port-color-label";
		label.textContent = `:${app.port}`;
		li.appendChild(label);

		const palette = document.createElement("div");
		palette.className = "color-palette";

		for (const color of PALETTE) {
			const btn = document.createElement("button");
			btn.className = "swatch";
			btn.style.setProperty("--swatch-color", color);
			btn.title = color;
			if (pendingPortColors[key] === color) btn.classList.add("active");
			btn.addEventListener("click", () => {
				const isActive = btn.classList.contains("active");
				for (const s of palette.querySelectorAll(".swatch")) {
					s.classList.remove("active");
				}
				if (!isActive) {
					btn.classList.add("active");
					pendingPortColors[key] = color;
				} else {
					delete pendingPortColors[key];
				}
			});
			palette.appendChild(btn);
		}

		li.appendChild(palette);
		portColorList.appendChild(li);
	}
}

function getVisibleItems() {
	return [...appList.querySelectorAll("li:not(.hidden)")];
}

function updateSelection(index) {
	const visible = getVisibleItems();
	for (const li of appList.querySelectorAll("li")) {
		li.classList.remove("selected");
	}
	if (visible.length === 0) {
		selectedIndex = -1;
		return;
	}
	selectedIndex = Math.max(0, Math.min(index, visible.length - 1));
	visible[selectedIndex].classList.add("selected");
	visible[selectedIndex].scrollIntoView({ block: "nearest" });
}

let selectedIndex = 0;

function filterApps() {
	const query = searchInput.value.toLowerCase();
	const items = appList.querySelectorAll("li");
	let visible = 0;

	for (const li of items) {
		const title = li.querySelector(".app-title").textContent.toLowerCase();
		const url = li.querySelector(".app-url").textContent.toLowerCase();
		const match = title.includes(query) || url.includes(query);
		li.classList.toggle("hidden", !match);
		if (match) visible++;
	}

	emptyEl.classList.toggle("hidden", visible > 0);
	if (visible === 0) {
		emptyEl.textContent = "No matching apps.";
	} else {
		emptyEl.textContent = "No running apps found.";
	}

	updateSelection(0);
}

searchInput.addEventListener("input", filterApps);

searchInput.addEventListener("keydown", (e) => {
	const visible = getVisibleItems();
	if (e.key === "ArrowDown") {
		e.preventDefault();
		updateSelection(selectedIndex + 1);
		return;
	}
	if (e.key === "ArrowUp") {
		e.preventDefault();
		updateSelection(selectedIndex - 1);
		return;
	}
	if (e.key !== "Enter") return;
	const selected = visible[selectedIndex];
	if (!selected) return;
	openUrl(selected.dataset.url, e.metaKey || e.ctrlKey);
});

/**
 * Create a list item element for a found app.
 * Static port color (if any) is applied immediately; duplicate-title auto-hue
 * is applied after the full scan in refresh().
 * @param {{ port: number, url: string, title: string, debug?: any }} app
 * @param {Record<string, string>} portColors
 */
function createAppItem(app, portColors) {
	const li = document.createElement("li");

	li.innerHTML = `
      <span class="app-dot"></span>
      <div class="app-info">
        <div class="app-title"></div>
        <div class="app-url"></div>
      </div>
      <button class="app-open">Open</button>
    `;

	// Build debug tooltip text
	const debugLines = [];
	if (app.debug?.source) debugLines.push(`Source: ${app.debug.source}`);
	if (app.debug?.redirectChain)
		debugLines.push(`Redirects: ${app.debug.redirectChain}`);
	if (app.debug?.tried?.length)
		debugLines.push(`Tried: ${app.debug.tried.join(", ")}`);
	const debugText = debugLines.join("\n");

	// Apply static port color immediately if configured
	const staticColor = portColors[String(app.port)];
	if (staticColor) {
		li.style.setProperty("--port-color", staticColor);
		li.classList.add("duplicate-title");
	}

	// Set text content safely (no innerHTML injection)
	li.dataset.url = app.url;
	const titleEl = li.querySelector(".app-title");
	titleEl.textContent = app.title;
	if (debugText) titleEl.title = debugText;
	li.querySelector(".app-url").textContent = app.url;
	li.querySelector(".app-open").addEventListener("click", (e) => {
		openUrl(app.url, e.metaKey || e.ctrlKey);
	});

	return li;
}

async function refresh() {
	refreshBtn.classList.add("spinning");
	statusEl.textContent = "Scanning ports…";
	statusEl.classList.remove("hidden");
	emptyEl.classList.add("hidden");
	searchBar.classList.add("hidden");
	searchInput.value = "";
	appList.innerHTML = "";

	const [portConfig, portColors] = await Promise.all([
		getPortConfig(),
		getPortColors(),
	]);

	const apps = await scanPorts(portConfig, (app) => {
		if (appList.children.length === 0) {
			searchBar.classList.remove("hidden");
			searchInput.focus();
		}
		const li = createAppItem(app, portColors);
		// Apply current search filter to the new item
		const query = searchInput.value.toLowerCase();
		if (query) {
			const match =
				app.title.toLowerCase().includes(query) ||
				app.url.toLowerCase().includes(query);
			li.classList.toggle("hidden", !match);
		}
		// Insert in port-number order
		const after = [...appList.querySelectorAll("li")].find(
			(el) => Number(new URL(el.dataset.url).port) > app.port,
		);
		if (after) {
			appList.insertBefore(li, after);
		} else {
			appList.appendChild(li);
		}
		updateSelection(selectedIndex);
	});

	lastApps = apps;

	refreshBtn.classList.remove("spinning");
	statusEl.classList.add("hidden");

	if (apps.length === 0) {
		emptyEl.textContent = "No running apps found.";
		emptyEl.classList.remove("hidden");
		return;
	}

	// Apply auto-hue for duplicate titles now that all results are known
	const titleCounts = new Map();
	for (const app of apps) {
		titleCounts.set(app.title, (titleCounts.get(app.title) ?? 0) + 1);
	}
	for (const li of appList.querySelectorAll("li")) {
		const app = apps.find((a) => a.url === li.dataset.url);
		if (
			app &&
			!portColors[String(app.port)] &&
			titleCounts.get(app.title) > 1
		) {
			const hue = Math.round((app.port * 137) % 360);
			li.style.setProperty("--port-color", `hsl(${hue}, 70%, 45%)`);
			li.classList.add("duplicate-title");
		}
	}
}

// Settings panel
settingsBtn.addEventListener("click", async () => {
	const [config, portColors] = await Promise.all([
		getPortConfig(),
		getPortColors(),
	]);
	portInput.value = config;
	pendingPortColors = { ...portColors };
	renderPortColorList(lastApps, pendingPortColors);
	// Reset to first tab each time settings opens
	for (const t of settingsPanel.querySelectorAll(".settings-tab")) {
		t.classList.toggle("active", t.dataset.tab === "ranges");
	}
	for (const p of settingsPanel.querySelectorAll(".settings-tab-panel")) {
		p.classList.toggle("hidden", p.dataset.tab !== "ranges");
	}
	settingsPanel.classList.toggle("hidden");
});

cancelSettingsBtn.addEventListener("click", () => {
	settingsPanel.classList.add("hidden");
});

saveSettingsBtn.addEventListener("click", async () => {
	await Promise.all([
		savePortConfig(portInput.value),
		savePortColors(pendingPortColors),
	]);
	settingsPanel.classList.add("hidden");
	refresh();
});

refreshBtn.addEventListener("click", refresh);

function setModifierHeld(held) {
	for (const btn of document.querySelectorAll(".app-open")) {
		btn.classList.toggle("modifier-held", held);
	}
}

window.addEventListener("keydown", (e) => {
	if (e.key === "Meta" || e.key === "Control") setModifierHeld(true);
});

window.addEventListener("keyup", (e) => {
	if (e.key === "Meta" || e.key === "Control") setModifierHeld(false);
});

window.addEventListener("blur", () => setModifierHeld(false));

// Initial scan
refresh();
