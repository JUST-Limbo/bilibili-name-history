// 高频脉冲；实际翻页间隔由 service worker 按高速/低速节流
setInterval(() => {
  chrome.runtime.sendMessage({ type: 'AUTO_PAGE_PULSE' }).catch(() => {});
}, 500);
