// Video Blocker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "callAPI") {
    fetch(
      "https://asia-south1-adverse-436618.cloudfunctions.net/shutthefupp/api/get/category",
      // "http://localhost:80/api/get/category",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.data),
      }
    )
      .then((res) => res.json())
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // keep response channel open for async sendResponse
  }

  // TODO: New api to save channel names (used for searched page)
  else if (request.action === "processChannels") {
    fetch(
      "https://asia-south1-adverse-436618.cloudfunctions.net/shutthefupp/api/post/channels",
      // "http://localhost:80/api/post/channels",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.data),
      }
    )
      .then((res) => res.json())
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });

    return true;
  }
});
