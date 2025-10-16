const globalToggle = document.getElementById("toggleBlock");
const categoryToggles = document.querySelectorAll(".category-toggle");

// Default data
let allowedCategories = [];

// Load stored data
chrome.storage.sync.get({ allowedCategories: [] }, (data) => {
  allowedCategories = data.allowedCategories || [];

  categoryToggles.forEach((cb) => {
    const cat = parseInt(cb.dataset.category, 10);
    cb.checked = allowedCategories.includes(cat);
  });
});

// Load global toggle state
chrome.storage.sync.get({ blockEnabled: true }, (data) => {
  globalToggle.checked = data.blockEnabled;
});

// Global enable/disable switch
globalToggle.addEventListener("change", () => {
  chrome.storage.sync.set({ blockEnabled: globalToggle.checked });
});

// Category checkboxes
categoryToggles.forEach((cb) => {
  cb.addEventListener("change", () => {
    const cat = parseInt(cb.dataset.category, 10);
    const category = cat;

    if (cb.checked) {
      if (!allowedCategories.includes(category))
        allowedCategories.push(category);
    } else {
      allowedCategories = allowedCategories.filter((c) => c !== category);
    }

    // Save updated list
    chrome.storage.sync.set({ allowedCategories });
  });
});

