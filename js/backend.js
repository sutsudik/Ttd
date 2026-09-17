/* Central backend adapter — Google Apps Script Web App */
(function (global) {
  "use strict";

  var CONFIG = {
    // Setelah deploy Google Apps Script sebagai Web App, isi URL /exec di bawah.
    API_ENDPOINT: "PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE"
  };

  function getVisitorId() {
    var key = "unduhin_visitor_id_v1";
    try {
      var id = localStorage.getItem(key);
      if (!id) {
        id = (crypto && crypto.randomUUID) ? crypto.randomUUID() :
          "v_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
        localStorage.setItem(key, id);
      }
      return id;
    } catch (e) {
      return "ephemeral_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
    }
  }

  function configured() {
    return CONFIG.API_ENDPOINT && CONFIG.API_ENDPOINT.indexOf("PASTE_YOUR_") !== 0;
  }

  async function request(payload) {
    if (!configured()) throw new Error("BACKEND_NOT_CONFIGURED");
    var body = Object.assign({}, payload, { visitorId: getVisitorId() });
    var response = await fetch(CONFIG.API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      redirect: "follow"
    });
    if (!response.ok) throw new Error("BACKEND_HTTP_" + response.status);
    return response.json();
  }

  function fire(payload) {
    if (!configured()) return Promise.resolve(null);
    return request(payload).catch(function () { return null; });
  }

  global.UnduhinBackend = {
    CONFIG: CONFIG,
    getVisitorId: getVisitorId,
    request: request,
    fire: fire,
    isConfigured: configured
  };
})(window);
