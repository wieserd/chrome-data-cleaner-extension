let currentUrl = null;
let currentHostname = null;
let currentOrigin = null;

const domainLabel = document.getElementById('domain-label');
const statusMsg = document.getElementById('status-msg');

// Global clear elements
const timeRangeSelect = document.getElementById('time-range-select');
const checkCookies = document.getElementById('check-cookies');
const checkCache = document.getElementById('check-cache');
const checkHistory = document.getElementById('check-history');
const clearGlobalBtn = document.getElementById('clear-global-btn');

// Active site elements
const clearAllDataBtn = document.getElementById('clear-all-data-btn');
const clearAllCookiesBtn = document.getElementById('clear-all-cookies-btn');

// Cookie inspection elements
const refreshBtn = document.getElementById('refresh-btn');
const cookieCount = document.getElementById('cookie-count');
const cookieList = document.getElementById('cookie-list');
const addForm = document.getElementById('add-cookie-form');
const nameInput = document.getElementById('cookie-name');
const valueInput = document.getElementById('cookie-value');

function showStatus(text, isError = false) {
  statusMsg.textContent = text;
  statusMsg.style.color = isError ? '#ef4444' : '#10b981';
  setTimeout(() => {
    statusMsg.textContent = '';
  }, 4000);
}

function getCookieUrl(cookie) {
  const protocol = cookie.secure ? 'https://' : 'http://';
  const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
  return `${protocol}${domain}${cookie.path || '/'}`;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length === 0 || !tabs[0].url) {
    domainLabel.textContent = 'No active webpage found.';
    return null;
  }
  return tabs[0];
}

// ----------------------------------------------------
// Global Clear (All Websites - e.g., Last 15 minutes)
// ----------------------------------------------------
async function clearGlobalBrowsingData() {
  if (!chrome.browsingData || typeof chrome.browsingData.remove !== 'function') {
    showStatus('Please reload the extension in chrome://extensions to grant permissions.', true);
    return;
  }

  const minutes = parseInt(timeRangeSelect.value, 10);
  const since = minutes === 0 ? 0 : Date.now() - (minutes * 60 * 1000);

  const wantsCookies = checkCookies.checked;
  const wantsCache = checkCache.checked;
  const wantsHistory = checkHistory.checked;

  if (!wantsCookies && !wantsCache && !wantsHistory) {
    showStatus('Please select at least one data type to clear.', true);
    return;
  }

  const dataToRemove = {
    cookies: wantsCookies,
    localStorage: wantsCookies,
    indexedDB: wantsCookies,
    serviceWorkers: wantsCookies,
    webSQL: wantsCookies,
    fileSystems: wantsCookies,
    cache: wantsCache,
    cacheStorage: wantsCache,
    history: wantsHistory
  };

  try {
    showStatus('Clearing data across all websites...');
    clearGlobalBtn.disabled = true;

    // Notice no "origins" -> removes data across all websites
    await chrome.browsingData.remove({ since }, dataToRemove);

    const timeLabel = minutes === 0 ? 'all time' : `last ${minutes} minutes`;
    showStatus(`Cleared data across all websites (${timeLabel})!`);

    await loadCookies();
  } catch (err) {
    showStatus('Failed to clear: ' + err.message, true);
  } finally {
    clearGlobalBtn.disabled = false;
  }
}

// ----------------------------------------------------
// Active Site Only Clear
// ----------------------------------------------------
async function clearAllSiteData() {
  const tab = await getActiveTab();
  if (!tab || !tab.id) return;

  try {
    showStatus('Wiping current site data...');

    // 1. In-page storage wipe
    if (chrome.scripting && chrome.scripting.executeScript) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            try { localStorage.clear(); } catch (_) {}
            try { sessionStorage.clear(); } catch (_) {}
            try {
              if (window.indexedDB && window.indexedDB.databases) {
                window.indexedDB.databases().then((dbs) => {
                  for (const db of dbs) {
                    if (db.name) window.indexedDB.deleteDatabase(db.name);
                  }
                });
              }
            } catch (_) {}
          }
        });
      } catch (err) {
        console.warn('Script execution notice:', err);
      }
    }

    // 2. Browser-level wipe for this origin
    if (chrome.browsingData && typeof chrome.browsingData.remove === 'function' && currentOrigin) {
      try {
        await chrome.browsingData.remove(
          { origins: [currentOrigin] },
          {
            cache: true,
            cookies: true,
            fileSystems: true,
            indexedDB: true,
            localStorage: true,
            serviceWorkers: true,
            webSQL: true
          }
        );
      } catch (err) {
        console.warn('browsingData origin notice:', err);
      }
    }

    // 3. Clear all matching domain cookies
    await clearAllCookies();

    showStatus('Current site storage, cache, & cookies wiped!');
  } catch (err) {
    showStatus('Error wiping site data: ' + err.message, true);
  }
}

// ----------------------------------------------------
// Cookie Management
// ----------------------------------------------------
async function loadCookies() {
  cookieList.innerHTML = '';
  if (!currentHostname) return;

  try {
    const cookies = await chrome.cookies.getAll({ domain: currentHostname });
    cookieCount.textContent = cookies.length;

    if (cookies.length === 0) {
      const li = document.createElement('li');
      li.className = 'cookie-item';
      li.style.justifyContent = 'center';
      li.style.color = '#6c757d';
      li.textContent = 'No cookies found for this site.';
      cookieList.appendChild(li);
      return;
    }

    cookies.forEach((cookie) => {
      const li = document.createElement('li');
      li.className = 'cookie-item';

      const infoDiv = document.createElement('div');
      infoDiv.className = 'cookie-info';

      const nameSpan = document.createElement('div');
      nameSpan.className = 'cookie-name';
      nameSpan.textContent = cookie.name;

      const valSpan = document.createElement('div');
      valSpan.className = 'cookie-val';
      valSpan.textContent = cookie.value;

      infoDiv.appendChild(nameSpan);
      infoDiv.appendChild(valSpan);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-delete-cookie';
      deleteBtn.title = 'Delete this cookie';
      deleteBtn.innerHTML = '&times;';
      deleteBtn.addEventListener('click', async () => {
        await deleteSingleCookie(cookie);
      });

      li.appendChild(infoDiv);
      li.appendChild(deleteBtn);
      cookieList.appendChild(li);
    });
  } catch (err) {
    showStatus('Error loading cookies: ' + err.message, true);
  }
}

async function deleteSingleCookie(cookie) {
  try {
    const targetUrl = getCookieUrl(cookie);
    await chrome.cookies.remove({
      url: targetUrl,
      name: cookie.name,
      storeId: cookie.storeId
    });
    showStatus(`Deleted "${cookie.name}"`);
    await loadCookies();
  } catch (err) {
    showStatus('Failed to delete: ' + err.message, true);
  }
}

async function clearAllCookies() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: currentHostname });
    let removedCount = 0;
    for (const cookie of cookies) {
      const targetUrl = getCookieUrl(cookie);
      await chrome.cookies.remove({
        url: targetUrl,
        name: cookie.name,
        storeId: cookie.storeId
      });
      removedCount++;
    }
    showStatus(`Cleared ${removedCount} cookies.`);
    await loadCookies();
  } catch (err) {
    showStatus('Error clearing cookies: ' + err.message, true);
  }
}

async function addCookie(e) {
  e.preventDefault();
  const name = nameInput.value.trim();
  const value = valueInput.value.trim();

  if (!name || !currentUrl) return;

  try {
    await chrome.cookies.set({
      url: currentUrl,
      name: name,
      value: value
    });
    nameInput.value = '';
    valueInput.value = '';
    showStatus(`Cookie "${name}" added.`);
    await loadCookies();
  } catch (err) {
    showStatus('Error adding cookie: ' + err.message, true);
  }
}

async function init() {
  clearGlobalBtn.addEventListener('click', clearGlobalBrowsingData);

  const tab = await getActiveTab();
  if (!tab) return;

  try {
    const urlObj = new URL(tab.url);
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      domainLabel.textContent = 'Active tab is not a regular web page.';
      clearAllDataBtn.disabled = true;
      clearAllCookiesBtn.disabled = true;
      return;
    }

    currentUrl = tab.url;
    currentHostname = urlObj.hostname;
    currentOrigin = urlObj.origin;
    domainLabel.textContent = currentHostname;

    clearAllDataBtn.addEventListener('click', clearAllSiteData);
    clearAllCookiesBtn.addEventListener('click', clearAllCookies);
    refreshBtn.addEventListener('click', loadCookies);
    addForm.addEventListener('submit', addCookie);

    await loadCookies();
  } catch {
    domainLabel.textContent = 'Invalid site URL.';
  }
}

document.addEventListener('DOMContentLoaded', init);
