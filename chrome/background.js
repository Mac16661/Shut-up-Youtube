chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log(
    "Background received message:#####################################################",
    request
  );
  if (request.action === "callAPI") {
    fetch(
      "https://asia-south1-adverse-436618.cloudfunctions.net/shutthefupp/api/get/category",
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
});
