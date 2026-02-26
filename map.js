/* ============================================================
   map.js — 지도 및 동선 관리 로직 (CDN 버전)
   ============================================================ */

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
    openMap(_mapBtnStore[key].date, _mapBtnStore[key].addrList);
}

var _mapBusy = false;
var _moMap = null, _moOkList = [], _moMarkerOvs = [], _moInfoOvs = [];
var _moOriginMarkerOv = null, _moOriginInfoOv = null, _moOpenOv = null;
var _moRoutePolylines = [], _moRouteActive = false, _moSegInfo = [];
var _moCustomOrder = [];
var _moSortMode = false, _moPanelExpanded = false;
var _moKakaoLoaded = false;

var _moGeoCache = {};
var _moGeoCacheOrder = [];
var _MO_GEO_CACHE_MAX = 5;

function _moGeoCacheGet(date) {
    if (!_moGeoCache.hasOwnProperty(date)) return null;
    _moGeoCacheOrder.splice(_moGeoCacheOrder.indexOf(date), 1);
    _moGeoCacheOrder.push(date);
    return _moGeoCache[date];
}

function _moGeoCacheSet(date, results) {
    if (_moGeoCache.hasOwnProperty(date)) { _moGeoCacheOrder.splice(_moGeoCacheOrder.indexOf(date), 1); }
    else if (_moGeoCacheOrder.length >= _MO_GEO_CACHE_MAX) { delete _moGeoCache[_moGeoCacheOrder.shift()]; }
    _moGeoCache[date] = results; _moGeoCacheOrder.push(date);
}

function openMap(date, addrList) {
    if (_mapBusy) return;
    var cached = _moGeoCacheGet(date);
    if (cached) {
        _$('moSubtitle').textContent = date + ' 배송 동선';
        _$('mapOv').classList.add('show');
        _moLoadKakaoThenInit(cached);
        return;
    }
    _mapBusy = true;
    var btns = document.querySelectorAll('.map-btn');
    btns.forEach(b => { b.disabled = true; b.textContent = '⏳ 변환 중...'; });
    google.script.run
        .withSuccessHandler(res => {
            _mapBusy = false;
            btns.forEach(b => { b.disabled = false; b.textContent = '🗺️ 지도보기'; });
            _moGeoCacheSet(date, res);
            _$('moSubtitle').textContent = date + ' 배송 동선';
            _$('mapOv').classList.add('show');
            _moLoadKakaoThenInit(res || []);
        })
        .withFailureHandler(() => { _mapBusy = false; btns.forEach(b => { b.disabled = false; b.textContent = '🗺️ 지도보기'; }); })
        .geocodeAddresses(addrList);
}

function closeMapOv() {
    _$('mapOv').classList.remove('show');
    document.body.style.overflow = '';
    _moRouteActive = false; _moRouteClear();
    _moMarkerOvs.forEach(m => m.setMap(null)); _moMarkerOvs = [];
    _moInfoOvs.forEach(i => i.setMap(null)); _moInfoOvs = [];
    if (_moOriginMarkerOv) _moOriginMarkerOv.setMap(null);
    _moMap = null;
    _$('moAddrListScroll').innerHTML = '';
}

function _moLoadKakaoThenInit(results) {
    if (_moKakaoLoaded) { _moInitMap(results); return; }
    var sc = document.createElement('script');
    sc.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + MO_KAKAO_JS_KEY + '&libraries=services&autoload=false';
    sc.onload = () => kakao.maps.load(() => { _moKakaoLoaded = true; _moInitMap(results); });
    document.head.appendChild(sc);
}

function _moInitMap(results) {
    _moOkList = results.filter(r => r.ok);
    _$('moMapArea').innerHTML = '<div id="moMap" style="width:100%;height:100%"></div>';
    _moMap = new kakao.maps.Map(_$('moMap'), { center: new kakao.maps.LatLng(MO_ORIGIN.lat, MO_ORIGIN.lng), level: 7 });

    var bounds = new kakao.maps.LatLngBounds();
    bounds.extend(new kakao.maps.LatLng(MO_ORIGIN.lat, MO_ORIGIN.lng));

    var oPos = new kakao.maps.LatLng(MO_ORIGIN.lat, MO_ORIGIN.lng);
    var oEl = document.createElement('div'); oEl.className = 'kk-marker origin-marker'; oEl.textContent = '매장';
    _moOriginMarkerOv = new kakao.maps.CustomOverlay({ position: oPos, content: oEl, yAnchor: 1 });
    _moOriginMarkerOv.setMap(_moMap);

    _moCustomOrder = _moOkList.map((_, i) => i);
    _moMarkerOvs = [];
    _moOkList.forEach((r, i) => {
        var pos = new kakao.maps.LatLng(r.lat, r.lng);
        bounds.extend(pos);
        var mEl = document.createElement('div'); mEl.className = 'kk-marker'; mEl.textContent = i + 1;
        var mOv = new kakao.maps.CustomOverlay({ position: pos, content: mEl, yAnchor: 1 });
        mOv.setMap(_moMap); _moMarkerOvs.push(mOv);
    });

    _moMap.setBounds(bounds);
    _moInitLayout();
    _moRebuildList();
    if (_moOkList.length >= 1) _$('moRouteBtn').style.display = 'inline-block';
}

function moToggleRoute() { _moRouteActive ? _moRouteClear() : _moDrawRoute(); }

function _moRouteClear() {
    _moRouteActive = false;
    _moRoutePolylines.forEach(l => l.setMap(null)); _moRoutePolylines = [];
    _$('moRouteBtn').textContent = '🚚 도로 동선';
    _$('moRouteBtn').classList.remove('active');
    _$('moRouteInfo').classList.remove('show');
    _moRefreshMarkers();
    _moRebuildList();
}

function _moDrawRoute(optimize) {
    var btn = _$('moRouteBtn');
    btn.disabled = true; btn.textContent = '⏳ 계산 중...';
    var pts = _moCustomOrder.map(i => _moOkList[i]);

    google.script.run
        .withSuccessHandler(res => {
            btn.disabled = false;
            if (!res || res.error) { alert2('경로 조회 실패'); _moRouteClear(); return; }
            _moRouteActive = true;
            btn.textContent = '✕ 동선 숨기기';
            btn.classList.add('active');

            _moRoutePolylines.forEach(l => l.setMap(null)); _moRoutePolylines = [];
            var path = [];
            res.sections.forEach(s => s.roads.forEach(r => {
                for (var i = 0; i < r.vertexes.length; i += 2) path.push(new kakao.maps.LatLng(r.vertexes[i + 1], r.vertexes[i]));
            }));
            var poly = new kakao.maps.Polyline({ path: path, strokeWeight: 5, strokeColor: '#0EA5E9', strokeOpacity: 0.8 });
            poly.setMap(_moMap); _moRoutePolylines.push(poly);

            var km = (res.summary.distance / 1000).toFixed(1);
            _$('moRouteInfo').textContent = `🚚 도로 동선 - 약 ${km}km`;
            _$('moRouteInfo').classList.add('show');
            _moRefreshMarkers();
            _moRebuildList();
        })
        .withFailureHandler(() => { btn.disabled = false; alert2('통신 오류'); })
        .getRouteData({
            originLat: MO_ORIGIN.lat, originLng: MO_ORIGIN.lng,
            destLat: pts[pts.length - 1].lat, destLng: pts[pts.length - 1].lng,
            waypoints: pts.slice(0, -1).map(p => ({ lat: p.lat, lng: p.lng })),
            optimize: optimize || false
        });
}

function moAutoOptimizeRoute() {
    if (typeof showCfm === 'function') {
        showCfm('✨ 최적화', '거리 기반으로 방문 순서를 최적화하시겠습니까?', () => _moDrawRoute(true));
    } else {
        if (confirm('거리 기반으로 방문 순서를 최적화하시겠습니까?')) _moDrawRoute(true);
    }
}

function moToggleSortMode() {
    _moSortMode = !_moSortMode;
    var btn = _$('moSortModeBtn');
    if (btn) btn.classList.toggle('active', _moSortMode);
    _moRebuildList();
}

function moResetOrder() {
    _moCustomOrder = _moOkList.map((_, i) => i);
    _moRefreshMarkers();
    _moRebuildList();
    if (_moRouteActive) _moDrawRoute();
}

function _moRefreshMarkers() {
    _moMarkerOvs.forEach((ov, i) => {
        var seq = _moCustomOrder.indexOf(i);
        var el = ov.getContent();
        if (el) {
            el.textContent = seq + 1;
            el.className = 'kk-marker' + (_moRouteActive ? ' amber' : '');
        }
    });
}

function _moRebuildList() {
    var scroll = _$('moAddrListScroll');
    if (!scroll) return;
    scroll.innerHTML = _moCustomOrder.map((idx, seq) => {
        var r = _moOkList[idx];
        return `
        <div class="mo-addr-item" data-idx="${idx}" data-seq="${seq}">
            ${_moSortMode ? '<div class="mo-item-grab">☰</div>' : ''}
            <div class="mo-addr-num ${_moRouteActive ? 'num-amber' : 'num-green'}">${seq + 1}</div>
            <div class="mo-addr-text"><b>${r.customer}</b><div class="detail">${r.addr}</div></div>
        </div>
        `;
    }).join('');
    _moInitListEvents();
}

function _moInitListEvents() {
    // 드래그앤드롭 이벤트 추가 가능
}

function _moInitLayout() { _moSetPanelH(0.42); }

function _moSetPanelH(r) {
    var layout = _$('moLayout');
    if (!layout) return;
    var h = layout.getBoundingClientRect().height;
    var panel = _$('moBottomPanel');
    if (panel) panel.style.height = (h * r) + 'px';
    if (_moMap) setTimeout(() => kakao.maps.event.trigger(_moMap, 'resize'), 300);
}

function moTogglePanelExpand() {
    if (!_$('moBottomPanel')) return;
    _moPanelExpanded = !_moPanelExpanded;
    _moSetPanelH(_moPanelExpanded ? 0.85 : 0.42);
    var btn = _$('moPanelToggleBtn');
    if (btn) btn.textContent = _moPanelExpanded ? '⬇' : '⬆';
}

/* ── 패널 드래그 핸들 (모바일/PC 공용) ── */
(function () {
    // window load 시점에 이벤트 바인딩 (DOM 생성 보장)
    var setup = function () {
        var h = _$('moDragHandle');
        if (!h) { setTimeout(setup, 100); return; } // 생성 안됐으면 재시도
        var sy, sh, dragging = false;
        var panel = _$('moBottomPanel');
        var layout = _$('moLayout');

        function start(e) {
            dragging = true;
            sy = e.touches ? e.touches[0].clientY : e.clientY;
            sh = panel.getBoundingClientRect().height;
            panel.style.transition = 'none';
            document.addEventListener('mousemove', move); document.addEventListener('mouseup', end);
            document.addEventListener('touchmove', move, { passive: false }); document.addEventListener('touchend', end);
        }
        function move(e) {
            if (!dragging) return;
            var y = e.touches ? e.touches[0].clientY : e.clientY;
            var diff = sy - y;
            var nh = sh + diff;
            var lh = layout.getBoundingClientRect().height;
            if (nh < 40) nh = 40; if (nh > lh - 60) nh = lh - 60;
            panel.style.height = nh + 'px';
            if (e.cancelable) e.preventDefault();
        }
        function end() {
            if (!dragging) return;
            dragging = false;
            panel.style.transition = 'height .2s ease';
            document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', end);
            document.removeEventListener('touchmove', move); document.removeEventListener('touchend', end);
            if (_moMap) kakao.maps.event.trigger(_moMap, 'resize');
        }
        h.addEventListener('mousedown', start); h.addEventListener('touchstart', start);
    };
    if (document.readyState === 'complete') setup();
    else window.addEventListener('load', setup);
})();
