const checkbox = document.getElementById("toggleBlock");

// Load stored toggle state
chrome.storage.sync.get({ blockEnabled: true }, data => {
  checkbox.checked = data.blockEnabled;
});

// Save when user toggles
checkbox.addEventListener("change", () => {
  chrome.storage.sync.set({ blockEnabled: checkbox.checked });
});
