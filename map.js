
/* ============================================================
   map_js.html — 지도 및 동선 관리 로직
   ============================================================ */

/* ── 지도버튼 스토어 패턴 ─────────────────────────────── */
function _makeMapBtn(date, orders) {
    if (date === '최대한 빨리' || date === '추후 연락') return '';
    var key = '_mb_' + date.replace(/-/g, '');
    if (typeof _mapBtnStore !== 'undefined') {
        _mapBtnStore[key] = {
            date: date,
            addrList: orders.map(function (o) {
                return { addr: o.address, customer: o.customerName, phone: o.phone1, model: o.modelName, qty: o.quantity };
            })
        };
    }
    return '<button class="map-btn" data-action="openMapStore" data-key="' + key + '">🗺️ 지도보기</button>';
}
function _openMapFromStore(key) {
    if (typeof _mapBtnStore === 'undefined' || !_mapBtnStore[key]) {
        alert2('지도 데이터를 찾을 수 없습니다.', 'error'); return;
    }
    var d = _mapBtnStore[key];
    openMap(d.date, d.addrList);
}

/* ── 지도 패널 주소 표시 헬퍼 ────────────────────────── */
var _MO_COPY_SVG = '<svg style="display:inline-block;vertical-align:middle;width:1.1em;height:1.1em;margin-left:4px;opacity:.5;flex-shrink:0;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
    + '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>'
    + '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>'
    + '</svg>';

function _moAddrSpan(fullAddr) {
    var base = _cleanAddrClient(fullAddr);
    var idx = _addrStore.length;
    _addrStore.push(base);
    return '<span style="-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;cursor:pointer;display:inline-flex;align-items:center;gap:3px;" '
        + 'data-action="copy" data-idx="' + idx + '" title="탭하면 기본주소 복사">'
        + fullAddr + _MO_COPY_SVG + '</span>';
}

/* ── 지도 오버레이 — 전역 변수 ───────────────────────── */
var _mapBusy = false;
var _moMap = null, _moOkList = [], _moMarkerOvs = [], _moInfoOvs = [];
var _moOriginMarkerOv = null, _moOriginInfoOv = null, _moOpenOv = null;
var _moRoutePolylines = [], _moRouteActive = false, _moSegInfo = [];
var _moCustomOrder = [], _moAutoOrder = [];
var _moSortMode = false, _moPanelExpanded = false;
var _moKakaoLoaded = false;
var _moDgSrc = -1, _moDgEl = null;
var _moItemRects = []; // [성능-2] 드래그 시 레이아웃 수치 캐싱용

/* ── _moGeoCache: LRU 방식 (최대 10개 날짜) ───────────── */
var _moGeoCache = {};   // { date: results[] }
var _moGeoCacheOrder = [];   // 접근 순서 기록 (LRU)
var _MO_GEO_CACHE_MAX = 10;

function _moGeoCacheGet(date) {
    if (!_moGeoCache.hasOwnProperty(date)) return null;
    _moGeoCacheOrder.splice(_moGeoCacheOrder.indexOf(date), 1);
    _moGeoCacheOrder.push(date);
    return _moGeoCache[date];
}
function _moGeoCacheSet(date, results) {
    if (_moGeoCache.hasOwnProperty(date)) {
        _moGeoCacheOrder.splice(_moGeoCacheOrder.indexOf(date), 1);
    } else if (_moGeoCacheOrder.length >= _MO_GEO_CACHE_MAX) {
        var oldest = _moGeoCacheOrder.shift();
        delete _moGeoCache[oldest];
    }
    _moGeoCache[date] = results;
    _moGeoCacheOrder.push(date);
}

/* ── openMap / closeMapOv ────────────────────────────── */
function openMap(date, addrList) {
    if (_mapBusy) return;
    var _cached = _moGeoCacheGet(date);
    if (_cached) {
        _$('moSubtitle').textContent = date ? date + ' 배송 동선' : '배송 동선';
        _$('mapOv').classList.add('show');
        document.body.style.overflow = 'hidden';
        setTimeout(function () { _moLoadKakaoThenInit(_cached); }, 50);
        return;
    }
    if (!addrList || !addrList.length) {
        _$('moSubtitle').textContent = date ? date + ' 배송 동선' : '배송 동선';
        _$('mapOv').classList.add('show');
        document.body.style.overflow = 'hidden';
        setTimeout(function () { _moLoadKakaoThenInit([]); }, 50);
        return;
    }
    _mapBusy = true;
    var btns = document.querySelectorAll('.map-btn');
    btns.forEach(function (b) { b.disabled = true; b.textContent = '⏳ 변환 중...'; });
    google.script.run
        .withSuccessHandler(function (results) {
            _mapBusy = false;
            btns.forEach(function (b) { b.disabled = false; b.textContent = '🗺️ 지도보기'; });
            var safeResults = (results && results.length) ? results : [];
            _moGeoCacheSet(date, safeResults);
            _$('moSubtitle').textContent = date ? date + ' 배송 동선' : '배송 동선';
            _$('mapOv').classList.add('show');
            document.body.style.overflow = 'hidden';
            _moLoadKakaoThenInit(safeResults);
        })
        .withFailureHandler(function (err) {
            _mapBusy = false;
            btns.forEach(function (b) { b.disabled = false; b.textContent = '🗺️ 지도보기'; });
            alert2('주소 변환 실패: ' + (err.message || ''), 'error');
        })
        .geocodeAddresses(addrList);
}

function closeMapOv() {
    _$('mapOv').classList.remove('show');
    document.body.style.overflow = '';
    _moRouteActive = false; _moSortMode = false; _moPanelExpanded = false;
    _moRoutePolylines.forEach(function (l) { l.setMap(null); }); _moRoutePolylines = [];
    _moMarkerOvs.forEach(function (m) { m.setMap(null); }); _moMarkerOvs = [];
    _moInfoOvs.forEach(function (i) { i.setMap(null); }); _moInfoOvs = [];
    if (_moOriginMarkerOv) _moOriginMarkerOv.setMap(null);
    if (_moOriginInfoOv) _moOriginInfoOv.setMap(null);
    _moMap = null; _moOkList = []; _moCustomOrder = []; _moAutoOrder = [];
    _moOpenOv = null; _moSegInfo = [];
    var rb = _$('moRouteBtn');
    if (rb) { rb.style.display = 'none'; rb.textContent = '🚚 도로 동선'; rb.className = 'mo-hbtn amber'; }
    var ri = _$('moRouteInfo');
    if (ri) { ri.classList.remove('show'); ri.textContent = ''; }
    var pt = _$('moPanelToggleBtn'); if (pt) pt.textContent = '⬆';
    var sm = _$('moSortModeBtn'); if (sm) { sm.textContent = '✏️ 순서편집'; sm.classList.remove('on'); }
    var al = _$('moAddrListScroll'); if (al) al.innerHTML = '';
    var ma = _$('moMapArea');
    if (ma) {
        ma.style.height = '300px';
        ma.innerHTML = '<div class="mo-loading" id="moLoadingBox"><div class="mo-spinner"></div><span>지도 불러오는 중...</span></div>';
    }
}

/* ── SDK 로드 ─────────────────────────────────────────── */
var _moKakaoLoading = false;
function _moLoadKakaoThenInit(results) {
    if (_moKakaoLoaded && window.kakao && window.kakao.maps) { _moInitMap(results); return; }
    if (_moKakaoLoading) { setTimeout(function () { _moLoadKakaoThenInit(results); }, 100); return; }
    _moKakaoLoading = true;
    var sc = document.createElement('script');
    sc.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + MO_KAKAO_JS_KEY + '&libraries=services&autoload=false';
    sc.onload = function () { kakao.maps.load(function () { _moKakaoLoaded = true; _moKakaoLoading = false; _moInitMap(results); }); };
    sc.onerror = function () { _moKakaoLoading = false; alert2('카카오 지도 SDK 로드 실패', 'error'); };
    document.head.appendChild(sc);
}

/* ── 패널 높이 / 드래그 ──────────────────────────────── */
function _moSetMapH(ratio) {
    var h = _$('moLayout').getBoundingClientRect().height;
    _$('moMapArea').style.height = Math.round(h * ratio) + 'px';
    if (_moMap) kakao.maps.event.trigger(_moMap, 'resize');
}
function _moInitLayout() { _moSetMapH(0.58); }
function moTogglePanelExpand() {
    _moPanelExpanded = !_moPanelExpanded;
    _moSetMapH(_moPanelExpanded ? 0.14 : 0.58);
    _$('moPanelToggleBtn').textContent = _moPanelExpanded ? '⬇' : '⬆';
}

/* ── 드래그 핸들 ── */
(function () {
    var dragging = false, sy = 0, sh = 0;
    function start(y) { dragging = true; sy = y; sh = _$('moMapArea').getBoundingClientRect().height; _$('moMapArea').style.transition = 'none'; }
    // [성능-3] 패널 드래그 시 지도 리사이즈 쓰로틀링 적용
    var move = _throttle(function (y) {
        if (!dragging) return;
        var h = _$('moLayout').getBoundingClientRect().height, nh = Math.min(Math.max(sh + (y - sy), h * .1), h * .9);
        _$('moMapArea').style.height = nh + 'px';
        if (_moMap) kakao.maps.event.trigger(_moMap, 'resize');
    }, 30);
    function end() { if (!dragging) return; dragging = false; _$('moMapArea').style.transition = 'height .28s ease'; }
    document.addEventListener('DOMContentLoaded', function () {
        var pdh = _$('moDragHandle');
        if (!pdh) return;
        pdh.addEventListener('mousedown', function (e) { start(e.clientY); });
        pdh.addEventListener('touchstart', function (e) { start(e.touches[0].clientY); }, { passive: true });
    });
    document.addEventListener('mousemove', function (e) { move(e.clientY); });
    document.addEventListener('touchmove', function (e) { if (dragging) move(e.touches[0].clientY); }, { passive: true });
    document.addEventListener('mouseup', end);
    document.addEventListener('touchend', end);
})();

/* ── 정렬 모드 / 순서 변경 ───────────────────────────── */
function moToggleSortMode() {
    _moSortMode = !_moSortMode;
    var btn = _$('moSortModeBtn');
    btn.textContent = _moSortMode ? '✅ 완료' : '✏️ 순서편집';
    btn.classList.toggle('on', _moSortMode);
    if (!_moSortMode && _moRouteActive) { _moClearRoute(); _moDrawRoute(); }
    _moRebuildList();
}
function moResetOrder() {
    _moCustomOrder = _moAutoOrder.slice();
    if (_moRouteActive) { _moClearRoute(); _moDrawRoute(); }
    else _moRefreshMarkerNums();
    _moRebuildList();
}
function _moMoveItem(seq, dir) {
    var t = seq + dir;
    if (t < 0 || t >= _moCustomOrder.length) return;
    var tmp = _moCustomOrder[seq]; _moCustomOrder[seq] = _moCustomOrder[t]; _moCustomOrder[t] = tmp;
    _moRefreshMarkerNums();
    if (_moRouteActive) { _moClearRoute(); _moDrawRoute(); }
    _moRebuildList();
}
function _moRefreshMarkerNums() {
    _moMarkerOvs.forEach(function (ov, origIdx) {
        var seq = _moCustomOrder.indexOf(origIdx);
        var el = ov.getContent();
        el.textContent = String(seq + 1);
        el.className = 'kk-marker' + (_moRouteActive ? ' amber' : '');
    });
}

/* ── 목록 렌더 ───────────────────────────────────────── */
function _moRebuildList() {
    var scroll = _$('moAddrListScroll');
    if (!scroll) return;
    var failSec = scroll.querySelector('.mo-fail-section');
    _$('moListHeader').textContent = _moRouteActive
        ? '🏪 매장 출발 → 배송 경로 (' + _moCustomOrder.length + '건)'
        : '📍 배송지 목록 (' + _moCustomOrder.length + '건)' + (_moSortMode ? ' — ☰ 드래그 또는 ▲▼ 로 순서변경' : '');
    var frag = document.createDocumentFragment();
    var oi = document.createElement('div');
    oi.className = 'mo-addr-item origin-item';
    oi.dataset.type = 'origin';
    oi.innerHTML = '<div class="mo-addr-num num-green">🏪</div><div class="mo-addr-text"><b>매장 (출발지)</b><div class="detail">🏠 ' + MO_ORIGIN.addr + '</div></div>';
    frag.appendChild(oi);
    _moCustomOrder.forEach(function (origIdx, seqNum) {
        frag.appendChild(_moMakeItem(origIdx, seqNum));
    });
    if (failSec) frag.appendChild(failSec);
    scroll.innerHTML = '';
    scroll.appendChild(frag);
    if (_moSortMode) scroll.classList.add('sort-mode');
    else scroll.classList.remove('sort-mode');
}

function _moMakeItem(origIdx, seqNum) {
    var r = _moOkList[origIdx];
    var extra = '';
    if (_moRouteActive && _moSegInfo[seqNum]) {
        var s = _moSegInfo[seqNum];
        extra = '<span class="mo-dist-badge" style="background:currentColor">→' + (s.distM / 1000).toFixed(1) + 'km ' + Math.round(s.durationSec / 60) + '분</span>';
    }
    var item = document.createElement('div');
    item.className = 'mo-addr-item';
    item.dataset.origIdx = origIdx;
    item.dataset.seqNum = seqNum;
    var gh = document.createElement('div'); gh.className = 'mo-item-grab'; gh.innerHTML = '&#9776;'; gh.title = '드래그로 순서 변경';
    var num = document.createElement('div'); num.className = 'mo-addr-num ' + (_moRouteActive ? 'num-amber' : 'num-blue'); num.textContent = String(seqNum + 1);
    var btns = document.createElement('div'); btns.className = 'mo-order-btns';
    var up = document.createElement('button'); up.className = 'mo-ob'; up.textContent = '▲'; up.title = '위로';
    up.dataset.action = 'up';
    var dn = document.createElement('button'); dn.className = 'mo-ob'; dn.textContent = '▼'; dn.title = '아래로';
    dn.dataset.action = 'dn';
    if (seqNum === 0) up.disabled = true;
    if (seqNum === _moCustomOrder.length - 1) dn.disabled = true;
    btns.appendChild(up); btns.appendChild(dn);
    var tx = document.createElement('div'); tx.className = 'mo-addr-text';
    tx.innerHTML = '<b>' + r.customer + '</b>&nbsp;<a href="tel:' + r.phone + '">' + r.phone + '</a>' + extra
        + '<div class="detail" style="white-space:normal;overflow:visible;text-overflow:unset;">📦 ' + r.model + ' × ' + r.qty + '대<br>🏠 ' + _moAddrSpan(r.addr) + '</div>';
    item.appendChild(gh); item.appendChild(num); item.appendChild(btns); item.appendChild(tx);
    return item;
}

/* ── 목록 이벤트 ─────────────────────────────────────── */
function _moInitListEvents() {
    var scroll = _$('moAddrListScroll');
    if (!scroll) return;
    // [최적화-9] 지도 열기/닫기 반복 시 이벤트 핸들러 누적 방지
    if (scroll._listEventsInit) return;
    scroll._listEventsInit = true;
    scroll.addEventListener('click', function (e) {
        var target = e.target;
        var ob = target.closest('.mo-ob');
        if (ob) {
            e.stopPropagation();
            if (ob.disabled) return;
            var item = ob.closest('.mo-addr-item');
            if (!item) return;
            var seq = parseInt(item.dataset.seqNum);
            var dir = (ob.dataset.action === 'up') ? -1 : 1;
            _moMoveItem(seq, dir);
            return;
        }
        var addrItem = target.closest('.mo-addr-item');
        if (addrItem) {
            if (addrItem.dataset.type === 'origin') {
                _moMap.setCenter(new kakao.maps.LatLng(MO_ORIGIN.lat, MO_ORIGIN.lng));
                _moMap.setLevel(4);
                if (_moOpenOv) { _moOpenOv.setMap(null); _moOpenOv = null; }
                _moOriginInfoOv.setMap(_moMap); _moOpenOv = _moOriginInfoOv;
                return;
            }
            var origIdx = parseInt(addrItem.dataset.origIdx);
            if (isNaN(origIdx)) return;
            _moMap.setCenter(new kakao.maps.LatLng(_moOkList[origIdx].lat, _moOkList[origIdx].lng));
            _moMap.setLevel(4);
            if (_moOpenOv && _moOpenOv !== _moInfoOvs[origIdx]) _moOpenOv.setMap(null);
            _moInfoOvs[origIdx].setMap(_moMap); _moOpenOv = _moInfoOvs[origIdx];
            document.querySelectorAll('.mo-addr-item').forEach(function (el) { el.classList.remove('active'); });
            addrItem.classList.add('active');
        }
    });
    // [성능-2] 드래그 시작 시 모든 리스트 항목의 위치 정보를 캐싱
    function startDrag(e) {
        var gh = e.target.closest('.mo-item-grab');
        if (!gh) return;
        var item = gh.closest('.mo-addr-item');
        if (!item) return;

        _moDgSrc = +item.dataset.seqNum;
        _moDgEl = item;
        _moItemRects = Array.from(scroll.querySelectorAll('.mo-addr-item[data-orig-idx]')).map(function (el) {
            var r = el.getBoundingClientRect();
            return { el: el, top: r.top, bottom: r.bottom };
        });

        item.classList.add('is-dragging');
        if (e.type === 'mousedown') e.preventDefault();
    }
    scroll.addEventListener('mousedown', startDrag);
    scroll.addEventListener('touchstart', startDrag, { passive: true });
    scroll.addEventListener('mousemove', _moDgMove);
    scroll.addEventListener('touchmove', _moDgTouchMove, { passive: false });
    scroll.addEventListener('mouseup', _moDgEnd);
    scroll.addEventListener('touchend', _moDgEnd);
}
function _moItemUnderY(y, scroll) {
    if (!_moItemRects.length) return null;
    for (var i = 0; i < _moItemRects.length; i++) {
        var r = _moItemRects[i];
        if (r.el === _moDgEl) continue;
        if (y >= r.top && y <= r.bottom) return r.el;
    }
    return null;
}
function _moClearDgOver(scroll) { scroll.querySelectorAll('.drag-over-top,.drag-over-bottom').forEach(function (e) { e.classList.remove('drag-over-top', 'drag-over-bottom'); }); }
function _moDgMove(e) { if (_moDgSrc < 0 || !_moDgEl) return; var over = _moItemUnderY(e.clientY, e.currentTarget); _moClearDgOver(e.currentTarget); if (over) { var r = over.getBoundingClientRect(), mid = (r.top + r.bottom) / 2; over.classList.add(e.clientY < mid ? 'drag-over-top' : 'drag-over-bottom'); } }
function _moDgTouchMove(e) { if (_moDgSrc < 0 || !_moDgEl) return; e.preventDefault(); var y = e.touches[0].clientY; var over = _moItemUnderY(y, e.currentTarget); _moClearDgOver(e.currentTarget); if (over) { var r = over.getBoundingClientRect(), mid = (r.top + r.bottom) / 2; over.classList.add(y < mid ? 'drag-over-top' : 'drag-over-bottom'); } }
function _moDgEnd(e) {
    if (_moDgSrc < 0 || !_moDgEl) return;
    var scroll = e.currentTarget;
    var y = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
    var over = _moItemUnderY(y, scroll);
    if (over && over !== _moDgEl) {
        var r = over.getBoundingClientRect(), mid = (r.top + r.bottom) / 2, tgtSeq = +over.dataset.seqNum;
        var from = _moDgSrc, moved = _moCustomOrder.splice(from, 1)[0];
        var insertBefore = y < mid;
        var to = from < tgtSeq ? (insertBefore ? tgtSeq - 1 : tgtSeq) : (insertBefore ? tgtSeq : tgtSeq + 1);
        to = Math.max(0, Math.min(to, _moCustomOrder.length));
        _moCustomOrder.splice(to, 0, moved);
        _moRefreshMarkerNums();
        if (_moRouteActive) { _moClearRoute(); _moDrawRoute(); }
    }
    _moDgSrc = -1; _moDgEl = null; _moItemRects = [];
    _moRebuildList();
}

/* ── 동선 ────────────────────────────────────────────── */
function moToggleRoute() { _moRouteActive ? _moClearRoute() : _moDrawRoute(); }
function moAutoOptimizeRoute() {
    var msg = '현재 배송지들의 방문 순서를 거리 기반으로\n자동 최적화하시겠습니까?';
    if (typeof showCfm === 'function') { showCfm('✨ 배송 순서 자동 최적화', msg, function () { _moDrawRoute(true); }); }
    else { if (confirm(msg)) _moDrawRoute(true); }
}
/**
 * _moDrawRoute — 도로 동선 API 호출 진입점
 * 역할: 버튼 상태 설정 → 경유지 구성 → getRouteData 서버 호출
 */
function _moDrawRoute(optimize) {
    var btn = _$('moRouteBtn');
    btn.disabled = true; btn.textContent = '⏳ 계산 중...';
    var pts = _moCustomOrder.map(function (i) { return _moOkList[i]; });
    if (!pts || pts.length === 0) { btn.disabled = false; btn.textContent = '🚚 도로 동선'; return; }
    var dest = pts[pts.length - 1];
    var wpts = pts.length > 1 ? pts.slice(0, pts.length - 1) : [];
    google.script.run
        .withSuccessHandler(function (data) {
            btn.disabled = false;
            _moHandleRouteResult(data, btn);
        })
        .withFailureHandler(function () { btn.disabled = false; _moDrawStraight(); })
        .getRouteData({
            originLat: MO_ORIGIN.lat, originLng: MO_ORIGIN.lng,
            destLat: dest.lat, destLng: dest.lng,
            waypoints: wpts.map(function (p) { return { lat: p.lat, lng: p.lng, name: p.customer }; }),
            optimize: optimize || false
        });
}

/**
 * _moHandleRouteResult — API 응답 처리
 * 역할: 오류 검증 → 최적화 경유지 순서 반영 → 폴리라인 렌더링 위임
 */
function _moHandleRouteResult(data, btn) {
    if (!data || data.error) {
        alert2('API 오류: ' + (data ? data.error : '알 수 없는 오류') + '. 직선 동선으로 대체합니다.', 'error');
        _moDrawStraight(); return;
    }
    var routes = data.routes;
    if (!routes || !routes[0] || routes[0].result_code !== 0) { _moDrawStraight(); return; }
    // 경유지 최적화 순서 반영
    if (data.optimizedWaypoints) {
        var newOrder = [];
        data.optimizedWaypoints.forEach(function (optWp) {
            for (var i = 0; i < _moOkList.length; i++) {
                if (_moOkList[i].lat === optWp.lat && _moOkList[i].lng === optWp.lng) { newOrder.push(i); break; }
            }
        });
        var dest = _moCustomOrder[_moCustomOrder.length - 1];
        if (newOrder.indexOf(dest) === -1) newOrder.push(dest);
        _moCustomOrder = newOrder;
    }
    _moRenderRoutePolylines(routes[0]);
}

/**
 * _moRenderRoutePolylines — Polyline 그리기 + 요약 UI 업데이트
 * 역할: sections 순회 → Polyline 생성/등록 → 거리/시간 요약 표시
 */
function _moRenderRoutePolylines(route) {
    var colors = ['#F59E0B', '#EF4444', '#8B5CF6', '#10B981', '#EC4899', '#F97316'];
    _moRouteActive = true;
    var btn = _$('moRouteBtn');
    btn.textContent = '✕ 동선 숨기기'; btn.className = 'mo-hbtn amber active';
    _moSegInfo = [];
    if (route.sections && route.sections.length > 0) {
        route.sections.forEach(function (sec, si) {
            _moSegInfo.push({ distM: sec.distance, durationSec: sec.duration });
            if (sec.roads) {
                sec.roads.forEach(function (road) {
                    var path = [];
                    for (var vi = 0; vi < road.vertexes.length; vi += 2) {
                        path.push(new kakao.maps.LatLng(road.vertexes[vi + 1], road.vertexes[vi]));
                    }
                    var l = new kakao.maps.Polyline({
                        path: path, strokeWeight: 5,
                        strokeColor: colors[si % colors.length],
                        strokeOpacity: .85, strokeStyle: 'solid'
                    });
                    l.setMap(_moMap); _moRoutePolylines.push(l);
                });
            }
        });
    } else { _moDrawStraight(); return; }
    _moRefreshMarkerNums();
    var km = (route.summary.distance / 1000).toFixed(1);
    var min = Math.round((route.summary.duration || 0) / 60);
    var ri = _$('moRouteInfo');
    ri.textContent = '🏪 매장 출발 → 도로 동선 — 총 ' + km + ' km / 약 ' + min + '분 ';
    ri.classList.add('show');
    _moRebuildList();
}
function _moDrawStraight() {
    _moRouteActive = true;
    var btn = _$('moRouteBtn'); btn.textContent = '✕ 동선 숨기기'; btn.className = 'mo-hbtn amber active';
    var allPts = [MO_ORIGIN].concat(_moCustomOrder.map(function (i) { return _moOkList[i]; }));
    var totalKm = 0;
    for (var i = 0; i < allPts.length - 1; i++) {
        var a = allPts[i], b = allPts[i + 1]; totalKm += _moDistKm(a, b);
        var l = new kakao.maps.Polyline({ path: [new kakao.maps.LatLng(a.lat, a.lng), new kakao.maps.LatLng(b.lat, b.lng)], strokeWeight: 4, strokeColor: i === 0 ? '#10B981' : '#F59E0B', strokeOpacity: .9, strokeStyle: 'shortdash', endArrow: true }); l.setMap(_moMap); _moRoutePolylines.push(l);
    }
    _moRefreshMarkerNums();
    var ri = _$('moRouteInfo'); ri.textContent = '🏪 매장 출발 → 직선 동선 — 총 약 ' + totalKm.toFixed(1) + ' km'; ri.classList.add('show');
    _moRebuildList();
}
function _moClearRoute() {
    _moRouteActive = false; _moSegInfo = [];
    var btn = _$('moRouteBtn'); btn.textContent = '🚚 도로 동선'; btn.className = 'mo-hbtn amber';
    _moRoutePolylines.forEach(function (l) { l.setMap(null); }); _moRoutePolylines = [];
    _$('moRouteInfo').classList.remove('show');
    _moRefreshMarkerNums(); _moRebuildList();
}
function _moDistKm(a, b) {
    var R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
    var s = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.pow(Math.sin(dLng / 2), 2);
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
function _moOptimize(pts) {
    var n = pts.length; if (n === 0) return []; if (n === 1) return [0];
    // 동일 좌표 예외 처리 및 계산
    var d = function (a, b) {
        if (a.lat === b.lat && a.lng === b.lng) return 0;
        return Math.pow(a.lat - b.lat, 2) + Math.pow(a.lng - b.lng, 2);
    };
    var vis = new Array(n).fill(false), ord = [], cur = 0; vis[0] = true; ord.push(0);
    // [버그수정-1] ss < ss < n 오타 수정 → ss < n (기존 코드는 루프가 즉시 종료되어 최적화 무동작)
    for (var ss = 1; ss < n; ss++) {
        var best = -1, bd = Infinity;
        for (var j = 0; j < n; j++) {
            if (!vis[j]) {
                var dist = d(pts[cur], pts[j]);
                if (dist < bd) { bd = dist; best = j; }
            }
        }
        if (best === -1) break;
        vis[best] = true; ord.push(best); cur = best;
    }
    return ord;
}

/* ── 지도 초기화 ─────────────────────────────────────── */
function _moInitMap(results) {
    _moOkList = results.filter(function (r) { return r.ok; });
    var fail = results.filter(function (r) { return !r.ok; });
    _$('moMapArea').innerHTML = '<div id="moMap"></div>';
    _moInitLayout();
    _moMap = new kakao.maps.Map(_$('moMap'), { center: new kakao.maps.LatLng(MO_ORIGIN.lat, MO_ORIGIN.lng), level: 7 });
    _moMap.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
    _moMap.addControl(new kakao.maps.MapTypeControl(), kakao.maps.ControlPosition.TOPRIGHT);
    (function (m) { setTimeout(function () { kakao.maps.event.trigger(m, 'resize'); }, 100); })(_moMap);
    var bounds = new kakao.maps.LatLngBounds();
    bounds.extend(new kakao.maps.LatLng(MO_ORIGIN.lat, MO_ORIGIN.lng));
    _moAutoOrder = _moOptimize(_moOkList); _moCustomOrder = _moAutoOrder.slice();
    var oPos = new kakao.maps.LatLng(MO_ORIGIN.lat, MO_ORIGIN.lng);
    var oEl = document.createElement('div'); oEl.className = 'kk-marker origin-marker'; oEl.textContent = '매장';
    _moOriginMarkerOv = new kakao.maps.CustomOverlay({ position: oPos, content: oEl, yAnchor: 1, zIndex: 6 }); _moOriginMarkerOv.setMap(_moMap);
    var oInfoEl = document.createElement('div'); oInfoEl.className = 'kk-info';
    oInfoEl.innerHTML = '<button class="kk-info-close">×</button><b style="color:#065F46">🏪 매장 (출발지)</b><br>🏠 <span class="kk-info-addr">' + MO_ORIGIN.addr + '</span>';
    _moOriginInfoOv = new kakao.maps.CustomOverlay({ position: oPos, content: oInfoEl, xAnchor: .5, yAnchor: 1.5, zIndex: 11 });
    oInfoEl.querySelector('.kk-info-close').addEventListener('click', function (e) { e.stopPropagation(); _moOriginInfoOv.setMap(null); if (_moOpenOv === _moOriginInfoOv) _moOpenOv = null; });
    oEl.addEventListener('click', function () {
        if (_moOpenOv && _moOpenOv !== _moOriginInfoOv) _moOpenOv.setMap(null);
        if (_moOpenOv === _moOriginInfoOv) { _moOriginInfoOv.setMap(null); _moOpenOv = null; }
        else { _moOriginInfoOv.setMap(_moMap); _moOpenOv = _moOriginInfoOv; }
    });
    if (!_moOkList.length) { _moMap.setLevel(5); _moRebuildList(); _moRenderFail(fail); return; }
    _moOkList.forEach(function (r, i) {
        var pos = new kakao.maps.LatLng(r.lat, r.lng); bounds.extend(pos);
        var mEl = document.createElement('div'); mEl.className = 'kk-marker'; mEl.textContent = String(_moCustomOrder.indexOf(i) + 1);
        var mOv = new kakao.maps.CustomOverlay({ position: pos, content: mEl, yAnchor: 1, zIndex: 5 }); mOv.setMap(_moMap); _moMarkerOvs.push(mOv);
        var iEl = document.createElement('div'); iEl.className = 'kk-info';
        iEl.innerHTML = '<button class="kk-info-close">×</button><b>' + r.customer + '</b><br>📞 <a href="tel:' + r.phone + '" class="kk-info-phone">' + r.phone + '</a><br>📦 ' + r.model + ' × ' + r.qty + '대<br>🏠 <span class="kk-info-addr">' + r.addr + '</span>';
        var iOv = new kakao.maps.CustomOverlay({ position: pos, content: iEl, xAnchor: .5, yAnchor: 1.5, zIndex: 10 }); _moInfoOvs.push(iOv);
        (function (idx, ov) {
            iEl.querySelector('.kk-info-close').addEventListener('click', function (e) { e.stopPropagation(); ov.setMap(null); if (_moOpenOv === ov) _moOpenOv = null; document.querySelectorAll('.mo-addr-item').forEach(function (el) { el.classList.remove('active'); }); });
            mEl.addEventListener('click', function () {
                if (_moOpenOv && _moOpenOv !== _moInfoOvs[idx]) _moOpenOv.setMap(null);
                if (_moOpenOv === _moInfoOvs[idx]) { _moInfoOvs[idx].setMap(null); _moOpenOv = null; document.querySelectorAll('.mo-addr-item').forEach(function (el) { el.classList.remove('active'); }); }
                else { _moInfoOvs[idx].setMap(_moMap); _moOpenOv = _moInfoOvs[idx]; }
            });
        })(i, iOv);
    });
    _moMap.setBounds(bounds, 50, 50, 80, 50);
    _moInitListEvents();
    _moRebuildList(); _moRenderFail(fail);
    if (_moOkList.length >= 1) { var rb = _$('moRouteBtn'); if (rb) rb.style.display = 'inline-block'; }
}

function _moRenderFail(list) {
    if (!list.length) return;
    var scroll = _$('moAddrListScroll');
    var sec = document.createElement('div'); sec.className = 'mo-fail-section';
    var hdr = document.createElement('div'); hdr.className = 'mo-fail-header'; hdr.textContent = '⚠️ 주소 확인 필요 (' + list.length + '건)'; sec.appendChild(hdr);
    list.forEach(function (f) {
        var item = document.createElement('div'); item.className = 'mo-fail-item';
        item.innerHTML = '<div class="mo-addr-num num-red">' + f.idx + '</div><div class="mo-addr-text"><b>' + f.customer + '</b>&nbsp;📞 ' + f.phone + '<br>📦 ' + f.model + ' × ' + f.qty + '대<br>🏠 ' + f.addr + '</div>';
        sec.appendChild(item);
    });
    scroll.appendChild(sec);
}

/* ── Kakao SDK 프리로드 ───────────────────────────────── */
(function () {
    if (typeof MO_KAKAO_JS_KEY === 'undefined' || !MO_KAKAO_JS_KEY) return;
    function _loadKakaoSdk() {
        if (window.kakao && window.kakao.maps) { _moKakaoLoaded = true; return; }
        var sc = document.createElement('script');
        sc.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + MO_KAKAO_JS_KEY + '&libraries=services&autoload=false';
        sc.onload = function () { kakao.maps.load(function () { _moKakaoLoaded = true; }); };
        sc.onerror = function () { console.error('Kakao SDK 로드 실패'); };
        document.head.appendChild(sc);
    }
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _loadKakaoSdk); }
    else { _loadKakaoSdk(); }
})();

