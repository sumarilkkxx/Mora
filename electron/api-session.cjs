/** Restrict credentials to this app window and this server's API URLs. */
function installApiCredentials(window, origin, token) {
  window.webContents.session.webRequest.onBeforeSendHeaders({ urls: [origin + "/api/*"] }, (details, callback) => {
    if (!window.isDestroyed() && details.webContentsId === window.webContents.id) details.requestHeaders["x-mora-token"] = token;
    callback({ requestHeaders: details.requestHeaders });
  });
}
module.exports = { installApiCredentials };
