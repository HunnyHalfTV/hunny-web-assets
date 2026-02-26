/* ============================================================
   common.js — 후니네 반값티비 공통 JavaScript (CDN 버전)
   ============================================================ */

if (typeof MO_ORIGIN === 'undefined') var MO_ORIGIN = { lat: 0, lng: 0, addr: '' };
if (typeof MO_KAKAO_JS_KEY === 'undefined') var MO_KAKAO_JS_KEY = '';
if (typeof MO_KAKAO_REST_KEY === 'undefined') var MO_KAKAO_REST_KEY = '';
if (typeof _mapBtnStore === 'undefined') var _mapBtnStore = {};

var _$ = function (id) { return document.getElementById(id); };
var $ = _$;

function _debounce(fn, delay) {
    var timer = null;
    return function () {
        var context = this, args = arguments;
        clearTimeout(timer);
        timer = setTimeout(function () {
            fn.apply(context, args);
        }, delay);
    };
}

function _throttle(fn, limit) {
    var lastFunc, lastRan;
    return function () {
        var context = this, args = arguments;
        if (!lastRan) {
            fn.apply(context, args);
            lastRan = Date.now();
        } else {
            clearTimeout(lastFunc);
            lastFunc = setTimeout(function () {
                if ((Date.now() - lastRan) >= limit) {
                    fn.apply(context, args);
                    lastRan = Date.now();
                }
            }, limit - (Date.now() - lastRan));
        }
    };
}

function runPromise(funcName) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve, reject) {
        google.script.run
            .withSuccessHandler(resolve)
            .withFailureHandler(reject)[funcName].apply(google.script.run, args);
    });
}

function _today() {
    var d = new Date();
    return d.getFullYear() + '-'
        + String(d.getMonth() + 1).padStart(2, '0') + '-'
        + String(d.getDate()).padStart(2, '0');
}

function alert2(msg, type) {
    type = type || 'success';
    var old = document.getElementById('_glToast');
    if (old) old.remove();
    var t = document.createElement('div');
    t.id = '_glToast';
    var isOk = (type === 'success' || type === 'ok');
    t.className = 'toast-msg ' + (isOk ? 'toast-ok' : 'toast-er');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    clearTimeout(t._tt);
    t._tt = setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 3500);
}
var showAlert = alert2;

function _getByteLength(str) {
    return new TextEncoder().encode(str).length;
}

function _splitIntoChunks(data, maxByteSize) {
    maxByteSize = maxByteSize || (50 * 1024);
    var jsonString = JSON.stringify(data);
    var encoder = new TextEncoder();
    var encodedData = encoder.encode(jsonString);
    var totalBytes = encodedData.length;

    if (totalBytes <= maxByteSize) return [jsonString];

    var chunks = [];
    var currentPos = 0;
    var decoder = new TextDecoder();

    while (currentPos < totalBytes) {
        var endPos = Math.min(currentPos + maxByteSize, totalBytes);
        var chunkUint8 = encodedData.slice(currentPos, endPos);
        chunks.push(decoder.decode(chunkUint8));
        currentPos = endPos;
    }
    return chunks;
}

function _sendLargeData(data, successCb, serverFunctionName, retryCount) {
    serverFunctionName = serverFunctionName || 'processChunk';
    retryCount = retryCount || 0;
    var maxRetries = 3;
    var chunks = _splitIntoChunks(data, 50000);
    var total = chunks.length;
    var txId = 'TX' + Date.now() + Math.floor(Math.random() * 1000);

    var sendNext = function (idx) {
        if (idx >= total) return;

        google.script.run
            .withSuccessHandler(function (res) {
                if (res && res.isComplete) {
                    if (successCb) successCb(res.data);
                } else {
                    sendNext(idx + 1);
                }
            })
            .withFailureHandler(function (err) {
                if (retryCount < maxRetries) {
                    console.warn('전송 실패, 재시도 중... (' + (retryCount + 1) + '/' + maxRetries + ')');
                    setTimeout(function () { _sendLargeData(data, successCb, serverFunctionName, retryCount + 1); }, 1000 * Math.pow(2, retryCount));
                } else {
                    alert2('데이터 전송 실패: ' + err.message, 'error');
                }
            })[serverFunctionName](txId, idx, total, chunks[idx]);
    };

    sendNext(0);
}

function _getLocalSession() {
    try {
        var raw = localStorage.getItem('_appSess');
        if (!raw) return null;
        var d = JSON.parse(raw);
        if (d && d.token && d.expiresAt && Date.now() < d.expiresAt) return d;
        _clearLocalSession(); return null;
    } catch (e) { return null; }
}
function _clearLocalSession() { try { localStorage.removeItem('_appSess'); } catch (e) { } }
function _getToken() {
    var t = sessionStorage.getItem('session_token');
    if (t) return t;
    var ls = _getLocalSession();
    if (ls) return ls.token;
    return (typeof S !== 'undefined' && S.token) ? S.token : '';
}

function _getAppUrl(cb) {
    var sUrl = (typeof S !== 'undefined' && S.appUrl) ? S.appUrl : '';
    if (sUrl) { cb(sUrl); return; }
    var storedUrl = sessionStorage.getItem('appUrl');
    if (storedUrl) { cb(storedUrl); return; }
    google.script.run.withSuccessHandler(function (u) { cb(u); }).getWebAppUrl();
}

function _startSessionHeartbeat() {
    if (window._ssHbTimer) clearInterval(window._ssHbTimer);
    window._ssHbTimer = setInterval(function () {
        var tok = _getToken();
        if (!tok) return;
        google.script.run.withSuccessHandler(function (res) {
            if (res && res.isSessionExpired) {
                alert2('세션이 만료되어 로그인 페이지로 이동합니다.', 'error');
                setTimeout(function () { _navLogin(); }, 1500);
            }
        }).getUserProfile(tok);
    }, 5 * 60 * 1000);
}
document.addEventListener('DOMContentLoaded', _startSessionHeartbeat);

function _redirect(url) {
    if (!url) return;
    // 1순위: form[method=get, target=_top] submit — GAS 샌드박스에서 가장 안정적
    try {
        var f = document.createElement('form');
        f.method = 'get';
        f.action = url.split('?')[0];
        f.target = '_top';
        f.style.display = 'none';
        var qs = url.indexOf('?') !== -1 ? url.slice(url.indexOf('?') + 1) : '';
        if (qs) {
            qs.split('&').forEach(function (pair) {
                var idx = pair.indexOf('=');
                if (idx === -1) return;
                var inp = document.createElement('input');
                inp.type = 'hidden';
                inp.name = decodeURIComponent(pair.slice(0, idx));
                inp.value = decodeURIComponent(pair.slice(idx + 1));
                f.appendChild(inp);
            });
        }
        document.body.appendChild(f);
        f.submit();
        setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 500);
        return;
    } catch (e) { console.error('_redirect step 1 (form) error:', e); }

    // 2순위: a[target=_top] 클릭
    try {
        var a = document.createElement('a');
        a.href = url;
        a.target = '_top';
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 500);
        return;
    } catch (e) { console.error('_redirect step 2 (a.click) error:', e); }

    // 3순위: window.top.location
    try { window.top.location.href = url; return; } catch (e) { }
    try { window.location.href = url; } catch (e) { console.error('_redirect all attempts failed:', e); }
}

function _navTo(path) { _getAppUrl(function (u) { _redirect(u + path); }); }
function _navMain(tok) {
    var t = tok || _getToken();
    if (t) { _navTo('?session=' + t); return; }
    _navTo('?page=login');
}
function _navLogin() { _navTo('?page=login'); }

function _initHistory(pageName) {
    history.replaceState({ page: pageName + '-base' }, '', location.href);
    history.pushState({ page: pageName }, '', location.href);
}

window.addEventListener('popstate', function () {
    if (typeof _pagePopstateHandled !== 'undefined' && _pagePopstateHandled) return;
    var tok = _getToken();
    var isLoggedIn = tok && sessionStorage.getItem('isLoggedIn') === 'true';
    isLoggedIn ? _navMain(tok) : _navLogin();
});

window.addEventListener('pageshow', function (e) {
    if (typeof _pagePopstateHandled !== 'undefined' && _pagePopstateHandled) return;
    if (e.persisted || (window.performance && window.performance.navigation.type === 2)) {
        var tok = _getToken();
        var appUrl = sessionStorage.getItem('appUrl') || '';
        if (appUrl) {
            _redirect(appUrl + (tok ? '?session=' + encodeURIComponent(tok) : '?page=login'));
        } else {
            google.script.run.withSuccessHandler(function (url) { _redirect(url); }).getRedirectUrl(tok);
        }
    }
});

document.addEventListener('touchstart', function () { }, { passive: true });
document.addEventListener('touchmove', function () { }, { passive: true });

function showAlert(m, t) { alert2(m, t); }

/* ── 인증 타이머 ── */
function _startCountdown(st, type) {
    _stopCountdown(st, type);
    var badgeId = type + 'TimerBadge', textId = type + 'TimerText', expAt = st[type + 'ExpireAt'];
    var badge = _$(badgeId); if (badge) badge.style.display = 'inline-flex';
    var textArr = [badge, _$(textId)];
    st[type + 'CountTimer'] = setInterval(function () {
        var sec = Math.floor((expAt - Date.now()) / 1000);
        if (sec <= 0) {
            _stopCountdown(st, type);
            if (typeof window['_' + type + 'OnExpire'] === 'function') window['_' + type + 'OnExpire']();
            return;
        }
        var m = Math.floor(sec / 60), s = sec % 60;
        var timeStr = m + ':' + (s < 10 ? '0' : '') + s;
        textArr.forEach(function (el) { if (el && el.id === textId) el.textContent = timeStr; });
        if (badge) badge.classList.toggle('expired', sec < 60);
    }, 1000);
}
function _stopCountdown(st, type) {
    if (st[type + 'CountTimer']) { clearInterval(st[type + 'CountTimer']); st[type + 'CountTimer'] = null; }
}

function doLogout() {
    var ov = _$('loOv');
    if (ov) ov.classList.add('show');
}
function _closeLoPopup() {
    var ov = _$('loOv');
    if (ov) ov.classList.remove('show');
}
function _confirmLogout() {
    _closeLoPopup();
    localStorage.removeItem('_appSess');
    sessionStorage.clear();
    var tok = _getToken();
    if (tok) google.script.run.logout(tok);
    alert2('로그아웃되었습니다.', 'success');
    setTimeout(function () { _navLogin(); }, 800);
}

/* ── 확인 팝업 (admin용) ──────────────────────────────── */
var _cfmCallback = null;
function _cfmOpen(title, msg, yesLabel, yesClass, callback) {
    if (!_$('cfmTitle')) return;
    _$('cfmTitle').textContent = title;
    _$('cfmMsg').textContent = msg;
    var yesBtn = _$('cfmYes');
    if (yesBtn) {
        yesBtn.textContent = yesLabel || '확인';
        yesBtn.className = 'cfm-yes' + (yesClass === 'green' ? ' green' : '');
    }
    _cfmCallback = callback;
    var ov = _$('cfmOv');
    if (ov) ov.classList.add('show');
}
function _cfmClose() {
    var ov = _$('cfmOv');
    if (ov) ov.classList.remove('show');
    _cfmCallback = null;
}
function _cfmExec() {
    var cb = _cfmCallback;
    _cfmClose();
    if (cb) cb();
}

/* ── 비밀번호 확인 팝업 ───────────────────────────────── */
function openPwCheck() {
    _$('pwIn').value = '';
    _$('pwErr').textContent = '';
    _$('pwOk').disabled = false;
    _$('pwOk').textContent = '확인';
    _$('pwOverlay').classList.add('show');
    setTimeout(function () { _$('pwIn').focus(); }, 100);
}
function closePwCheck() { _$('pwOverlay').classList.remove('show'); }
function confirmPw() {
    var pw = _$('pwIn').value;
    if (!pw) { _$('pwErr').textContent = '비밀번호를 입력해주세요.'; return; }
    var btn = _$('pwOk');
    btn.disabled = true; btn.textContent = '확인 중...';
    var tok = _getToken();
    google.script.run
        .withSuccessHandler(function (r) {
            btn.disabled = false; btn.textContent = '확인';
            if (r.success) {
                closePwCheck();
                _navTo('?page=profile&session=' + tok);
            } else {
                _$('pwErr').textContent = r.message;
                _$('pwIn').value = '';
                _$('pwIn').focus();
            }
        })
        .withFailureHandler(function () {
            btn.disabled = false; btn.textContent = '확인';
            _$('pwErr').textContent = '오류가 발생했습니다.';
        })
        .verifyCurrentPassword(tok, pw);
}

function fmtPhone(p) {
    if (!p) return '';
    var d = String(p).replace(/\D/g, '');
    if (!d) return '';
    if (d.indexOf('02') === 0) {
        if (d.length <= 2) return d;
        if (d.length <= 5) return d.slice(0, 2) + ' ' + d.slice(2);
        if (d.length <= 9) return d.slice(0, 2) + ' ' + d.slice(2, 5) + ' ' + d.slice(5);
        if (d.length <= 10) return d.slice(0, 2) + ' ' + d.slice(2, 6) + ' ' + d.slice(6);
        return d.slice(0, 2) + ' ' + d.slice(2, 6) + ' ' + d.slice(6, 10);
    }
    if (d.length <= 3) return d;
    if (d.length <= 6) return d.slice(0, 3) + ' ' + d.slice(3);
    if (d.length <= 10) return d.slice(0, 3) + ' ' + d.slice(3, 6) + ' ' + d.slice(6);
    return d.slice(0, 3) + ' ' + d.slice(3, 7) + ' ' + d.slice(7, 11);
}

function fmtAmt(n) {
    var v = Number(n);
    if (isNaN(v)) return String(n || '');
    return v.toLocaleString();
}

function fmtD(d) {
    if (!d) return '-';
    if (d === '최대한 빨리' || d === '추후 연락') return d;
    var parts = String(d).split('-');
    if (parts.length === 3) return parts[1] + '/' + parts[2];
    return String(d);
}

function grpByDate(orders, key) {
    var g = {};
    (orders || []).forEach(function (o) {
        var k = o[key] || '날짜 없음';
        if (!g[k]) g[k] = [];
        g[k].push(o);
    });
    return g;
}

function sortKeys(keys) {
    var specials = ['최대한 빨리', '추후 연락', '날짜 없음'];
    return keys.sort(function (a, b) {
        var ai = specials.indexOf(a), bi = specials.indexOf(b);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return 1;
        if (bi !== -1) return -1;
        return a > b ? -1 : a < b ? 1 : 0;
    });
}

function _chunkGroups(orders, groupKey, pageSize) {
    if (!orders) return [];
    var g = grpByDate(orders, groupKey);
    var sortedKeys = sortKeys(Object.keys(g));
    var pages = [];
    var currentChunk = [];
    var currentCount = 0;

    sortedKeys.forEach(function (key) {
        var items = g[key];
        if (currentCount === 0 || currentCount + items.length <= pageSize) {
            currentChunk.push({ date: key, items: items, isSale: groupKey === 'saleDate' });
            currentCount += items.length;
        } else {
            pages.push(currentChunk);
            currentChunk = [{ date: key, items: items, isSale: groupKey === 'saleDate' }];
            currentCount = items.length;
        }
    });
    if (currentChunk.length > 0) pages.push(currentChunk);
    return pages;
}

function _renderCommonPager(id, total, current, callbackName) {
    var pg = document.getElementById(id);
    if (!pg) return;
    if (total <= 1) { pg.innerHTML = ''; return; }
    var html = '';
    if (current > 1) {
        html += '<button class="inv-pg-btn" onclick="' + callbackName + '(1)" title="첫 페이지">«</button>';
        html += '<button class="inv-pg-btn" style="margin-right:.3rem" onclick="' + callbackName + '(' + (current - 1) + ')" title="이전 페이지">‹</button>';
    }
    var range = 2;
    var start = Math.max(1, current - range), end = Math.min(total, current + range);
    if (end - start < 4) { if (start === 1) end = Math.min(total, 5); else if (end === total) start = Math.max(1, total - 4); }
    for (var p = start; p <= end; p++) { html += '<button class="inv-pg-btn' + (p === current ? ' active' : '') + '" onclick="' + callbackName + '(' + p + ')">' + p + '</button>'; }
    if (current < total) {
        html += '<button class="inv-pg-btn" style="margin-left:.3rem" onclick="' + callbackName + '(' + (current + 1) + ')" title="다음 페이지">›</button>';
        html += '<button class="inv-pg-btn" onclick="' + callbackName + '(' + total + ')" title="마지막 페이지">»</button>';
    }
    pg.innerHTML = html;
}

var _addrStore = [];
function _addrStoreReset() { _addrStore.length = 0; }
var _ADDR_ROAD_RE = /^(.+?(?:로|길|대로)\s+\d+(?:-\d+)?)/;
var _ADDR_JIBUN_RE = /^(.+?(?:동|리)\s+\d+(?:-\d+)?)/;

function _cleanAddrClient(raw) {
    if (!raw) return '';
    var s = String(raw).replace(/\([^)]*\)/g, '').replace(/,.*$/, '').replace(/\s+/g, ' ').trim();
    var m = s.match(_ADDR_ROAD_RE) || s.match(_ADDR_JIBUN_RE);
    return m ? m[1].trim() : s;
}

function _copyAddr(idx) {
    var text = _addrStore[idx]; if (!text) return;
    if (navigator.clipboard) { navigator.clipboard.writeText(text).then(function () { alert2('주소 복사됨'); }).catch(function () { _copyAddrFallback(text); }); }
    else _copyAddrFallback(text);
}

function _copyAddrFallback(text) {
    var ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(ta); ta.focus(); ta.select(); try { document.execCommand('copy'); alert2('주소 복사됨'); } catch (e) { alert2('복사 실패', 'error'); }
    document.body.removeChild(ta);
}

var _ADDR_COPY_SVG = '<svg class="addr-copy-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
function _addrHtml(addr) { if (!addr) return '-'; var base = _cleanAddrClient(addr); var idx = _addrStore.length; _addrStore.push(base); return '<span class="addr-copy" data-action="copy" data-idx="' + idx + '">' + base + _ADDR_COPY_SVG + '</span>'; }
