
/* ============================================================
   common_js.html — 후니네 반값티비 공통 JavaScript
   ============================================================
   의존 변수 (각 페이지에서 미리 선언):
     - S.token   : 세션 토큰
     - S.appUrl  : 웹앱 URL (없으면 자동 조회)
     - MO_ORIGIN, MO_KAKAO_JS_KEY, MO_KAKAO_REST_KEY (지도 사용 페이지)
     - _mapBtnStore (지도 사용 페이지)
   ============================================================ */

/* ── 미선언 시 안전 폴백 (지도 미사용 페이지 대비) ── */
if (typeof MO_ORIGIN === 'undefined') var MO_ORIGIN = { lat: 0, lng: 0, addr: '' };
if (typeof MO_KAKAO_JS_KEY === 'undefined') var MO_KAKAO_JS_KEY = '';
if (typeof MO_KAKAO_REST_KEY === 'undefined') var MO_KAKAO_REST_KEY = '';
if (typeof _mapBtnStore === 'undefined') var _mapBtnStore = {};

/* ── 공통 유틸 ────────────────────────────────────────── */
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

/**
 * google.script.run을 Promise로 감싸 병렬 처리가 가능하게 합니다.
 * 사용법: runPromise('서버함수명', 인자1, 인자2...).then(...)
 */
function runPromise(funcName) {
  var args = Array.prototype.slice.call(arguments, 1);
  return new Promise(function (resolve, reject) {
    google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(reject)[funcName].apply(google.script.run, args);
  });
}

/* ── 오늘 날짜 (로컬 시간 기준) ──────────────────────────
   new Date().toISOString()은 UTC 기준이라 한국 새벽(UTC+9 자정~09:00)에
   날짜가 하루 전으로 밀리는 문제가 있어 로컬 시간 기준 함수로 대체          */
function _today() {
  var d = new Date();
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}

/* ── 토스트 알림 (alert2 / showAlert 통합) ─────────────
   type: 'success'|'ok'  → 초록
         'error'|'er'    → 빨강                          */
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
/* profile.html 호환 alias */
var showAlert = alert2;

/* ── TextEncoder / TextDecoder 모듈 레벨 캐싱 (반복 생성 비용 제거) ── */
var _enc = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : null;
var _dec = (typeof TextDecoder !== 'undefined') ? new TextDecoder() : null;

/**
 * 문자열의 바이트 길이를 계산합니다.
 */
function _getByteLength(str) {
  return _enc ? _enc.encode(str).length : new Blob([str]).size;
}

/**
 * 데이터를 설정된 바이트 제한에 맞춰 동적으로 청크(문자열 배열)로 나눕니다.
 * @param {any} data - 보낼 데이터
 * @param {number} maxByteSize - 청크당 최대 바이트 (기본 50KB)
 */
function _splitIntoChunks(data, maxByteSize) {
  maxByteSize = maxByteSize || (50 * 1024);
  var jsonString = JSON.stringify(data);
  if (!_enc) return [jsonString]; // 폴백: 분할 없이 전체 반환
  var encodedData = _enc.encode(jsonString);
  var totalBytes = encodedData.length;

  if (totalBytes <= maxByteSize) return [jsonString];

  var chunks = [];
  var currentPos = 0;

  while (currentPos < totalBytes) {
    var endPos = Math.min(currentPos + maxByteSize, totalBytes);
    var chunkUint8 = encodedData.slice(currentPos, endPos);
    chunks.push(_dec.decode(chunkUint8));
    currentPos = endPos;
  }
  return chunks;
}

/**
 * 대용량 데이터를 청크 단위로 서버에 전송합니다.
 * @param {string} serverFunctionName - 서버쪽 처리 함수명 (기본: processChunk)
 * @param {any} data - 전송할 전체 데이터
 * @param {function} successCb - 최종 완료 시 콜백
 */
function _sendLargeData(data, successCb, serverFunctionName, retryCount) {
  serverFunctionName = serverFunctionName || 'processChunk';
  retryCount = retryCount || 0;
  var maxRetries = 3;
  var chunks = _splitIntoChunks(data, 50000); // 50KB 안전 마진
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

/* ── 세션 / 웹앱 URL ─────────────────────────────────── */
var S = (typeof S !== 'undefined') ? S : { token: '', appUrl: '' };

/* ── localStorage 세션 캐시 헬퍼 ────────────────────────
   login.html의 _setLocalSession()과 동일한 키(_appSess)를 사용합니다.  */
var _LS_SESS_KEY = '_appSess';

function _getLocalSession() {
  /* [보안] 브라우저 종료 시 로그아웃 정책 적용으로 영구 비활성화.
     향후 정책 변경 대비 함수 형태는 유지하되 항상 null 반환.
     이 함수를 호출하는 코드는 항상 null을 받는다고 가정하고 dead-path로 처리합니다. */
  return null;
}

function _clearLocalSession() {
  try { localStorage.removeItem(_LS_SESS_KEY); } catch (e) { }
}

function _getToken() {
  // [보안] 브라우저 종료 시 로그아웃을 위해 sessionStorage만 사용
  var t = sessionStorage.getItem('session_token');
  if (t) return t;
  return S.token || '';
}

function _getAppUrl(cb) {
  if (S.appUrl) { cb(S.appUrl); return; }
  var storedUrl = sessionStorage.getItem('appUrl');
  if (storedUrl) { S.appUrl = storedUrl; cb(storedUrl); return; }
  google.script.run.withSuccessHandler(function (u) { S.appUrl = u; cb(u); }).getWebAppUrl();
}

/**
 * [보안-3] 세션 하트비트 (Interceptor)
 * 주기적으로 서버에 세션 유효성을 확인하고, 만료 시 즉시 로그인 페이지로 튕깁니다.
 */
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
  }, 5 * 60 * 1000); // 5분마다 체크
}
document.addEventListener('DOMContentLoaded', _startSessionHeartbeat);

/**
 * Google Apps Script 샌드박스 환경에서 안전하게 상위 페이지를 리다이렉트합니다.
 * GAS iframe 샌드박스에서는 window.open/_top, window.top.location 모두 차단될 수 있으므로
 * form[target="_top"] submit 방식을 1순위, a[target="_top"] 클릭을 2순위로 시도합니다.
 */
function _redirect(url) {
  if (!url) return;

  // 1순위: form[method=get, target=_top] submit — GAS 샌드박스에서 가장 안정적
  try {
    var f = document.createElement('form');
    f.method = 'get';
    f.action = url.split('?')[0];  // base URL
    f.target = '_top';
    f.style.display = 'none';
    // URL 파라미터를 hidden input으로 분리
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

  // 3순위: window.top.location (크로스-오리진 차단 가능성 있음)
  try { window.top.location.href = url; return; } catch (e) { }

  // 최후 수단
  try { window.location.href = url; } catch (e) { console.error('_redirect all attempts failed:', e); }
}

function _navTo(path) {
  _getAppUrl(function (u) { _redirect(u + path); });
}
function _navMain(tok) {
  // [보안] 브라우저 종료 시 로그아웃 정책: localStorage 페이지 정보 사용 안 함
  var t = tok || _getToken();
  if (t) { _navTo('?session=' + t); return; }
  _navTo('?page=login');
}
function _navLogin() {
  _navTo('?page=login');
}

/* ── History 초기화 (각 페이지에서 호출) ────────────────
   pageName 예: 'admin', 'profile', 'index'              */
function _initHistory(pageName) {
  history.replaceState({ page: pageName + '-base' }, '', location.href);
  history.pushState({ page: pageName }, '', location.href);
}

/* ── popstate 폴백 (index/index2/index3는 자체 핸들러 사용)
   admin.html / profile.html 전용 — mapOv 처리 불필요한 페이지용  */
if (typeof _popstateRegistered === 'undefined') {
  var _popstateRegistered = true;
  window.addEventListener('popstate', function () {
    // 각 페이지에서 자체 핸들러를 등록한 경우 해당 핸들러가 먼저 실행됨
    // 이 핸들러는 admin/profile처럼 자체 핸들러가 없는 페이지의 폴백
    if (typeof _pagePopstateHandled !== 'undefined' && _pagePopstateHandled) return;
    var tok = _getToken();
    var isLoggedIn = tok && sessionStorage.getItem('isLoggedIn') === 'true';
    isLoggedIn ? _navMain(tok) : _navLogin();
  });
}

/* ── pageshow (뒤로가기 캐시 대응) ──────────────────── */
window.addEventListener('pageshow', function (e) {
  /* index/index2/index3 는 자체 popstate 핸들러에서 처리하므로 스킵 */
  if (typeof _pagePopstateHandled !== 'undefined' && _pagePopstateHandled) return;
  if (e.persisted || (window.performance && window.performance.navigation.type === 2)) {
    var tok = _getToken();
    // [성능] sessionStorage에 appUrl이 있으면 서버 호출 없이 직접 리디렉션
    var appUrl = S.appUrl || sessionStorage.getItem('appUrl') || '';
    if (appUrl) {
      _redirect(appUrl + (tok ? '?session=' + encodeURIComponent(tok) : '?page=login'));
    } else {
      google.script.run.withSuccessHandler(function (url) { _redirect(url); }).getRedirectUrl(tok);
    }
  }
});

/* ── 패시브 터치 이벤트 ──────────────────────────────── */
document.addEventListener('touchstart', function () { }, { passive: true });
document.addEventListener('touchmove', function () { }, { passive: true });

/* ── 로그아웃 팝업 ────────────────────────────────────── */
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
  _clearLocalSession();
  sessionStorage.clear();
  localStorage.removeItem(_LS_SESS_KEY); // 세션 키 명시적 제거

  // 나머지 localStorage 정리 (ID/PW 정보 제외)
  var keysToKeep = ['saved_user_id', 'pw_saved', 'saved_user_pw'];
  var currentData = {};
  keysToKeep.forEach(function (k) { currentData[k] = localStorage.getItem(k); });
  localStorage.clear();
  keysToKeep.forEach(function (k) { if (currentData[k]) localStorage.setItem(k, currentData[k]); });
  // [코드정리-3] 위 keysToKeep 루프에서 이미 완료된 중복 setItem 제거

  var tok = _getToken();
  if (tok) google.script.run.logout(tok);

  alert2('로그아웃되었습니다.', 'success');
  setTimeout(function () { _navLogin(); }, 800);
}

/* ── 확인 팝업 (admin용) ──────────────────────────────── */
var _cfmCallback = null;
function _cfmOpen(title, msg, yesLabel, yesClass, callback) {
  _$('cfmTitle').textContent = title;
  _$('cfmMsg').textContent = msg;
  var yesBtn = _$('cfmYes');
  yesBtn.textContent = yesLabel || '확인';
  yesBtn.className = 'cfm-yes' + (yesClass === 'green' ? ' green' : '');
  _cfmCallback = callback;
  _$('cfmOv').classList.add('show');
}
function _cfmClose() {
  _$('cfmOv').classList.remove('show');
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

/* ── 공통 카운트다운 타이머 ──────────────────────────── */
function _startCountdown(state, type) {
  _stopCountdown(state, type);
  var badgeId = type + 'TimerBadge';
  var textId = type + 'TimerText';
  var expKey = type + 'ExpireAt';
  var timerKey = type + 'CountTimer';
  var badge = _$(badgeId), txt = _$(textId);
  if (!badge || !txt) return;
  badge.style.display = ''; badge.classList.remove('expired');
  state[timerKey] = setInterval(function () {
    var remain = Math.max(0, state[expKey] - Date.now());
    var m = String(Math.floor(remain / 60000)).padStart(2, '0');
    var s = String(Math.floor((remain % 60000) / 1000)).padStart(2, '0');
    txt.textContent = m + ':' + s;
    if (remain === 0) {
      badge.classList.add('expired');
      _stopCountdown(state, type);
      if (typeof window['_' + type + 'OnExpire'] === 'function') window['_' + type + 'OnExpire']();
    }
  }, 1000);
}
function _stopCountdown(state, type) {
  var key = type + 'CountTimer';
  if (state[key]) { clearInterval(state[key]); state[key] = null; }
}

/* ══════════════════════════════════════════════════════════
   공통 렌더 헬퍼 — 각 페이지에서 이전에 개별 선언되던 함수들
   index.html / index2.html / index3.html 에서 공통 사용
   ══════════════════════════════════════════════════════════ */

/* ── 전화번호 포맷 ────────────────────────────────────── */
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

/* ── 금액 포맷 ────────────────────────────────────────── */
function fmtAmt(n) {
  var v = Number(n);
  if (isNaN(v)) return String(n || '');
  return v.toLocaleString();
}

/* ── 날짜 단축 표시 (YYYY-MM-DD → MM/DD, 특수값 그대로) ─ */
function fmtD(d) {
  if (!d) return '-';
  if (d === '최대한 빨리' || d === '추후 연락') return d;
  var parts = String(d).split('-');
  if (parts.length === 3) return parts[1] + '/' + parts[2];
  return String(d);
}

/* ── 날짜별 그룹핑 ────────────────────────────────────── */
function grpByDate(orders, key) {
  var g = {};
  (orders || []).forEach(function (o) {
    var k = o[key] || '날짜 없음';
    if (!g[k]) g[k] = [];
    g[k].push(o);
  });
  return g;
}

/* ── 날짜 키 정렬 — 최신 날짜 먼저 (내림차순), 특수값은 맨 뒤 ── */
function sortKeys(keys) {
  var specials = ['최대한 빨리', '추후 연락', '날짜 없음'];
  return keys.sort(function (a, b) {
    var ai = specials.indexOf(a), bi = specials.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;   // 특수값끼리는 고정 순서 유지
    if (ai !== -1) return 1;                       // 특수값은 항상 맨 뒤
    if (bi !== -1) return -1;
    return a > b ? -1 : a < b ? 1 : 0;            // 날짜 내림차순 (최신 → 과거)
  });
}

/* ── 공통 페이징 지원 함수 ── */
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

  // [이전] "<<", "<" 버튼 - 첫 페이지가 아니면 노출
  if (current > 1) {
    html += '<button class="inv-pg-btn" onclick="' + callbackName + '(1)" title="첫 페이지">«</button>';
    html += '<button class="inv-pg-btn" style="margin-right:.3rem" onclick="' + callbackName + '(' + (current - 1) + ')" title="이전 페이지">‹</button>';
  }

  // [숫자] 현재 페이지 기준 최대 5개 노출
  var range = 2; // 현재 페이지 앞뒤로 2개씩
  var start = Math.max(1, current - range);
  var end = Math.min(total, current + range);

  // 시작/계산 보정 (항상 5개가 가급적 나오도록)
  if (end - start < 4) {
    if (start === 1) end = Math.min(total, 5);
    else if (end === total) start = Math.max(1, total - 4);
  }

  for (var p = start; p <= end; p++) {
    html += '<button class="inv-pg-btn' + (p === current ? ' active' : '') + '" onclick="' + callbackName + '(' + p + ')">' + p + '</button>';
  }

  // [다음] ">", ">>" 버튼 - 마지막 페이지가 아니면 노출
  if (current < total) {
    html += '<button class="inv-pg-btn" style="margin-left:.3rem" onclick="' + callbackName + '(' + (current + 1) + ')" title="다음 페이지">›</button>';
    html += '<button class="inv-pg-btn" onclick="' + callbackName + '(' + total + ')" title="마지막 페이지">»</button>';
  }

  pg.innerHTML = html;
}

/* ── 주소 복사 헬퍼 ───────────────────────────────────── */
var _addrStore = [];
/* 렌더링 사이클 시작 전 호출 — 메모리 누수 방지 */
function _addrStoreReset() { _addrStore.length = 0; }
var _ADDR_ROAD_RE = /^(.+?(?:로|길|대로)\s+\d+(?:-\d+)?)/;
var _ADDR_JIBUN_RE = /^(.+?(?:동|리)\s+\d+(?:-\d+)?)/;

function _cleanAddrClient(raw) {
  if (!raw) return '';
  var s = String(raw)
    .replace(/\([^)]*\)/g, '')
    .replace(/,.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  var m = s.match(_ADDR_ROAD_RE) || s.match(_ADDR_JIBUN_RE);
  return m ? m[1].trim() : s;
}

function _copyAddrFallback(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try { document.execCommand('copy'); alert2('주소 복사됨', 'success'); }
  catch (e) { alert2('복사 실패 — 직접 선택 후 복사해주세요.', 'error'); }
  document.body.removeChild(ta);
}

function _copyAddr(idx) {
  var text = _addrStore[idx];
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(function () { alert2('주소 복사됨', 'success'); })
      .catch(function () { _copyAddrFallback(text); });
  } else {
    _copyAddrFallback(text);
  }
}

var _ADDR_COPY_SVG = '<svg class="addr-copy-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

function _addrHtml(addr) {
  if (!addr) return '-';
  var base = _cleanAddrClient(addr);
  var idx = _addrStore.length;
  _addrStore.push(base);
  return '<span class="addr-copy" data-action="copy" data-idx="' + idx + '" title="탭하면 기본주소 복사">'
    + base + _ADDR_COPY_SVG + '</span>';
}

