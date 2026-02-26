/* ============================================================
   map.js — 지도 및 동선 관리 로직 (CDN/ES5 버전 - 안정성 강화)
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
        var sub = document.getElementById('moSubtitle');
        if (sub) sub.textContent = date + ' 배송 동선';
        var ov = document.getElementById('mapOv');
        if (ov) ov.classList.add('show');
        _moLoadKakaoThenInit(cached);
        return;
    }
    _mapBusy = true;
    var btns = document.querySelectorAll('.map-btn');
    for (var i = 0; i < btns.length; i++) {
        btns[i].disabled = true;
        btns[i].textContent = '⏳ 변환 중...';
    }
    google.script.run
        .withSuccessHandler(function (res) {
            _mapBusy = false;
            for (var j = 0; j < btns.length; j++) {
                btns[j].disabled = false;
                btns[j].textContent = '🗺️ 지도보기';
            }
            _moGeoCacheSet(date, res);
            var sub = document.getElementById('moSubtitle');
            if (sub) sub.textContent = date + ' 배송 동선';
            var ov = document.getElementById('mapOv');
            if (ov) ov.classList.add('show');
            _moLoadKakaoThenInit(res || []);
        })
        .withFailureHandler(function () {
            _mapBusy = false;
            for (var k = 0; k < btns.length; k++) {
                btns[k].disabled = false;
                btns[k].textContent = '🗺️ 지도보기';
            }
            alert2('주소 변환에 실패했습니다.', 'error');
        })
        .geocodeAddresses(addrList);
}

function closeMapOv() {
    var ov = document.getElementById('mapOv');
    if (ov) ov.classList.remove('show');
    document.body.style.overflow = '';
    _moRouteActive = false;
    _moRouteClear();
    for (var i = 0; i < _moMarkerOvs.length; i++) { if (_moMarkerOvs[i]) _moMarkerOvs[i].setMap(null); }
    _moMarkerOvs = [];
    for (var j = 0; j < _moInfoOvs.length; j++) { if (_moInfoOvs[j]) _moInfoOvs[j].setMap(null); }
    _moInfoOvs = [];
    if (_moOriginMarkerOv) _moOriginMarkerOv.setMap(null);
    _moMap = null;
    var scroll = document.getElementById('moAddrListScroll');
    if (scroll) scroll.innerHTML = '';
}

function _moLoadKakaoThenInit(results) {
    if (_moKakaoLoaded && window.kakao && window.kakao.maps) { _moInitMap(results); return; }
    if (typeof MO_KAKAO_JS_KEY === 'undefined' || !MO_KAKAO_JS_KEY) {
        alert2('카카오 지도 키가 설정되지 않았습니다.', 'error');
        return;
    }
    var sc = document.createElement('script');
    sc.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + MO_KAKAO_JS_KEY + '&libraries=services&autoload=false';
    sc.onload = function () {
        kakao.maps.load(function () {
            _moKakaoLoaded = true;
            _moInitMap(results);
        });
    };
    sc.onerror = function () {
        alert2('카카오 지도 SDK 로드에 실패했습니다.', 'error');
    };
    document.head.appendChild(sc);
}

function _moInitMap(results) {
    results = results || [];
    _moOkList = results.filter(function (r) { return r && r.ok; });
    var area = document.getElementById('moMapArea');
    if (area) area.innerHTML = '<div id="moMap" style="width:100%;height:100%"></div>';

    if (typeof MO_ORIGIN === 'undefined' || !MO_ORIGIN.lat) {
        alert2('출발지 정보가 올바르지 않습니다.', 'error');
        return;
    }

    _moMap = new kakao.maps.Map(document.getElementById('moMap'), {
        center: new kakao.maps.LatLng(MO_ORIGIN.lat, MO_ORIGIN.lng),
        level: 7
    });

    var bounds = new kakao.maps.LatLngBounds();
    bounds.extend(new kakao.maps.LatLng(MO_ORIGIN.lat, MO_ORIGIN.lng));

    var oPos = new kakao.maps.LatLng(MO_ORIGIN.lat, MO_ORIGIN.lng);
    var oEl = document.createElement('div');
    oEl.className = 'kk-marker origin-marker';
    oEl.textContent = '매장';
    _moOriginMarkerOv = new kakao.maps.CustomOverlay({ position: oPos, content: oEl, yAnchor: 1 });
    _moOriginMarkerOv.setMap(_moMap);

    _moCustomOrder = _moOkList.map(function (_, i) { return i; });
    _moMarkerOvs = [];
    for (var i = 0; i < _moOkList.length; i++) {
        var r = _moOkList[i];
        if (!r.lat || !r.lng) continue;
        var pos = new kakao.maps.LatLng(r.lat, r.lng);
        bounds.extend(pos);
        var mEl = document.createElement('div');
        mEl.className = 'kk-marker';
        mEl.textContent = i + 1;
        var mOv = new kakao.maps.CustomOverlay({ position: pos, content: mEl, yAnchor: 1 });
        mOv.setMap(_moMap);
        _moMarkerOvs.push(mOv);
    }

    if (_moOkList.length > 0) {
        _moMap.setBounds(bounds);
    } else {
        _moMap.setCenter(new kakao.maps.LatLng(MO_ORIGIN.lat, MO_ORIGIN.lng));
    }

    _moInitLayout();
    _moRebuildList();
    var rb = document.getElementById('moRouteBtn');
    if (rb) {
        rb.style.display = _moOkList.length >= 1 ? 'inline-block' : 'none';
    }
}

function moToggleRoute() {
    if (_moRouteActive) _moRouteClear();
    else _moDrawRoute();
}

function _moRouteClear() {
    _moRouteActive = false;
    for (var i = 0; i < _moRoutePolylines.length; i++) {
        if (_moRoutePolylines[i]) _moRoutePolylines[i].setMap(null);
    }
    _moRoutePolylines = [];
    var btn = document.getElementById('moRouteBtn');
    if (btn) {
        btn.textContent = '🚚 도로 동선';
        btn.classList.remove('active');
    }
    var info = document.getElementById('moRouteInfo');
    if (info) info.classList.remove('show');
    _moRefreshMarkers();
    _moRebuildList();
}

function _moDrawRoute(optimize) {
    var btn = document.getElementById('moRouteBtn');
    if (!btn) return;

    var pts = _moCustomOrder.map(function (i) { return _moOkList[i]; });
    if (!pts || pts.length === 0) {
        alert2('배송지가 존재하지 않습니다.', 'error');
        return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ 계산 중...';

    google.script.run
        .withSuccessHandler(function (res) {
            btn.disabled = false;
            if (!res || res.error || !res.sections) {
                alert2('경로 정보를 가져오지 못했습니다.', 'error');
                _moRouteClear();
                return;
            }
            _moRouteActive = true;
            btn.textContent = '✕ 동선 숨기기';
            btn.classList.add('active');

            for (var i = 0; i < _moRoutePolylines.length; i++) {
                if (_moRoutePolylines[i]) _moRoutePolylines[i].setMap(null);
            }
            _moRoutePolylines = [];

            var path = [];
            for (var j = 0; j < res.sections.length; j++) {
                var s = res.sections[j];
                if (!s || !s.roads) continue;
                for (var k = 0; k < s.roads.length; k++) {
                    var r = s.roads[k];
                    if (!r || !r.vertexes) continue;
                    for (var m = 0; m < r.vertexes.length; m += 2) {
                        path.push(new kakao.maps.LatLng(r.vertexes[m + 1], r.vertexes[m]));
                    }
                }
            }

            if (path.length > 0) {
                var poly = new kakao.maps.Polyline({
                    path: path,
                    strokeWeight: 5,
                    strokeColor: '#F59E0B',
                    strokeOpacity: 0.85
                });
                poly.setMap(_moMap);
                _moRoutePolylines.push(poly);
            }

            var km = (res.summary && res.summary.distance) ? (res.summary.distance / 1000).toFixed(1) : '0';
            var info = document.getElementById('moRouteInfo');
            if (info) {
                info.textContent = '🚚 도로 동선 - 약 ' + km + 'km';
                info.classList.add('show');
            }
            _moRefreshMarkers();
            _moRebuildList();
        })
        .withFailureHandler(function (err) {
            btn.disabled = false;
            alert2('통신 오류: ' + (err.message || ''), 'error');
        })
        .getRouteData({
            originLat: MO_ORIGIN.lat,
            originLng: MO_ORIGIN.lng,
            destLat: pts[pts.length - 1].lat,
            destLng: pts[pts.length - 1].lng,
            waypoints: pts.slice(0, -1).map(function (p) { return { lat: p.lat, lng: p.lng }; }),
            optimize: optimize || false
        });
}

function moAutoOptimizeRoute() {
    var msg = '거리 기반으로 방문 순서를 최적화하시겠습니까?';
    if (typeof showCfm === 'function') {
        showCfm('✨ 최적화', msg, function () { _moDrawRoute(true); });
    } else {
        if (confirm(msg)) _moDrawRoute(true);
    }
}

function moToggleSortMode() {
    _moSortMode = !_moSortMode;
    var btn = document.getElementById('moSortModeBtn');
    if (btn) btn.classList.toggle('active', _moSortMode);
    _moRebuildList();
}

function moResetOrder() {
    _moCustomOrder = _moOkList.map(function (_, i) { return i; });
    _moRefreshMarkers();
    _moRebuildList();
    if (_moRouteActive) _moDrawRoute();
}

function _moRefreshMarkers() {
    for (var i = 0; i < _moMarkerOvs.length; i++) {
        var ov = _moMarkerOvs[i];
        if (!ov) continue;
        var seq = _moCustomOrder.indexOf(i);
        var el = ov.getContent();
        if (el) {
            el.textContent = seq + 1;
            el.className = 'kk-marker' + (_moRouteActive ? ' amber' : '');
        }
    }
}

function _moRebuildList() {
    var scroll = document.getElementById('moAddrListScroll');
    if (!scroll) return;
    var html = '';
    for (var i = 0; i < _moCustomOrder.length; i++) {
        var idx = _moCustomOrder[i];
        var seq = i;
        var r = _moOkList[idx];
        if (!r) continue;
        html += '<div class="mo-addr-item" data-idx="' + idx + '" data-seq="' + seq + '">' +
            (_moSortMode ? '<div class="mo-item-grab">☰</div>' : '') +
            '<div class="mo-addr-num ' + (_moRouteActive ? 'num-amber' : 'num-green') + '">' + (seq + 1) + '</div>' +
            '<div class="mo-addr-text"><b>' + r.customer + '</b><div class="detail">' + r.addr + '</div></div>' +
            '</div>';
    }
    scroll.innerHTML = html;
    _moInitListEvents();
}

function _moInitListEvents() {
    // 드래그앤드롭 이벤트 추가 가능
}

function _moInitLayout() { _moSetPanelH(0.42); }

function _moSetPanelH(r) {
    var layout = document.getElementById('moLayout');
    if (!layout) return;
    var h = layout.getBoundingClientRect().height;
    if (h <= 0) h = window.innerHeight - 60; // 안전장치

    var panel = document.getElementById('moBottomPanel');
    if (panel) panel.style.height = (h * r) + 'px';

    var area = document.getElementById('moMapArea');
    if (area) area.style.height = (h * (1 - r)) + 'px';

    if (_moMap) {
        setTimeout(function () {
            kakao.maps.event.trigger(_moMap, 'resize');
        }, 300);
    }
}

function moTogglePanelExpand() {
    if (!document.getElementById('moBottomPanel')) return;
    _moPanelExpanded = !_moPanelExpanded;
    _moSetPanelH(_moPanelExpanded ? 0.85 : 0.42);
    var btn = document.getElementById('moPanelToggleBtn');
    if (btn) btn.textContent = _moPanelExpanded ? '⬇' : '⬆';
}

(function () {
    var setup = function () {
        var h = document.getElementById('moDragHandle');
        if (!h) { setTimeout(setup, 200); return; }
        var sy, sh, dragging = false;
        var panel = document.getElementById('moBottomPanel');
        var area = document.getElementById('moMapArea');
        var layout = document.getElementById('moLayout');

        function start(e) {
            dragging = true;
            sy = e.touches ? e.touches[0].clientY : e.clientY;
            sh = panel.getBoundingClientRect().height;
            panel.style.transition = 'none';
            area.style.transition = 'none';
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', end);
            document.addEventListener('touchmove', move, { passive: false });
            document.addEventListener('touchend', end);
        }
        function move(e) {
            if (!dragging) return;
            var y = e.touches ? e.touches[0].clientY : e.clientY;
            var diff = sy - y;
            var nh = sh + diff;
            var lh = layout.getBoundingClientRect().height;
            if (nh < 40) nh = 40; if (nh > lh - 60) nh = lh - 60;
            panel.style.height = nh + 'px';
            area.style.height = (lh - nh) + 'px';
            if (e.cancelable) e.preventDefault();
        }
        function end() {
            if (!dragging) return;
            dragging = false;
            panel.style.transition = 'height .2s ease';
            area.style.transition = 'height .2s ease';
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', end);
            document.removeEventListener('touchmove', move);
            document.removeEventListener('touchend', end);
            if (_moMap) kakao.maps.event.trigger(_moMap, 'resize');
        }
        h.addEventListener('mousedown', start);
        h.addEventListener('touchstart', start);
    };
    if (document.readyState === 'complete') setup();
    else window.addEventListener('load', setup);
})();


