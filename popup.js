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

async function refresh() {
	refreshBtn.classList.add("spinning");
	statusEl.textContent = "Scanning ports…";
	statusEl.classList.remove("hidden");
	emptyEl.classList.add("hidden");
	searchBar.classList.add("hidden");
	searchInput.value = "";
	appList.innerHTML = "";

	const portConfig = await getPortConfig();
	const apps = await scanPorts(portConfig);

	refreshBtn.classList.remove("spinning");
	statusEl.classList.add("hidden");

	if (apps.length === 0) {
		emptyEl.textContent = "No running apps found.";
		emptyEl.classList.remove("hidden");
		return;
	}

	searchBar.classList.remove("hidden");
	searchInput.focus();
	updateSelection(0);

	for (const app of apps) {
		const li = document.createElement("li");

		li.innerHTML = `
      <span class="app-dot"></span>
      <div class="app-info">
        <div class="app-title"></div>
        <div class="app-url"></div>
      </div>
      <button class="app-open">Open</button>
    `;

		// Set text content safely (no innerHTML injection)
		li.dataset.url = app.url;
		li.querySelector(".app-title").textContent = app.title;
		li.querySelector(".app-url").textContent = app.url;
		li.querySelector(".app-open").addEventListener("click", (e) => {
			openUrl(app.url, e.metaKey || e.ctrlKey);
		});

		appList.appendChild(li);
	}
}

// Settings panel
settingsBtn.addEventListener("click", async () => {
	const config = await getPortConfig();
	portInput.value = config;
	settingsPanel.classList.toggle("hidden");
});

cancelSettingsBtn.addEventListener("click", () => {
	settingsPanel.classList.add("hidden");
});

saveSettingsBtn.addEventListener("click", async () => {
	await savePortConfig(portInput.value);
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
