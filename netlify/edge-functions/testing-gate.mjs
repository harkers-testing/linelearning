// netlify/edge-functions/testing-gate.mjs
//
// TEMPORARY, TESTING-ONLY ACCESS GATE — added 2026-10-01 at Andy's request.
//
// Why this exists: real cast members will always sign in through the
// app's own email-link sign-in (handled by Supabase) — that is, and
// stays, the actual privacy boundary; this file doesn't change that at
// all. But while Andy is still testing solo (e.g. using a second email
// address to stand in for a scene partner), he didn't want the whole
// site sitting wide open to anyone on the internet, and doesn't have a
// paid Netlify plan (which is what Netlify's own built-in "password
// protection" feature requires).
//
// This is a stopgap: it puts ONE shared password in front of the ENTIRE
// site — before the app's own sign-in page even loads — checked by
// Netlify's own servers (not by anything in the browser, so it can't be
// bypassed by looking at the page's source code, unlike a password typed
// into a web form). Visiting the site will pop up the browser's own
// built-in login box asking for a username and password; Andy tells
// whoever is testing what those two values are.
//
// REMOVE BEFORE GOING LIVE FOR REAL: delete this whole
// `netlify/edge-functions` folder (and this file with it) before ever
// sending a real cast member their invite link. See CLAUDE.md's
// "Deployment" section for the full note.

const USERNAME = "cast";
const PASSWORD = "CHANGE-ME-tlt2026"; // change this to whatever you like

export default async (request, context) => {
  const expected = "Basic " + btoa(`${USERNAME}:${PASSWORD}`);
  const provided = request.headers.get("authorization");

  if (provided !== expected) {
    return new Response("Authentication required.", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Line Learning - testing only"',
      },
    });
  }

  return context.next();
};

export const config = { path: "/*" };
