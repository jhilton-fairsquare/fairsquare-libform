// lib/utils/querystring.js
// Utility that grabs querystring parameters

const urlParams = new URLSearchParams(window.location.search);

export const querystring = {
  get(name) {
    const qval = urlParams.get(name);
    console.log(qval);
  }
}
