// admin_auth.js — Cognito login + Identity Pool creds + SigV4 invoke
// FILL THESE VALUES:
export const CFG = {
  region: "us-east-1",
  userPoolId: "us-east-1_z2PiBuRMN",
  userPoolClientId: "7bdnatovge5jq5aos9vqtcha2b",
  userPoolDomain: "us-east-1z2piburmn.auth.us-east-1.amazoncognito.com",  

  loginRedirectUri:  window.location.origin + "/admin.html",
  logoutRedirectUri: window.location.origin
};


// --------------------

export let session = { idToken: null };

function parseHash() {
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const idToken = h.get("id_token");
  if (idToken) history.replaceState(null, "", window.location.pathname);
  return { idToken };
}

function loginUrl() {
  const p = new URL(`https://${CFG.userPoolDomain}/login`);
  p.searchParams.set("client_id", CFG.userPoolClientId);
  p.searchParams.set("response_type", "token");           // implicit flow
  p.searchParams.set("scope", "openid email profile");
  p.searchParams.set("redirect_uri", CFG.loginRedirectUri);
  return p.toString();
}

function logoutUrl() {
  const p = new URL(`https://${CFG.userPoolDomain}/logout`);
  p.searchParams.set("client_id", CFG.userPoolClientId);
  p.searchParams.set("logout_uri", CFG.logoutRedirectUri); // note: logout_uri
  return p.toString();
}

export async function ensureLogin() {
  const { idToken } = parseHash();
  if (idToken) {
    session.idToken = idToken;
    localStorage.setItem("cog_id_token", idToken);
  } else if (!session.idToken) {
    const cached = localStorage.getItem("cog_id_token");
    if (cached) session.idToken = cached;
  }
  if (!session.idToken) {
    window.location.href = loginUrl(); // redirect to Hosted UI
    return new Promise(() => {});      // halt until redirect returns
  }
  return session.idToken;
}

export function logout() {
  localStorage.removeItem("cog_id_token");
  window.location.href = logoutUrl();
}

// Optional convenience: set whoami text if element exists
export function setWhoFromToken() {
  try {
    if (!session.idToken) return;
    const who = JSON.parse(atob(session.idToken.split(".")[1]));
    const w = document.getElementById("whoami");
    if (w) w.textContent = who.email || who["cognito:username"] || "user";
  } catch {}
}

/*
// Optional UX: wire buttons if present
document.getElementById("btnLogin")?.addEventListener("click", () => ensureLogin());
document.getElementById("btnLogout")?.addEventListener("click", () => logout());

(async () => {
  try {
    const token = localStorage.getItem("cog_id_token");
    if (token) {
      session.idToken = token;
      const who = JSON.parse(atob(session.idToken.split(".")[1]));
      const w = document.getElementById("whoami"); if (w) w.textContent = who["email"] || who["cognito:username"] || "user";
    }
  } catch {}
})();
*/