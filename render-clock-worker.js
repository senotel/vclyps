/* One outstanding tick maximum. A suspended page must not accumulate frame messages. */
"use strict";
let timer;
self.onmessage = (event) => {
  clearTimeout(timer);
  if (event.data === "start") self.postMessage("ready");
  if (event.data === "next") timer = setTimeout(() => self.postMessage("tick"), 1000 / 30);
};
